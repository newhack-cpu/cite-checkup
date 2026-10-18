// 中文期刊论文的联网检索：用 DeepSeek 的 Search 接口（POST /v1/tools/search，DeepSeek 自研搜索引擎）
// 在知网、万方、维普三站按题名检索，从搜索结果的标题、摘要和网址里解析题名、作者、刊名、年期，
// 作为候选交给规则比对。只认这三站的期刊论文页，其他网页、学位论文页不当作候选。
// 2026-10-17 探针：10 条中文期刊引文找到 7 条，6 条命中这三站（eval/results/deepseek-search-probe-2026-10-17.json）。
// 维普的结果带作者；知网、万方的结果没有作者，同题名再查一次维普补上。没有作者的记录只能给相近候选（见 match.ts）。
import { deepseekConfiguration } from "../../ai";
import { readBoundedJson } from "../../claims/io";
import { UpstreamError } from "../http";
import { compact, normalizeText } from "../normalize";
import type { Author, WorkRecord } from "../types";

const SITES = "site:cnki.net OR site:wanfangdata.com.cn OR site:cqvip.com";
/** 接口规定 query 最多 128 个字符（含站点限定） */
const MAX_QUERY = 128;
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 600_000;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  date: string | null;
  siteName: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 调用 DeepSeek Search。只读；失败抛 UpstreamError，调用方当作“数据源暂时不可用”，不当作查不到 */
