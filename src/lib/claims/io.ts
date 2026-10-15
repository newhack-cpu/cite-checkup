import { ClaimError } from "./errors";

const RETRYABLE_TRANSPORT = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET"]);
export function retryableTransport(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  const code = value.cause?.code ?? value.code;
  return typeof code === "string" && RETRYABLE_TRANSPORT.has(code);
}

/** Cancels I/O and releases the caller even if an upstream implementation ignores abort. */
export async function withDeadline<T>(task: (signal: AbortSignal) => Promise<T>, parent: AbortSignal | undefined, milliseconds: number): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  parent?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  let rejectInterrupted: (error: unknown) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const interruptedHandler = () => rejectInterrupted(timedOut
    ? new ClaimError("TIMEOUT", "证据核查请求超时，本次核查未完成，请稍后重试")
    : new DOMException("证据核查已取消", "AbortError"));
  controller.signal.addEventListener("abort", interruptedHandler, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  try {
    if (parent?.aborted) cancel();
    controller.signal.throwIfAborted();
    const result = await Promise.race([task(controller.signal), interrupted]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", interruptedHandler);
  }
}

export async function readBoundedJson(response: Response, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  const fail = () => new ClaimError("SOURCE_UNAVAILABLE", "上游响应格式或大小不符合要求，本次核查未完成");
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get("content-type") ?? "") ||
      Number(response.headers.get("content-length")) > maxBytes || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw fail();
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let size = 0;
  let text = "";
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw fail();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ClaimError) throw error;
    throw fail();
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}
