// NDJSON：AI 检索的每一步 -> 规则复核后的结果。模型只规划检索，结论来自 verifyReference。
import { createAgentLimits, getAgentStatus, runAgent } from "@/lib/agent";
import { readAgentRequest } from "@/lib/agent/request";
import { checkClientIp } from "@/lib/check-limits";
import { CheckRequestError } from "@/lib/check-request";
import type { AgentEvent } from "@/lib/agent-stream";
import { createRequestDeadline } from "@/lib/request-deadline";

export const maxDuration = 90;
// 进程内限额，不是分布式配额或账户系统
const limits = createAgentLimits();
const headers = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function GET() {
  return Response.json(getAgentStatus(), { headers });
}

export async function POST(request: Request) {
  const work = createRequestDeadline(request);
  const reject = (status: number, message: string) => { work.dispose(); return fail(status, message); };
  let input;
  try {
    input = await work.run(() => readAgentRequest(work.request));
  } catch (error) {
    if (work.timedOut) return reject(504, "AI 检索超时，尚未完成，原有结论保持不变，请稍后重试");
    if (work.signal.aborted) return reject(499, "请求已取消");
    return error instanceof CheckRequestError ? reject(error.status, error.message) : reject(400, "请求格式不正确");
  }
  if (!getAgentStatus().available) return reject(503, "AI 尚未配置可用的密钥，暂时不能使用 AI 检索");
  const slot = limits.reserve(checkClientIp(request));
  if (slot.error) return reject(429, slot.error);
  let reservation = slot.release;
  const release = () => { const held = reservation; reservation = undefined; held?.(); };

  const encoder = new TextEncoder();
  let closed = false;
  let cleanup = () => { work.dispose(); release(); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        cleanup();
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      work.signal.addEventListener("abort", close, { once: true });
      cleanup = () => {
        work.signal.removeEventListener("abort", close);
        work.dispose();
        release();
      };
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
      work.onTimeout(() => send({ type: "fatal", message: "AI 检索超时，尚未完成，原有结论保持不变，请稍后重试" }));
      void (async () => {
        try {
          const result = await work.run(() => runAgent(input.raw, input.index, { signal: work.signal, onStep: (step) => send({ type: "step", step }) }));
          send({ type: "result", result });
        } catch {
          if (!work.signal.aborted) send({ type: "fatal", message: "AI 检索中断了，原有结论保持不变，请稍后重试" });
          work.abort();
        } finally {
          close();
        }
      })();
      if (work.signal.aborted) close();
    },
    cancel() {
      closed = true;
      work.abort();
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no", ...headers } });
}
