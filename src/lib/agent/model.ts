// Server-side only. DeepSeek 多轮工具调用：模型每轮决定调用哪个检索工具，不能给出文献真伪结论。
import { deepseekConfiguration } from "../ai";
import { readBoundedJson, retryableTransport } from "../claims/io";

export class AgentError extends Error {
  constructor(message: string, readonly code: "CONFIGURATION" | "MODEL_UNAVAILABLE" | "INVALID_RESPONSE") {
    super(message);
    this.name = "AgentError";
  }
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AssistantTurn {
  content: string | null;
  calls: ToolCall[];
  tokens: number;
}

/** 一轮最多处理的工具调用数，多出来的不执行也不回传 */
export const MAX_CALLS_PER_TURN = 2;
const MAX_RESPONSE_BYTES = 200_000;
const MAX_ARGUMENT_CHARS = 4_000;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 只接受结构完整的 assistant 消息；工具名和参数的合法性由 tools.ts 逐个校验 */
export function parseAssistantTurn(body: unknown): AssistantTurn {
  const invalid = () => new AgentError("DeepSeek 返回的内容不符合工具调用格式，AI 检索已停止", "INVALID_RESPONSE");
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length !== 1 || !isRecord(body.choices[0])) throw invalid();
  const choice = body.choices[0];
  const message = choice.message;
  if (!isRecord(message) || message.role !== "assistant") throw invalid();
  const calls: ToolCall[] = [];
  if (choice.finish_reason === "tool_calls") {
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) throw invalid();
    for (const call of message.tool_calls.slice(0, MAX_CALLS_PER_TURN)) {
      if (!isRecord(call) || call.type !== "function" || typeof call.id !== "string" || !call.id || call.id.length > 200 ||
          !isRecord(call.function) || typeof call.function.name !== "string" || call.function.name.length > 64 ||
          typeof call.function.arguments !== "string" || call.function.arguments.length > MAX_ARGUMENT_CHARS) throw invalid();
      calls.push({ id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  } else if (choice.finish_reason !== "stop") {
    throw invalid();
  }
  const total = isRecord(body.usage) ? Number(body.usage.total_tokens) : NaN;
  return {
    content: typeof message.content === "string" ? message.content : null,
    calls,
    tokens: Number.isFinite(total) && total > 0 ? total : 0,
  };
}

export async function callAgentModel(messages: unknown[], tools: unknown[], signal: AbortSignal): Promise<AssistantTurn & { model: string }> {
  const config = deepseekConfiguration();
  if (!config.apiKey || !config.endpoint) throw new AgentError("DeepSeek 尚未配置，无法使用 AI 检索", "CONFIGURATION");
  const payload = {
    model: config.model, stream: false, temperature: 0, thinking: { type: "disabled" }, max_tokens: 800,
    messages, tools, tool_choice: "required",
  };
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2 && !response; attempt++) {
    try {
      response = await fetch(config.endpoint, {
        method: "POST", redirect: "error", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === 0 && retryableTransport(error)) continue;
      throw new AgentError("DeepSeek 连接失败，AI 检索未完成", "MODEL_UNAVAILABLE");
    }
  }
  if (!response) throw new AgentError("DeepSeek 连接失败，AI 检索未完成", "MODEL_UNAVAILABLE");
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new AgentError(
      response.status === 401 || response.status === 403 ? "DeepSeek 服务端鉴权失败，AI 检索未完成"
        : response.status === 429 ? "DeepSeek 请求过于频繁或额度不足，AI 检索未完成" : "DeepSeek 服务暂时不可用，AI 检索未完成",
      "MODEL_UNAVAILABLE",
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(response, signal, MAX_RESPONSE_BYTES);
  } catch {
    signal.throwIfAborted();
    throw new AgentError("DeepSeek 响应格式或大小不符合要求，AI 检索已停止", "INVALID_RESPONSE");
  }
  return { ...parseAssistantTurn(body), model: config.model };
}
