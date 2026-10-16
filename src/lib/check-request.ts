export const MAX_CHECK_CHARS = 60_000;
export const MAX_CHECK_REFS = 80;
// A JSON Unicode escape can occupy six bytes for one input character.
export const MAX_CHECK_BODY_BYTES = MAX_CHECK_CHARS * 6 + 1_024;

export class CheckRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CheckRequestError";
  }
}

export interface CheckRequestBody {
  text: string;
  mode: "standard" | "ai";
}

/** Bound the wire body before parsing JSON, including chunked requests. */
export async function readCheckRequest(request: Request): Promise<CheckRequestBody> {
  const body = await readJsonBody(request, MAX_CHECK_BODY_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CheckRequestError(400, "请求格式不正确");
  const { text, mode } = body as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) throw new CheckRequestError(400, "请先粘贴参考文献");
  if (text.length > MAX_CHECK_CHARS) throw new CheckRequestError(413, `内容太长了，单次最多 ${MAX_CHECK_CHARS.toLocaleString()} 个字符`);
  if (mode !== undefined && mode !== "standard" && mode !== "ai") throw new CheckRequestError(400, "核验模式不正确，请选择标准或 AI 模式");
  return { text, mode: mode ?? "standard" };
}

/** Read and parse a JSON body no larger than maxBytes, including chunked requests. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new CheckRequestError(400, "请求长度格式不正确");
    if (Number(length) > maxBytes) throw new CheckRequestError(413, "请求体太大，请缩短参考文献内容");
  }
  if (request.signal.aborted) throw new CheckRequestError(499, "请求已取消");
  if (!request.body) throw new CheckRequestError(400, "请求格式不正确");
  const reader = request.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", abort, { once: true });
  let body: unknown;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let json = "";
    for (;;) {
      if (request.signal.aborted) throw new CheckRequestError(499, "请求已取消");
      const { value, done } = await reader.read();
      if (request.signal.aborted) throw new CheckRequestError(499, "请求已取消");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new CheckRequestError(413, "请求体太大，请缩短参考文献内容");
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    body = JSON.parse(json);
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof CheckRequestError) throw error;
    throw new CheckRequestError(request.signal.aborted ? 499 : 400, request.signal.aborted ? "请求已取消" : "请求格式不正确");
  } finally {
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  return body;
}