export async function deepseekSearch(query: string, count: number, signal?: AbortSignal): Promise<SearchHit[]> {
  const config = deepseekConfiguration();
  if (!config.apiKey || !config.searchEndpoint) throw new UpstreamError("DeepSeek 联网搜索尚未配置");
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(config.searchEndpoint, {
      method: "POST", redirect: "error", cache: "no-store", signal: combined,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ query: query.slice(0, MAX_QUERY), count }),
    });
  } catch {
    signal?.throwIfAborted();
    throw new UpstreamError("DeepSeek 联网搜索连接失败");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new UpstreamError(
      response.status === 402 ? "DeepSeek 账户余额不足，联网搜索未执行"
        : response.status === 429 ? "DeepSeek 联网搜索请求过于频繁" : "DeepSeek 联网搜索暂时不可用",
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await readBoundedJson(response, combined, MAX_RESPONSE_BYTES);
  } catch {
    signal?.throwIfAborted();
    throw new UpstreamError("DeepSeek 联网搜索返回了无法识别的数据", 200);
  }
  if (!isRecord(body) || !Array.isArray(body.results)) throw new UpstreamError("DeepSeek 联网搜索返回了无法识别的数据", 200);
  return body.results.filter(isRecord).map((r) => ({
    title: str(r.title).trim(), url: str(r.url).trim(), snippet: str(r.snippet), summary: str(r.summary),
    date: typeof r.date === "string" ? r.date : null, siteName: typeof r.site_name === "string" ? r.site_name : null,
  })).filter((hit) => hit.title && /^https?:\/\//i.test(hit.url));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
const onSite = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const lines = (s: string) => s.split("\n").map((line) => line.trim()).filter(Boolean);
const validYear = (y: number) => (Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear() + 1 ? y : undefined);
const issueOf = (s: string | undefined) => (s === undefined ? undefined : Number.isFinite(Number(s)) ? String(Number(s)) : s);

/** 维普作者行：汉字姓名用空格、分号或逗号分隔；夹带拉丁字母的姓名只按分号、逗号切分 */
function splitAuthors(text: string): Author[] {
  const cleaned = text.replace(/[0-9*†‡]+/g, " ").trim();
  const parts = /[A-Za-z]/.test(cleaned) ? cleaned.split(/[;；,，、]+/) : cleaned.split(/[\s;；,，、]+/);
  return parts.map(clean).filter((name) => name && name.length <= 30 && !/^(?:等|et\s*al\.?)$/i.test(name)).map((family) => ({ family }));
}

/** “《社会研究方法评论》2025年第2期1-15,共15页”或“《民俗研究》 • 1997年1期 16-34” */
function parseSource(text: string) {
  const venue = text.match(/《([^》]+)》/)?.[1]?.trim();
  const year = validYear(Number(text.match(/(\d{4})\s*年/)?.[1]));
  const volume = text.match(/第\s*(\d{1,4})\s*卷/)?.[1];
  const issue = issueOf(text.match(/(?:年|卷)\s*第?\s*([0-9]{1,3})\s*期/)?.[1]);
  const pageMatch = text.match(/期\s*[,，]?\s*(\d+)\s*[-–—~]\s*(\d+)/);
  return { venue, year, volume, issue, pages: pageMatch ? `${pageMatch[1]}-${pageMatch[2]}` : undefined };
}

/** 维普（qikan.cqvip.com、www.cqvip.com）：摘要里有“作者：”和“出处：”或“来 源：” */
export function parseCqvip(hit: SearchHit): WorkRecord | undefined {
  if (!onSite(hostOf(hit.url), "cqvip.com")) return undefined;
  const ls = lines(hit.summary);
  const heading = ls.find((line) => line.startsWith("# "));
  // 网页标题带站点后缀：“题名-文献详情-维普官网 - - 首页”“题名-维普中文科技期刊数据库”
  const title = clean((heading ? heading.slice(2) : hit.title)
    .replace(/被引量[:：]\s*\d+\s*$/, "")
    .replace(/\s*-\s*(?:文献详情\s*-\s*)?维普(?:官网|网|资讯|中文科技期刊数据库)?(?:\s*-.*)?$/, ""));
  const authorLine = ls.find((line) => /^作\s*者[:：]/.test(line));
  const authors = authorLine ? splitAuthors(authorLine.replace(/^作\s*者[:：]\s*/, "")) : [];
  // “来 源：”的值可能在下一行
  let sourceText = ls.find((line) => /^(?:出处|来\s*源)[:：].*《/.test(line)) ?? "";
  if (!sourceText) {
    const at = ls.findIndex((line) => /^(?:出处|来\s*源)[:：]\s*$/.test(line));
    if (at >= 0 && ls[at + 1]?.startsWith("《")) sourceText = ls[at + 1];
  }
  const source = parseSource(sourceText);
  if (!title || !source.venue || !source.year) return undefined;
  return { source: "web", site: "维普", title, authors, ...source, type: "journal-article", url: hit.url };
}

/** 知网（wap.cnki.net、read.cnki.net 等）：标题形如“题名-刊名2024年05期-手机知网”，没有作者 */
export function parseCnki(hit: SearchHit): WorkRecord | undefined {
  if (!onSite(hostOf(hit.url), "cnki.net")) return undefined;
  const plain = clean(hit.title.replace(/\s*[-_|]\s*(?:手机知网|中国知网|知网阅读|知网|CNKI)\s*$/i, ""));
  let title: string | undefined;
  let venue: string | undefined;
  let year: number | undefined;
  let issue: string | undefined;
  const m = plain.match(/^(.*)-([^-]+?)(\d{4})年(\d{1,2})期$/);
  if (m) {
    [title, venue] = [clean(m[1]), clean(m[2])];
    year = validYear(Number(m[3]));
    issue = issueOf(m[4]);
  } else {
    title = plain;
    // 摘要的最后两行通常是刊名和“1983年03期”
    const ls = lines(hit.summary);
    const at = ls.findIndex((line) => /^\d{4}年\d{1,2}期$/.test(line));
    if (at > 0) {
      venue = ls[at - 1].length <= 30 ? ls[at - 1] : undefined;
      const parts = ls[at].match(/^(\d{4})年(\d{1,2})期$/)!;
      year = validYear(Number(parts[1]));
      issue = issueOf(parts[2]);
    }
  }
  // 网址里的文献编号（刊物代码 + 年 + 期 + 序号）也带年期：SHEH198303003
  if (!year) {
    const code = hit.url.match(/\/([A-Z]{2,8})(\d{4})(\d{2})\d{3}(?:\.html?)?(?:[?#]|$)/);
    if (code) {
      year = validYear(Number(code[2]));
      issue = issueOf(code[3]);
    }
  }
  if (!title || !year) return undefined;
  return { source: "web", site: "知网", title, authors: [], venue, year, issue, type: "journal-article", url: hit.url };
}

/** 万方（d.wanfangdata.com.cn/periodical/刊物代码+年+期+序号）：只认期刊论文页，没有作者 */
export function parseWanfang(hit: SearchHit): WorkRecord | undefined {
  if (!onSite(hostOf(hit.url), "wanfangdata.com.cn")) return undefined;
  let path = "";
  try {
    path = new URL(hit.url).pathname;
  } catch {
    return undefined;
  }
  const code = path.match(/^\/periodical\/([a-z][a-z0-9]*?)(\d{4})(\d{2})(\d{3})$/i);
  if (!code) return undefined;
  const title = clean(hit.title.replace(/\s*[-_|]\s*万方数据.*$/, ""));
  const year = validYear(Number(code[2]));
  if (!title || !year) return undefined;
  return { source: "web", site: "万方", title, authors: [], year, issue: issueOf(code[3]), type: "journal-article", url: hit.url };
}

export function parseHits(hits: SearchHit[]): WorkRecord[] {
  const records: WorkRecord[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const rec = parseCqvip(hit) ?? parseCnki(hit) ?? parseWanfang(hit);
    if (!rec || seen.has(hit.url)) continue;
    seen.add(hit.url);
    records.push(rec);
  }
  return records;
}

/** 题名基本一致：去掉空白和标点后相同，或一方包含另一方且长度相差不到一成（副标题分隔符“——”“：”写法不同） */
export function sameTitle(a: string, b: string): boolean {
  const x = compact(normalizeText(a)).replace(/ /g, "");
  const y = compact(normalizeText(b)).replace(/ /g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length >= long.length * 0.9;
}

/**
 * 按题名在知网、万方、维普三站检索，返回解析出的期刊论文记录（有作者的排在前面）。
 * 命中的同题名记录都没有作者时，再只查一次维普，补上带作者的记录。
 */
export async function cnJournalSearch(title: string, signal?: AbortSignal): Promise<{ records: WorkRecord[]; searches: number }> {
  const query = clean(title).slice(0, MAX_QUERY - SITES.length - 1);
  const records = parseHits(await deepseekSearch(`${query} ${SITES}`, 8, signal));
  let searches = 1;
  const strong = records.filter((rec) => sameTitle(rec.title, title));
  if (strong.length && !strong.some((rec) => rec.authors.length)) {
    const extra = parseHits(await deepseekSearch(`${query} site:cqvip.com`, 5, signal));
    searches++;
    for (const rec of extra) if (!records.some((r) => r.url === rec.url)) records.push(rec);
  }
  records.sort((a, b) => Number(b.authors.length > 0) - Number(a.authors.length > 0));
  return { records, searches };
}
