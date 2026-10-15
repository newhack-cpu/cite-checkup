// NDJSON: extraction progress -> meta -> database results -> done.
// Model output supplies validated extraction fields only; verifyAll owns verdicts.
import { getAIStatus, prepareAIReferences } from "@/lib/ai";
import { checkClientIp, createCheckLimits } from "@/lib/check-limits";
import { CheckRequestError, MAX_CHECK_REFS, readCheckRequest } from "@/lib/check-request";
import { parseReferenceList } from "@/lib/verify/extract";
import type { CheckEvent, Verdict } from "@/lib/verify/types";
import { verifyAll } from "@/lib/verify/verify";

// These limits are per process, not distributed quotas or an authentication layer.
const limits = createCheckLimits();

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function GET() {
  const { available, provider, model } = getAIStatus();
  return Response.json({ available, provider, model }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const ip = checkClientIp(request);
  if (!limits.allowCheck(ip)) return fail(429, "请求太频繁了，请一分钟后再试");
  let input;
  try {
    input = await readCheckRequest(request);
  } catch (error) {
    return error instanceof CheckRequestError ? fail(error.status, error.message) : fail(400, "请求格式不正确");
  }
  const standardRefs = parseReferenceList(input.text);
  if (!standardRefs.length) return fail(422, "没有识别到参考文献条目");
  if (standardRefs.length > MAX_CHECK_REFS) return fail(413, `单次最多核查 ${MAX_CHECK_REFS} 条，当前识别到 ${standardRefs.length} 条`);
  if (request.signal.aborted) return fail(499, "请求已取消");
  const work = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        cleanup();
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

      // Do not return this promise from start: cancellation must remain immediate
      // while model or database I/O is pending.
      void (async () => {
        const started = Date.now();
        const counts: Record<Verdict, number> = { verified: 0, mismatch: 0, not_found: 0, retracted: 0, concern: 0, unverifiable: 0, error: 0 };
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
                try {
                  const prepared = await prepareAIReferences(input.text, {
                    signal: work.signal,
                    onProgress: (message) => send({ type: "phase", phase: "extract", message }),
                  });
                  work.signal.throwIfAborted();
                  if (!prepared.refs.length || prepared.refs.length > MAX_CHECK_REFS) throw new Error("Invalid extraction size");
                  refs = prepared.refs;
                } catch (error) {
                  if (work.signal.aborted || isAbort(error)) throw error;
                  send({ type: "notice", message: "AI 解析调用失败或返回内容未通过校验，本次已改用标准规则核验。" });
                } finally {
                  allowance.release?.();
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
          await verifyAll(refs, (result) => {
            if (closed || work.signal.aborted) return;
            if (!expected.has(result.index) || received.has(result.index) || !Object.hasOwn(counts, result.verdict)) throw new Error("Invalid verification result");
            received.add(result.index);
            counts[result.verdict]++;
            send({ type: "result", result });
          }, { concurrency: 3, openalexBudget: Number.isFinite(budget) ? Math.max(0, Math.min(MAX_CHECK_REFS, Math.floor(budget))) : 20, signal: work.signal });
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
      if (request.signal.aborted) abort();
    },
    cancel() {
      closed = true;
      work.abort();
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
