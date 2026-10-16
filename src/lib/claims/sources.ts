import { ClaimError } from "./errors";
import { arxivFullText, arxivIdFromDoi, europePmcFullText, type FullText } from "./fulltext";
import { readBoundedJson, retryableTransport, withDeadline } from "./io";
import { normalizeDoi, record } from "./request";
import { normalizeEvidence } from "./retrieval";
import type { ClaimSource } from "./types";

const MAX_ABSTRACT_CHARS = 60_000;

export interface SourceEvidence { source: ClaimSource; text: string; warnings: string[] }

export function stripAbstractMarkup(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return normalizeEvidence(value.replace(/<[^>]*>/g, " ").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, token: string) => {
    if (!token.startsWith("#")) return named[token.toLowerCase()] ?? " ";
    const point = token[1].toLowerCase() === "x" ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : " ";
  }).replace(/\s+/g, " "));
}

export function reconstructAbstract(value: unknown): string {
  if (!record(value)) throw new ClaimError("SOURCE_UNAVAILABLE", "OpenAlex 摘要格式不正确");
  const entries = Object.entries(value);
  if (entries.length > 20_000) throw new ClaimError("SOURCE_UNAVAILABLE", "OpenAlex 摘要大小超过限制");
  const words = new Map<number, string>();
  let chars = 0;
  for (const [word, indexes] of entries) {
    if (!word || word.length > 2_000 || !Array.isArray(indexes) || !indexes.length || indexes.length > 20_000) throw new ClaimError("SOURCE_UNAVAILABLE", "OpenAlex 摘要格式不正确");
    for (const index of indexes) {
      if (!Number.isInteger(index) || index < 0 || index >= 20_000 || words.has(index)) throw new ClaimError("SOURCE_UNAVAILABLE", "OpenAlex 摘要位置不正确");
      chars += word.length + 1;
      if (chars > MAX_ABSTRACT_CHARS) throw new ClaimError("SOURCE_UNAVAILABLE", "OpenAlex 摘要大小超过限制");
      words.set(index, word);
    }
  }
  // Gaps indicate an incomplete reconstruction; never silently join separated words.
  if (words.size && Math.max(...words.keys()) !== words.size - 1) throw new ClaimError("SOURCE_UNAVAILABLE", "OpenAlex 摘要位置不完整");
  return normalizeEvidence([...words].sort(([a], [b]) => a - b).map(([, word]) => word).join(" "));
}

async function fetchRecord(url: URL, parent?: AbortSignal): Promise<unknown | null> {
  if (url.protocol !== "https:" || !["api.crossref.org", "api.openalex.org"].includes(url.hostname) || url.username || url.password || url.port) {
    throw new ClaimError("SOURCE_UNAVAILABLE", "证据数据源不在允许范围内");
  }
  return withDeadline(async (signal) => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url.toString(), { signal, redirect: "error", cache: "no-store", headers: { Accept: "application/json", "User-Agent": "cite-checkup/0.1 academic-evidence-check" } });
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (attempt === 0 && retryableTransport(error)) continue;
        throw new ClaimError("SOURCE_UNAVAILABLE", "学术数据库连接失败，本次核查未完成");
      }
    }
    if (!response) throw new ClaimError("SOURCE_UNAVAILABLE", "学术数据库连接失败，本次核查未完成");
    if (response.status === 404) { void response.body?.cancel().catch(() => {}); return null; }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ClaimError("SOURCE_UNAVAILABLE", "学术数据库暂时不可用，本次核查未完成");
    }
    return readBoundedJson(response, signal, 800_000);
  }, parent, 15_000);
}

function source(doi: string, kind: ClaimSource["kind"], title: unknown, text: string): ClaimSource {
  const cleanTitle = typeof title === "string" ? stripAbstractMarkup(title).slice(0, 500) : "";
  return { id: "source-1", kind, label: kind === "crossref_abstract" ? "Crossref 摘要" : "OpenAlex 摘要", title: cleanTitle || undefined, doi,
    url: `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`, retrievedAt: new Date().toISOString(), scope: "abstract", totalChars: text.length };
}

/** 出版社在 Crossref 登记的 arXiv 预印本（relation.has-preprint），正式版本没有开放全文时用它 */
function arxivPreprint(message: Record<string, unknown> | undefined): string | undefined {
  const relation = message && record(message.relation) ? message.relation["has-preprint"] : undefined;
  if (!Array.isArray(relation)) return undefined;
  for (const item of relation) {
    if (record(item) && item["id-type"] === "doi" && typeof item.id === "string") {
      const id = arxivIdFromDoi(normalizeDoi(item.id) ?? "");
      if (id) return id;
    }
  }
  return undefined;
}

