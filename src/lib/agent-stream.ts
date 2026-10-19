// 前后端共用：AI 检索的流式事件格式与校验。这里不能引入任何仅限服务端的模块。
import { notReference } from "./verify/extract";
import { VERDICTS, type AgentTrace, type CheckStep, type ParsedRef, type RefResult } from "./verify/types";

export type AgentEvent =
  | { type: "step"; step: CheckStep }
  | { type: "result"; result: RefResult }
  | { type: "fatal"; message: string };

/**
 * 只有"无法核验"和"只找到相近候选"的条目值得继续查；查无此文、已确认的结论不交给模型。
 * DOI 写错但另有相近候选的（信息有误 + candidate）也可以继续查那篇候选是不是同一篇。
 * 看起来不是参考文献的一段正文不交给模型去查。
 */
export function agentEligible(result: Pick<RefResult, "verdict" | "matchStatus"> & { parsed?: ParsedRef }): boolean {
  if (result.parsed && notReference(result.parsed)) return false;
  return result.verdict === "unverifiable" || result.verdict === "near_match" || (result.verdict === "mismatch" && result.matchStatus === "candidate");
}

/** 界面和下载报告共用的一句话：AI 查了几次、规则复核结果如何 */
export function agentSummary(agent: AgentTrace): string {
  if (agent.toolCalls === 0) return agent.note ?? "AI 没有发起新的检索，结论不变";
  return agent.outcome === "confirmed"
    ? `AI 检索 ${agent.toolCalls} 次找到候选，规则逐字段比对确认是同一篇`
    : `AI 检索 ${agent.toolCalls} 次，没有找到能由规则确认的同一篇，结论不变`;
}

const malformed = () => new Error("AI 检索响应格式不正确，原有结论保持不变");

function validStep(step: unknown): step is CheckStep {
  const s = step as CheckStep | null;
  return !!s && typeof s === "object" && typeof s.action === "string" && typeof s.detail === "string" && s.detail.length <= 2_000 &&
    typeof s.ok === "boolean" && Number.isFinite(s.ms) && (s.reason === undefined || (typeof s.reason === "string" && s.reason.length <= 200));
}

/** 连接中途断开不算完成：必须收到一条结果才结束 */
export async function readAgentStream(stream: ReadableStream<Uint8Array>, index: number, onEvent: (event: AgentEvent) => void): Promise<RefResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let steps = 0;
  let result: RefResult | undefined;

  function accept(line: string) {
    if (!line.trim()) return;
    if (result) throw malformed();
    let event: AgentEvent;
    try { event = JSON.parse(line) as AgentEvent; } catch { throw malformed(); }
    if (!event || typeof event !== "object") throw malformed();
    switch (event.type) {
      case "step":
        if (!validStep(event.step) || ++steps > 20) throw malformed();
        break;
      case "result": {
        const r = event.result;
        if (!r || r.index !== index || !VERDICTS.includes(r.verdict) || typeof r.summary !== "string" || !Array.isArray(r.steps) ||
            !r.steps.every(validStep) || !Array.isArray(r.issues) || !Array.isArray(r.notes) || !Array.isArray(r.fields)) throw malformed();
        result = r;
        break;
      }
      case "fatal":
        throw new Error(typeof event.message === "string" ? event.message : "AI 检索中断，原有结论保持不变");
      default:
        throw malformed();
    }
    onEvent(event);
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000) throw malformed();
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        accept(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    buffer += decoder.decode();
    accept(buffer);
    if (!result) throw new Error("AI 检索连接中断，原有结论保持不变");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
