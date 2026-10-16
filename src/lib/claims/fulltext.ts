// Server only. 开放获取全文：Europe PMC 的 JATS XML 全文、arXiv 预印本 PDF。
// 只访问固定的白名单主机，不跟随跳转；大小、时间都有上限。PDF 走与文档导入相同的安全解析器（含隐藏文字检测）。
// 取不到全文时返回 null，由调用方退回摘要；全文出错不会让整次核查失败。
import { SaxesParser } from "saxes";
import { importDocument } from "../documents/import";
import { ClaimError } from "./errors";
import { readBoundedBytes, readBoundedJson, retryableTransport, withDeadline } from "./io";
import { normalizeDoi, record } from "./request";
import { normalizeEvidence } from "./retrieval";

const ALLOWED_HOSTS = new Set(["www.ebi.ac.uk", "export.arxiv.org"]);
const MAX_XML_BYTES = 6 * 1024 * 1024;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
/** 证据正文上限是 160,000 字符，留一点余量给标题 */
export const MAX_FULLTEXT_CHARS = 150_000;

export interface FullText {
  kind: "europepmc_fulltext" | "arxiv_fulltext";
  text: string;
  title?: string;
  url: string;
  warnings: string[];
}

async function fetchAllowed(url: URL, accept: string, parent: AbortSignal | undefined, ms: number, read: (response: Response, signal: AbortSignal) => Promise<unknown>) {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port) {
    throw new ClaimError("SOURCE_UNAVAILABLE", "全文数据源不在允许范围内");
  }
  return withDeadline(async (signal) => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url.toString(), { signal, redirect: "error", cache: "no-store", headers: { Accept: accept, "User-Agent": "cite-checkup/0.1 academic-evidence-check" } });
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (attempt === 0 && retryableTransport(error)) continue;
        throw new ClaimError("SOURCE_UNAVAILABLE", "开放全文数据源连接失败");
      }
    }
    if (!response) throw new ClaimError("SOURCE_UNAVAILABLE", "开放全文数据源连接失败");
    if (response.status === 404) { void response.body?.cancel().catch(() => {}); return null; }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ClaimError("SOURCE_UNAVAILABLE", "开放全文数据源暂时不可用");
    }
    return read(response, signal);
  }, parent, ms);
}

// ---- Europe PMC：JATS XML ----

// 只保留正文：题名、摘要、各节标题和段落、图表标题；参考文献、表格内容、公式、作者信息等跳过
const SKIP = new Set(["ref-list", "back", "table", "thead", "tbody", "disp-formula", "inline-formula", "mml:math", "tex-math", "contrib-group", "aff", "author-notes",
  "fn-group", "permissions", "funding-group", "journal-meta", "history", "kwd-group", "supplementary-material", "object-id", "pub-date", "counts", "custom-meta-group",
  "processing-meta"]);
const BLOCKS = new Set(["p", "title", "article-title", "caption", "list-item", "def", "term", "label", "table-wrap", "fig", "sec"]);
// <front> 里只要题名和摘要；文章编号、卷期、日期、期刊信息等元数据不进正文
const FRONT_KEEP = new Set(["title-group", "abstract", "trans-abstract"]);

