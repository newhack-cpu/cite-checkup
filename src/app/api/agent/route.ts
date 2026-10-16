// NDJSON：AI 检索的每一步 -> 规则复核后的结果。模型只规划检索，结论来自 verifyReference。
import { createAgentLimits, getAgentStatus, runAgent } from "@/lib/agent";
import { readAgentRequest } from "@/lib/agent/request";
import { checkClientIp } from "@/lib/check-limits";
import { CheckRequestError } from "@/lib/check-request";
import type { AgentEvent } from "@/lib/agent-stream";

export const maxDuration = 90;
// 进程内限额，不是分布式配额或账户系统
const limits = createAgentLimits();
const headers = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function GET() {
  return Response.json(getAgentStatus(), { headers });
}

export async function POST(request: Request) {
  let input;
  try {
    input = await readAgentRequest(request);
  } catch (error) {
    return error instanceof CheckRequestError ? fail(error.status, error.message) : fail(400, "请求格式不正确");
  }
  if (!getAgentStatus().available) return fail(503, "AI 尚未配置可用的密钥，暂时不能使用 AI 检索");
  const slot = limits.reserve(checkClientIp(request));
  if (slot.error) return fail(429, slot.error);
  const release = slot.release ?? (() => {});

  const work = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        cleanup();
        release();
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const abort = () => {
        work.abort(request.signal.reason);
        close();
      };
      request.signal.addEventListener("abort", abort, { once: true });
      cleanup = () => request.signal.removeEventListener("abort", abort);
      const send = (event: AgentEvent) => {
        if (closed || work.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
          work.abort();
          cleanup();
        }
      };
      void (async () => {
        try {
          const result = await runAgent(input.raw, input.index, { signal: work.signal, onStep: (step) => send({ type: "step", step }) });
          send({ type: "result", result });
        } catch {
          if (!work.signal.aborted) send({ type: "fatal", message: "AI 检索中断了，原有结论保持不变，请稍后重试" });
          work.abort();
        } finally {
          close();
        }
      })();
      if (request.signal.aborted) abort();
    },
    cancel() {
      closed = true;
      work.abort();
      cleanup();
      release();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no", ...headers } });
}
