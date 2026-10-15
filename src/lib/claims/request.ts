import type { ClaimInput } from "./types";

export const MAX_CLAIM_CHARS = 2_000;
export const MAX_EVIDENCE_CHARS = 160_000;
export const MAX_CLAIM_BODY_BYTES = 1_000_000;

export class ClaimRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeDoi(value: string): string | undefined {
  let doi = value.trim();
  if (/^https?:\/\//i.test(doi)) {
    try {
      const url = new URL(doi);
      if (!["doi.org", "dx.doi.org"].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash) return undefined;
      doi = decodeURIComponent(url.pathname.slice(1));
    } catch { return undefined; }
  }
  if (doi.length > 2_048 || !/^10\.\d{4,9}\/[^\s<>"\\\u0000-\u001f\u007f]+$/i.test(doi)) return undefined;
  return doi.toLowerCase();
}

export function validateClaimInput(value: unknown): ClaimInput {
  if (!record(value) || Object.keys(value).some((key) => !["claim", "doi", "evidenceText", "evidenceLabel"].includes(key))) {
    throw new ClaimRequestError(400, "论断核查请求格式不正确");
  }
  if (typeof value.claim !== "string" || !value.claim.trim()) throw new ClaimRequestError(400, "请填写一条待核查的正文论断");
  if (value.claim.length > MAX_CLAIM_CHARS) throw new ClaimRequestError(413, "论断最多 2,000 个字符");
  if (value.doi !== undefined && typeof value.doi !== "string" || value.evidenceText !== undefined && typeof value.evidenceText !== "string" || value.evidenceLabel !== undefined && typeof value.evidenceLabel !== "string") {
    throw new ClaimRequestError(400, "证据来源格式不正确");
  }
  const doiRaw = typeof value.doi === "string" ? value.doi.trim() : "";
  const text = typeof value.evidenceText === "string" ? value.evidenceText : "";
  if (Boolean(doiRaw) === Boolean(text.trim())) throw new ClaimRequestError(400, "请提供 DOI 或证据正文中的一种来源");
  if (text.length > MAX_EVIDENCE_CHARS) throw new ClaimRequestError(413, "证据正文最多 160,000 个字符，请选择与论断有关的内容");
  const label = typeof value.evidenceLabel === "string" ? value.evidenceLabel.trim() : "";
  if (label.length > 200) throw new ClaimRequestError(413, "来源名称最多 200 个字符");
  const doi = doiRaw ? normalizeDoi(doiRaw) : undefined;
  if (doiRaw && !doi) throw new ClaimRequestError(400, "请输入有效 DOI 或 doi.org 链接，暂不支持任意网页链接");
  return { claim: value.claim.trim(), ...(doi ? { doi } : { evidenceText: text }), ...(label ? { evidenceLabel: label } : {}) };
}

/** Enforce bytes before JSON parsing, including clients that omit Content-Length. */
export async function readClaimRequest(request: Request): Promise<ClaimInput> {
  if (request.signal.aborted) throw new ClaimRequestError(499, "请求已取消");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ClaimRequestError(415, "请使用 JSON 格式提交核查请求");
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) throw new ClaimRequestError(400, "请求长度格式不正确");
  if (length !== null && Number(length) > MAX_CLAIM_BODY_BYTES) throw new ClaimRequestError(413, "请求体过大");
  if (!request.body) throw new ClaimRequestError(400, "请求正文为空");
  const reader = request.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 15_000);
  let json = "";
  let bytes = 0;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (;;) {
      if (request.signal.aborted) throw new ClaimRequestError(499, "请求已取消");
      if (timedOut) throw new ClaimRequestError(408, "读取请求超时，请重新提交");
      const { value, done } = await reader.read();
      if (request.signal.aborted) throw new ClaimRequestError(499, "请求已取消");
      if (timedOut) throw new ClaimRequestError(408, "读取请求超时，请重新提交");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CLAIM_BODY_BYTES) throw new ClaimRequestError(413, "请求体过大");
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return validateClaimInput(JSON.parse(json));
  } catch (error) {
    if (error instanceof ClaimRequestError) throw error;
    throw new ClaimRequestError(request.signal.aborted ? 499 : 400, request.signal.aborted ? "请求已取消" : "请求格式不正确");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    abort();
    reader.releaseLock();
  }
}
