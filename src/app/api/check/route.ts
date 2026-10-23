// NDJSON: extraction progress -> meta -> database results -> done.
// Model output supplies validated extraction fields only; verifyAll owns verdicts.
import { getAIStatus, prepareAIReferences } from "@/lib/ai";
import { checkClientIp, createCheckLimits } from "@/lib/check-limits";
import { CheckRequestError, MAX_CHECK_REFS, readCheckRequest } from "@/lib/check-request";
import { createRequestDeadline } from "@/lib/request-deadline";
import { parseReferenceList } from "@/lib/verify/extract";
import { VERDICTS, type CheckEvent, type Verdict } from "@/lib/verify/types";
import { verifyAll } from "@/lib/verify/verify";

// These limits are per process, not distributed quotas or an authentication layer.
const limits = createCheckLimits();

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** AI 辅助解析做了什么：只发送规则没解析出题名的条目，逐条校验 */
function aiNotice({ refs, sent, supplemented, rejected }: { refs: unknown[]; sent: number; supplemented: number; rejected: number }): string {
  if (!sent) return `规则已解析出全部 ${refs.length} 条的题名，没有需要 AI 补充的字段，未调用 DeepSeek。`;
  const parts = [`规则没解析出题名的 ${sent} 条交给 DeepSeek 从原文中摘取字段`, `${supplemented} 条补上了字段（详情的比对表中标“AI 摘出”）`];
  if (rejected) parts.push(`${rejected} 条的返回内容没通过原文校验，仍按规则解析`);
  if (refs.length > sent) parts.push(`其余 ${refs.length - sent} 条规则已解析出题名，未发送`);
  return `${parts.join("；")}。`;
}

export async function GET() {
  const { available, provider, model } = getAIStatus();
  return Response.json({ available, provider, model }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const work = createRequestDeadline(request);
  const reject = (status: number, message: string) => { work.dispose(); return fail(status, message); };
  const ip = checkClientIp(request);
  if (!limits.allowCheck(ip)) return reject(429, "请求太频繁了，请一分钟后再试");
  let input;
  try {
    input = await work.run(() => readCheckRequest(work.request));
  } catch (error) {
    if (work.timedOut) return reject(504, "核查超时，尚未完成，请减少条目后重试");
    if (work.signal.aborted) return reject(499, "请求已取消");
    return error instanceof CheckRequestError ? reject(error.status, error.message) : reject(400, "请求格式不正确");
  }
  const standardRefs = parseReferenceList(input.text);
  if (!standardRefs.length) return reject(422, "没有识别到参考文献条目");
  if (standardRefs.length > MAX_CHECK_REFS) return reject(413, `单次最多核查 ${MAX_CHECK_REFS} 条，当前识别到 ${standardRefs.length} 条`);
  if (work.signal.aborted) return reject(499, "请求已取消");
  const encoder = new TextEncoder();
  let closed = false;
  let releaseAI: (() => void) | undefined;
  const releaseAIReservation = () => { const release = releaseAI; releaseAI = undefined; release?.(); };
  let cleanup = () => { work.dispose(); releaseAIReservation(); };
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
        releaseAIReservation();
      };
      const send = (event: CheckEvent) => {
        if (closed || work.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
          work.abort();
          cleanup();
        }
      };
      work.onTimeout(() => send({ type: "fatal", message: "核查超时，结果尚未完整，已返回的结果仍保留，请减少条目后重试" }));

      // Do not return this promise from start: cancellation must remain immediate
      // while model or database I/O is pending.
      void (async () => {
        const started = Date.now();
        const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
        try {
          work.signal.throwIfAborted();
          let refs = standardRefs;
          send({ type: "phase", phase: "extract", message: input.mode === "ai" ? "正在准备 AI 辅助解析" : "正在解析参考文献" });
          if (input.mode === "ai") {
            if (!getAIStatus().available) {
              send({ type: "notice", message: "AI 尚未配置可用的密钥，本次已改用标准规则核验。" });
            } else {
              const allowance = limits.reserveAI(ip, input.text.length);
              if (allowance.notice) {
                send({ type: "notice", message: allowance.notice });
              } else {
                releaseAI = allowance.release;
                try {
                  const prepared = await work.run(() => prepareAIReferences(input.text, {
                    signal: work.signal,
                    onProgress: (message) => send({ type: "phase", phase: "extract", message }),
                  }));
                  work.signal.throwIfAborted();
                  if (!prepared.refs.length || prepared.refs.length > MAX_CHECK_REFS) throw new Error("Invalid extraction size");
                  refs = prepared.refs;
                  send({ type: "notice", message: aiNotice(prepared) });
                } catch (error) {
                  if (work.signal.aborted || isAbort(error)) throw error;
                  send({ type: "notice", message: "AI 解析调用失败或返回内容未通过校验，本次已改用标准规则核验。" });
                } finally {
                  releaseAIReservation();
                }
              }
            }
          }
          work.signal.throwIfAborted();
          send({ type: "meta", total: refs.length, refs });
          send({ type: "phase", phase: "verify", message: `正在通过学术数据源核验 ${refs.length} 条参考文献` });
          const expected = new Set(refs.map((ref) => ref.index));
          const received = new Set<number>();
          const budget = Number(process.env.OPENALEX_SEARCH_BUDGET ?? 20);
          await work.run(() => verifyAll(refs, (result) => {
            if (closed || work.signal.aborted) return;
            if (!expected.has(result.index) || received.has(result.index) || !Object.hasOwn(counts, result.verdict)) throw new Error("Invalid verification result");
            received.add(result.index);
            counts[result.verdict]++;
            send({ type: "result", result });
          }, {
            concurrency: 3, openalexBudget: Number.isFinite(budget) ? Math.max(0, Math.min(MAX_CHECK_REFS, Math.floor(budget))) : 20, signal: work.signal,
            // Netlify 上整个请求 50 秒：快到时不再开始新的中文期刊联网核查，已开始的各自有时限
            deadline: work.deadline,
          }));
          work.signal.throwIfAborted();
          if (received.size !== refs.length) throw new Error("Incomplete verification results");
          send({ type: "done", stats: { total: refs.length, counts, ms: Date.now() - started } });
        } catch (error) {
          if (!work.signal.aborted && !isAbort(error)) send({ type: "fatal", message: "核查中断了，结果尚未完整，请稍后重试" });
          // An engine invariant failure may leave other workers in flight.
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
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