/** 依次尝试 Europe PMC 开放全文、arXiv 预印本全文；都取不到返回 undefined，调用方退回摘要 */
async function openFullText(doi: string, message: Record<string, unknown> | undefined, signal: AbortSignal | undefined, warnings: string[]): Promise<SourceEvidence | undefined> {
  const ownArxiv = arxivIdFromDoi(doi);
  const preprint = ownArxiv ? undefined : arxivPreprint(message);
  const attempts: [() => Promise<FullText | null>, string?][] = [];
  if (!ownArxiv) attempts.push([() => europePmcFullText(doi, signal)]);
  if (ownArxiv) attempts.push([() => arxivFullText(ownArxiv, signal)]);
  if (preprint) attempts.push([() => arxivFullText(preprint, signal), `正式发表版本没有可读取的开放全文，改用出版社登记的 arXiv 预印本 ${preprint}。`]);
  for (const [attempt, note] of attempts) {
    try {
      const full = await attempt();
      if (!full) continue;
      const crossrefTitle = Array.isArray(message?.title) && typeof message.title[0] === "string" ? stripAbstractMarkup(message.title[0]).slice(0, 500) : undefined;
      const text = normalizeEvidence(full.text);
      return {
        source: { id: "source-1", kind: full.kind, label: full.kind === "europepmc_fulltext" ? "Europe PMC 开放全文" : "arXiv 预印本全文", title: crossrefTitle || full.title,
          doi, url: full.url, retrievedAt: new Date().toISOString(), scope: "full_text", totalChars: text.length },
        text, warnings: [...warnings, ...(note ? [note] : []), ...full.warnings],
      };
    } catch {
      signal?.throwIfAborted();
      warnings.push("开放全文获取未完成，改用数据库摘要。");
    }
  }
  return undefined;
}

/**
 * DOI 证据：先查 Crossref 记录，再依次尝试 Europe PMC 开放全文和 arXiv 预印本全文，都取不到时用 Crossref / OpenAlex 摘要。
 * 只访问白名单数据源，每个数据源最多重试一次传输错误；fullText: false 时只取摘要。
 */
export async function fetchDoiEvidence(inputDoi: string, signal?: AbortSignal, options: { fullText?: boolean } = {}): Promise<SourceEvidence> {
  const doi = normalizeDoi(inputDoi);
  if (!doi) throw new ClaimError("SOURCE_UNAVAILABLE", "DOI 格式不正确");
  signal?.throwIfAborted();
  const warnings: string[] = [];
  let failed = false;
  let message: Record<string, unknown> | undefined;
  let crossrefAbstract: SourceEvidence | undefined;
  const crossref = new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (process.env.CROSSREF_MAILTO?.trim()) crossref.searchParams.set("mailto", process.env.CROSSREF_MAILTO.trim());
  try {
    const value = await fetchRecord(crossref, signal);
    if (value !== null) {
      if (!record(value) || !record(value.message) || typeof value.message.DOI !== "string" || normalizeDoi(value.message.DOI) !== doi) throw new ClaimError("SOURCE_UNAVAILABLE", "Crossref 返回记录与请求 DOI 不一致");
      message = value.message;
      const raw = value.message.abstract;
      if (typeof raw === "string" && raw.length <= MAX_ABSTRACT_CHARS) {
        const text = stripAbstractMarkup(raw);
        if (text.length >= 20) crossrefAbstract = { source: source(doi, "crossref_abstract", Array.isArray(value.message.title) ? value.message.title[0] : undefined, text), text, warnings };
      }
    }
  } catch {
    signal?.throwIfAborted();
    failed = true;
  }
  if (options.fullText !== false) {
    const full = await openFullText(doi, message, signal, warnings);
    if (full) return full;
  }
  if (crossrefAbstract) return crossrefAbstract;
  warnings.push(failed ? "Crossref 查询未完成，已尝试 OpenAlex 摘要。" : "Crossref 未提供可用摘要，已尝试 OpenAlex 摘要。");
  const openalex = new URL(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`);
  openalex.searchParams.set("select", "doi,title,abstract_inverted_index,is_retracted");
  if (process.env.OPENALEX_API_KEY?.trim()) openalex.searchParams.set("api_key", process.env.OPENALEX_API_KEY.trim());
  try {
    const value = await fetchRecord(openalex, signal);
    if (value !== null) {
      if (!record(value) || typeof value.doi !== "string" || normalizeDoi(value.doi) !== doi) throw new ClaimError("SOURCE_UNAVAILABLE", "OpenAlex 返回记录与请求 DOI 不一致");
      if (value.abstract_inverted_index !== undefined && value.abstract_inverted_index !== null) {
        const text = reconstructAbstract(value.abstract_inverted_index);
        if (text.length >= 10) {
          if (value.is_retracted === true) warnings.push("OpenAlex 将该记录标记为已撤稿；片段文字相符不代表结论可信，请人工复核。");
          return { source: source(doi, "openalex_abstract", value.title, text), text, warnings };
        }
      }
    }
  } catch {
    signal?.throwIfAborted();
    failed = true;
  }
  if (failed) throw new ClaimError("SOURCE_UNAVAILABLE", "摘要数据源查询未全部完成，无法形成证据结论；可稍后重试或提供证据正文");
  throw new ClaimError("NO_EVIDENCE", "未获取到该 DOI 的可用摘要，核查未完成；请提供合法获取的证据正文");
}
