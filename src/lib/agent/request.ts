import { CheckRequestError, MAX_CHECK_REFS, readJsonBody } from "../check-request";

/** 单条引文的长度上限：正常参考文献远小于这个值 */
export const MAX_AGENT_CHARS = 2_000;

export interface AgentRequestBody {
  raw: string;
  index: number;
}

export async function readAgentRequest(request: Request): Promise<AgentRequestBody> {
  const body = await readJsonBody(request, MAX_AGENT_CHARS * 6 + 512);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CheckRequestError(400, "请求格式不正确");
  const { raw, index, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length) throw new CheckRequestError(400, "请求包含不支持的字段");
  if (typeof raw !== "string" || raw.trim().length < 8) throw new CheckRequestError(400, "请提供一条完整的参考文献");
  if (raw.length > MAX_AGENT_CHARS) throw new CheckRequestError(413, `单条参考文献最多 ${MAX_AGENT_CHARS.toLocaleString()} 个字符`);
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > MAX_CHECK_REFS) throw new CheckRequestError(400, "条目序号不正确");
  return { raw: raw.trim(), index };
}