/** JATS XML → 纯文本（"## 节标题" + 段落）。拒绝带内部子集的 DOCTYPE，层级和元素数有上限 */
export function jatsToText(xml: string): { title?: string; text: string } {
  const parser = new SaxesParser();
  const path: string[] = [];
  const lines: string[] = [];
  let skip = 0;
  let elements = 0;
  let buffer = "";
  let title: string | undefined;
  let inArticleTitle = false;
  const flush = (prefix = "") => {
    const line = buffer.replace(/\s+/g, " ").trim();
    if (line) lines.push(prefix + line);
    buffer = "";
  };
  parser.on("doctype", (doctype) => {
    if (doctype.includes("[")) throw new ClaimError("SOURCE_UNAVAILABLE", "全文 XML 含内部实体声明，已拒绝");
  });
  parser.on("opentag", (tag) => {
    if (++elements > 300_000 || path.length > 200) throw new ClaimError("SOURCE_UNAVAILABLE", "全文 XML 结构过于复杂");
    path.push(tag.name);
    if (skip || SKIP.has(tag.name)) { skip++; return; }
    if (tag.name === "article-title" && path.includes("title-group") && title === undefined) inArticleTitle = true;
    if (BLOCKS.has(tag.name) || tag.name === "abstract") flush();
    if (tag.name === "abstract" && !path.slice(0, -1).includes("abstract")) lines.push("## Abstract");
  });
  parser.on("closetag", (tag) => {
    path.pop();
    if (skip) { skip--; return; }
    if (tag.name === "article-title" && inArticleTitle) {
      title = buffer.replace(/\s+/g, " ").trim() || undefined;
      buffer = "";
      inArticleTitle = false;
      return;
    }
    // 节标题单独成行并加 "## "，方便模型和用户看到片段出自哪一节
    if (tag.name === "title" && path.at(-1) === "sec") flush("## ");
    else if (BLOCKS.has(tag.name)) flush();
  });
  const text = (value: string) => {
    if (skip) return;
    if (path.includes("front") && !path.some((name) => FRONT_KEEP.has(name))) return;
    buffer += value;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.write(xml).close();
  flush();
  return { title, text: normalizeEvidence(lines.join("\n")) };
}

export async function europePmcFullText(doi: string, signal?: AbortSignal): Promise<FullText | null> {
  const search = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  search.searchParams.set("query", `DOI:"${doi}"`);
  search.searchParams.set("format", "json");
  search.searchParams.set("resultType", "lite");
  search.searchParams.set("pageSize", "1");
  const found = await fetchAllowed(search, "application/json", signal, 12_000, (response, s) => readBoundedJson(response, s, 200_000));
  const hit = record(found) && record(found.resultList) && Array.isArray(found.resultList.result) ? found.resultList.result[0] : undefined;
  if (!record(hit) || typeof hit.doi !== "string" || normalizeDoi(hit.doi) !== doi) return null;
  // 只有开放获取子集（isOpenAccess=Y 且全文在 Europe PMC）才提供全文 XML
  if (typeof hit.pmcid !== "string" || !/^PMC\d{1,10}$/.test(hit.pmcid) || hit.isOpenAccess !== "Y" || hit.inEPMC !== "Y") return null;
  const url = new URL(`https://www.ebi.ac.uk/europepmc/webservices/rest/${hit.pmcid}/fullTextXML`);
  const bytes = await fetchAllowed(url, "application/xml", signal, 20_000, (response, s) => readBoundedBytes(response, s, MAX_XML_BYTES, /^(?:application|text)\/xml\b/i));
  if (!bytes) return null;
  const { title, text } = jatsToText(new TextDecoder("utf-8", { fatal: true }).decode(bytes as Uint8Array));
  if (text.length < 500) return null;
  const warnings = ["证据来自 Europe PMC 的开放获取全文（JATS XML），已去掉参考文献列表、表格内容和公式；图表只保留标题。"];
  const clipped = text.length > MAX_FULLTEXT_CHARS;
  if (clipped) warnings.push(`全文较长，只取前 ${MAX_FULLTEXT_CHARS.toLocaleString()} 个字符，后面的章节未参与检索。`);
  return { kind: "europepmc_fulltext", text: clipped ? text.slice(0, MAX_FULLTEXT_CHARS) : text, title, url: `https://europepmc.org/article/PMC/${hit.pmcid}`, warnings };
}

// ---- arXiv：预印本 PDF ----

const ARXIV_ID_RE = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;

/** DOI 10.48550/arXiv.2507.06185 → 2507.06185；不是 arXiv DOI 时返回 undefined */
export function arxivIdFromDoi(doi: string): string | undefined {
  const id = doi.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  return id && ARXIV_ID_RE.test(id) ? id : undefined;
}

export async function arxivFullText(id: string, signal?: AbortSignal): Promise<FullText | null> {
  if (!ARXIV_ID_RE.test(id)) return null;
  const url = new URL(`https://export.arxiv.org/pdf/${id}`);
  const bytes = await fetchAllowed(url, "application/pdf", signal, 30_000, (response, s) => readBoundedBytes(response, s, MAX_PDF_BYTES, /^application\/pdf\b/i));
  if (!bytes) return null;
  signal?.throwIfAborted();
  let imported;
  try {
    imported = await importDocument(new File([bytes as Uint8Array<ArrayBuffer>], `arxiv-${id.replace(/\//g, "_")}.pdf`, { type: "application/pdf" }), signal);
  } catch {
    signal?.throwIfAborted();
    return null;
  }
  const warnings = ["证据来自 arXiv 预印本 PDF 的文字层，可能与正式发表的版本不同；公式、表格和图片未读取，多栏排版可能打乱顺序。"];
  if (imported.hidden) {
    warnings.push(`该 PDF 含 ${imported.hidden.total} 处读者看不见的隐藏文字${imported.hidden.instructions ? `（其中 ${imported.hidden.instructions} 处像写给 AI 的指令）` : ""}，已从证据中排除。`);
  }
  const text = imported.text;
  const clipped = text.length > MAX_FULLTEXT_CHARS;
  if (clipped) warnings.push(`全文较长，只取前 ${MAX_FULLTEXT_CHARS.toLocaleString()} 个字符，后面的章节未参与检索。`);
  if (text.length < 500) return null;
  return { kind: "arxiv_fulltext", text: clipped ? text.slice(0, MAX_FULLTEXT_CHARS) : text, url: `https://arxiv.org/abs/${id}`, warnings };
}
