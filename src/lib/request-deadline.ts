import { HOSTED_REQUEST_TIMEOUT_MS } from "./deployment-limits";

/** One route budget, including input reads. Library/MCP deadlines stay independent. */
export function createRequestDeadline(request: Request) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let beforeTimeout: (() => void) | undefined;
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = HOSTED_REQUEST_TIMEOUT_MS === undefined ? undefined : setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    // A streaming route must enqueue its incomplete frame before abort suppresses writes.
    try { beforeTimeout?.(); } finally {
      controller.abort(new DOMException("Request deadline exceeded", "TimeoutError"));
    }
  }, HOSTED_REQUEST_TIMEOUT_MS);

  return {
    request: new Request(request, { signal: controller.signal }),
    signal: controller.signal,
    /** 托管平台的整体时限（毫秒时间戳）；本机和其他部署没有时为 undefined */
    deadline: HOSTED_REQUEST_TIMEOUT_MS === undefined ? undefined : startedAt + HOSTED_REQUEST_TIMEOUT_MS,
    get timedOut() { return timedOut; },
    onTimeout(callback: () => void) { beforeTimeout = callback; },
    abort(reason?: unknown) { controller.abort(reason); },
    dispose() {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      beforeTimeout = undefined;
    },
    /** Stop waiting even when an adapter ignores abort; still observe its eventual rejection. */
    run<T>(operation: () => Promise<T>): Promise<T> {
      const signal = controller.signal;
      if (signal.aborted) return Promise.reject(signal.reason);
      return new Promise<T>((resolve, reject) => {
        const cancel = () => { cleanup(); reject(signal.reason); };
        const cleanup = () => signal.removeEventListener("abort", cancel);
        signal.addEventListener("abort", cancel, { once: true });
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return operation();
        }).then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
      });
    },
  };
}
