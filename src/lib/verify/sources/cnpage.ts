// 补作者用的原文页面。DeepSeek 搜索接口在知网、万方找到的结果没有作者，这里直接请求原文页面补上（不经过模型）：
// 1. 手机知网文章页（wap.cnki.net/touch/web/Journal/Article/编号.html）：服务端渲染时内嵌的数据带作者、刊名、年、期。
//    2026-10-19 实测 23 条取到 22 条；知网阅读页 read.cnki.net 已改为 404，DeepSeek 的 Fetch 取回的正文也没有作者。
//    知网页面上的页码多是期内页码，和引文、印刷版的卷内页码对不上（23 条里只有 1 条一致），所以不取页码。
// 2. 期刊官网的文章页：citation_* / DC.* / PRISM 元数据（作者、刊名、卷、期、页、DOI、ISSN）。
// 3. 知网的期刊页：刊物的 ISSN，供 Crossref 按卷、页定位。
// 只读、不登录、不碰验证码页，请求头如实写明是本工具；有的期刊官网会拒绝这样的请求（HTTP 403），这时跳过。
// 学校 WebVPN 镜像、文库、学术搜索聚合站、机构知识库这类转载站一律不当来源。
// 网址来自搜索结果，服务器替用户去请求：只请求公网地址，跳转逐跳检查，防止被引去访问本机、内网或云服务器元数据地址（SSRF）。

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readBoundedBytes } from "../../claims/io";
import { decodeEntities, isCjk, stripTags } from "../normalize";
import { Gate, TtlCache } from "../throttle";
import type { Author, WorkRecord } from "../types";
import { cnkiArticleCode } from "./cnweb";

const USER_AGENT = "Mozilla/5.0 (compatible; cite-checkup/0.1; +https://github.com/newhack-cpu/cite-checkup)";
// 知网页面平时 1 秒内返回，偶尔要 10 秒以上（2026-10-19 本机实测）；单条文献另有总时限
const PAGE_TIMEOUT_MS = 12_000;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

/** 本机、内网、链路本地（含云服务器元数据 169.254.169.254）、组播和保留地址 */
export function privateAddress(address: string): boolean {
  const ip = /^::ffff:/i.test(address) && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
}

/** 不能请求时返回原因：只允许 http(s)、默认端口、不带账号，主机名解析出的每个地址都要是公网地址 */
export async function unsafeTarget(url: URL, resolve: typeof lookup = lookup): Promise<string | undefined> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "网址协议不支持";
  if (url.username || url.password) return "网址带账号信息";
  if (url.port && url.port !== "80" && url.port !== "443") return "网址端口不是常见的网页端口";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return privateAddress(host) ? "网址指向本机或内网地址" : undefined;
  try {
    const addresses = await resolve(host, { all: true, verbatim: true });
    return addresses.length && addresses.every((a) => !privateAddress(a.address)) ? undefined : "网址指向本机或内网地址";
  } catch {
    return "网址的域名解析失败";
  }
}

export interface PageResult<T> {
  value?: T;
  /** 没取到时的原因，写进核查步骤 */
  reason?: string;
}

// 同一网站同时最多 2 个请求、相邻两次至少隔 300 毫秒
const gates = new Map<string, Gate>();
function gateFor(host: string): Gate {
  let gate = gates.get(host);
  if (!gate) {
    gate = new Gate(2, 300);
    gates.set(host, gate);
  }
  return gate;
}
// 取到的结果缓存 6 小时；页面不存在、拒绝访问这类确定的失败缓存 10 分钟；超时、连接失败不缓存
const hits = new TtlCache<PageResult<unknown>>(6 * 60 * 60 * 1000, 500);
const misses = new TtlCache<PageResult<unknown>>(10 * 60 * 1000, 500);

/** 只给测试用：清空页面缓存 */
export function clearPageCache(): void {
  hits.clear();
  misses.clear();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
const onSite = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

// 学术搜索、聚合平台、文库和资讯站：内容是转载或索引，不是期刊自己发布的页面
const REPRINT_DOMAINS = [
  "baidu.com", "doc88.com", "docin.com", "book118.com", "renrendoc.com", "taodocs.com", "wenmi.com", "360doc.com", "mbalib.com",
  "zhihu.com", "csdn.net", "sohu.com", "163.com", "sina.com.cn", "qq.com", "jianshu.com", "toutiao.com",
  "google.com", "semanticscholar.org", "researchgate.net", "academia.edu", "x-mol.com", "ebsco.com", "ingentaconnect.com",
  "doaj.org", "worldcat.org", "napstic.cn", "sciencechina.cn", "nstl.gov.cn", "chaoxing.com", "duxiu.com", "airitilibrary.com",
  "oriprobe.com", "zgkjqk.com", "cjwk.cn", "hnstl.cn", "cnpiec.com.cn", "istic.ac.cn",
  // 2026-10-19 试跑时在不限站点的检索结果里见到的聚合站：掌桥科研、太学术、科研之友、FAO 的 AGRIS、图书馆目录
  "zhangqiaokeyan.com", "taixueshu.com", "scholarmate.com", "fao.org", "mzk.cz", "cas.cz", "infona.pl",
  "xueshu.com", "people.com.cn", "yunscholar.com",
];
// 中文期刊三站另有专门的解析，不当作期刊官网
const DATABASE_DOMAINS = ["cnki.net", "cnki.com.cn", "wanfangdata.com.cn", "cqvip.com"];

/**
 * 转载站：学校 WebVPN 镜像（wap-cnki-net-443.webvpn.imac.edu.cn）、端口写进主机名的代理镜像、聚合站和文库、
 * 机构知识库和个人主页（ir.、faculty. 开头，或 /handle/ 路径）
 */
export function reprintSite(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (/(?:^|[.-])(?:web)?vpn(?:[.-]|\d)/.test(host) || /-(?:443|80|8080)[.-]/.test(host)) return true;
  if (REPRINT_DOMAINS.some((d) => onSite(host, d))) return true;
  if (/^(?:ir|dspace|repository|eprints|faculty|people|teacher|homepage|lib|library|opac|scholar|libdb|irlib)\./.test(host)) return true;
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return true;
  }
  return /\/handle\/\d|\/items?\/\d/.test(path);
}

/** 可以当作期刊官网文章页去取元数据的网址：不是转载站，也不是知网、万方、维普；全文 PDF 的下载链接不读 */
export function officialCandidate(url: string): boolean {
  const host = hostOf(url);
  return /^https?:/i.test(url) && !reprintSite(url) && !DATABASE_DOMAINS.some((d) => onSite(host, d))
    && !/\.pdf(?:$|[?#])|attachType=PDF|downloadArticleFile|\/pdf\//i.test(url);
}

/** 搜索结果的网址常在末尾带“#1”这样的片段，同一页面会出现两次；请求和缓存都去掉 */
export function pageUrl(url: string): string {
  return url.split("#")[0];
}

function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096));
  const declared = contentType?.match(/charset=["']?([\w-]+)/i)?.[1] ?? head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? "utf-8";
  const charset = declared.toLowerCase() === "gb2312" ? "gbk" : declared.toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

interface Fetched {
  html?: string;
  finalUrl?: string;
  reason?: string;
  /** 超时、连接失败、限流：不缓存，下次可以再试 */
  transient?: boolean;
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<Fetched> {
  const host = hostOf(url);
  if (!host) return { reason: "网址无效" };
  return gateFor(host).run(async (): Promise<Fetched> => {
    const timeout = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    // 自己处理跳转：每一跳的目标都先检查是不是公网地址
    let finalUrl = url;
    let response: Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const blocked = await unsafeTarget(new URL(finalUrl));
      if (blocked) return { reason: `${blocked}，已跳过` };
      try {
        response = await fetch(finalUrl, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
          redirect: "manual", cache: "no-store", signal: combined,
        });
      } catch {
        signal?.throwIfAborted();
        return { reason: timeout.aborted ? "页面连接超时" : "页面连接失败", transient: true };
      }
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) break;
      void response.body?.cancel().catch(() => {});
      try {
        finalUrl = new URL(location, finalUrl).toString();
      } catch {
        return { reason: "页面跳转的网址无效" };
      }
      response = undefined;
    }
    if (!response) return { reason: "页面跳转次数过多，已跳过" };
    // 跳到登录、验证码或镜像页面的不读
    if (/(?:^|\/)(?:verify|captcha|login|signin|passport|sso|auth)(?=[/.?]|$)/i.test(new URL(finalUrl).pathname) || reprintSite(finalUrl)) {
      void response.body?.cancel().catch(() => {});
      return { reason: "页面要求登录或验证，已跳过" };
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { reason: `页面返回 HTTP ${response.status}`, transient: response.status === 429 || response.status >= 500 };
    }
    try {
      const bytes = await readBoundedBytes(response, combined, MAX_PAGE_BYTES, /^(?:text\/html|application\/xhtml\+xml)\b/i);
      return { html: decodeHtml(bytes, response.headers.get("content-type")), finalUrl };
    } catch {
      signal?.throwIfAborted();
      return timeout.aborted ? { reason: "页面读取超时", transient: true } : { reason: "页面格式或大小不符合要求" };
    }
  }, signal);
}

/** 取页面并解析；结果按网址缓存 */
async function cachedPage<T>(address: string, signal: AbortSignal | undefined, parse: (html: string, finalUrl: string) => PageResult<T>): Promise<PageResult<T>> {
  const url = pageUrl(address);
  const cached = (hits.get(url) ?? misses.get(url)) as PageResult<T> | undefined;
  if (cached) return cached;
  const page = await fetchHtml(url, signal);
  if (!page.html) {
    const result = { reason: page.reason ?? "页面没有取到" };
    if (!page.transient) misses.set(url, result);
    return result;
  }
  const result = parse(page.html, page.finalUrl ?? url);
  (result.value ? hits : misses).set(url, result);
  return result;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clean = (s: string) => decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();
const validYear = (y: number) => (Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear() + 1 ? y : undefined);
const issueOf = (s: string | undefined) => {
  const v = s?.trim();
  if (!v) return undefined;
  return /^\d+$/.test(v) ? String(Number(v)) : v;
};

/** Nuxt 把服务端数据压成一个数组，对象和数组里存的是元素下标 */
function nuxtData(html: string): { list: unknown[]; at: (v: unknown) => unknown } | undefined {
  const m = html.match(/<script[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return undefined;
  let list: unknown;
  try {
    list = JSON.parse(m[1]);
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  const items = list;
  const at = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < items.length ? items[v] : v);
  return { list: items, at };
}

/** 作者字段：每项一个姓名，也见过“李进龙,陈东敬”整串放在一项里；去掉上标数字和星号 */
function splitNames(values: string[]): Author[] {
  const names = values
    .flatMap((v) => clean(v).split(/[,，;；、]+/))
    .map((n) => n.replace(/[\d*†‡#§¶]+/g, "").replace(/\s+/g, isCjkName(n) ? "" : " ").trim())
    .filter((n) => n.length >= 2 && n.length <= 40 && !/^(?:等|et\s*al\.?)$/i.test(n));
  // 中英文两套署名并存时只留汉字姓名
  const han = names.filter(isCjkName);
  return [...new Set(han.length ? han : names)].map((family) => ({ family }));
}

function isCjkName(s: string): boolean {
  return isCjk(s.trim()[0] ?? "");
}

/** 手机知网文章页 → 记录：题名、作者、刊名、年、期；不取页码（见文件开头） */
export function parseCnkiArticle(html: string, code: string, url: string): PageResult<WorkRecord> {
  let title: string | undefined;
  let venue: string | undefined;
  let year: number | undefined;
  let issue: string | undefined;
  let authorValues: string[] = [];
  const data = nuxtData(html);
  const info = data?.list.find((v): v is Record<string, unknown> => isRecord(v) && "fileName" in v && "title" in v && "author" in v);
  if (data && info) {
    const text = (key: string) => {
      const v = data.at(info[key]);
      return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
    };
    if ((text("fileName") ?? "").toUpperCase() !== code) return { reason: "页面上的文献编号与链接不一致" };
    title = text("title");
    venue = text("publishName");
    year = validYear(Number(text("year")));
    issue = issueOf(text("period"));
    const list = data.at(info.author);
    authorValues = (Array.isArray(list) ? list.map(data.at) : [list]).filter((v): v is string => typeof v === "string");
  } else {
    // 没有内嵌数据时退回网页标题（“题名-刊名2020年03期-手机知网”）和作者链接
    const heading = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s*-\s*手机知网\s*$/, "");
    const m = heading.match(/^(.*)-([^-]+?)(\d{4})年([0-9A-Z]{1,3})期$/);
    if (m) {
      [title, venue] = [m[1].trim(), m[2].trim()];
      year = validYear(Number(m[3]));
      issue = issueOf(m[4]);
    }
    authorValues = [...html.matchAll(/Scholar\/Index\/\?code=[^"'&]*&(?:amp;)?name=([^"'&<]+)/g)].map((x) => decodeURIComponent(x[1]));
  }
  title = title ? clean(title) : undefined;
  if (!title || !year) return { reason: "页面上没有可解析的题名和年份" };
  const authors = splitNames(authorValues);
  if (!authors.length) return { reason: "页面上没有作者信息" };
  return {
    value: { source: "web", site: "知网", title, authors, venue: venue ? clean(venue) : undefined, year, issue, type: "journal-article", url },
  };
}

/** 按知网文献编号取手机知网文章页 */
export function fetchCnkiArticle(code: string, signal?: AbortSignal): Promise<PageResult<WorkRecord>> {
  const url = `https://wap.cnki.net/touch/web/Journal/Article/${code}.html`;
  return cachedPage(url, signal, (html, finalUrl) => {
    if (!onSite(hostOf(finalUrl), "cnki.net")) return { reason: "页面跳转到了知网以外的网站" };
    return parseCnkiArticle(html, code, url);
  });
}

/** 知网的期刊页 → ISSN（刊物代码就是文献编号开头的字母） */
export function parseCnkiJournalIssn(html: string, journalCode: string): PageResult<string> {
  const data = nuxtData(html);
  const info = data?.list.find((v): v is Record<string, unknown> => isRecord(v) && "issn" in v && "code" in v && data.at(v.code) === journalCode);
  const issn = info && data ? data.at(info.issn) : undefined;
  return typeof issn === "string" && /^\d{4}-\d{3}[\dX]$/i.test(issn.trim()) ? { value: issn.trim().toUpperCase() } : { reason: "期刊页上没有 ISSN" };
}

export function fetchCnkiJournalIssn(journalCode: string, signal?: AbortSignal): Promise<PageResult<string>> {
  if (!/^[A-Z]{2,8}$/.test(journalCode)) return Promise.resolve({ reason: "刊物代码无效" });
  return cachedPage(`https://wap.cnki.net/touch/web/Journal/Index/${journalCode}.html`, signal, (html) => parseCnkiJournalIssn(html, journalCode));
}

export interface ArticleMeta {
  /** 页面登记的题名（中英文两套时都在） */
  titles: string[];
  authors: Author[];
  venue?: string;
  /** 第一项为刊期年份，其余为在线首发等其他日期的年份 */
  years: number[];
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  issn: string[];
}

/** 读 <meta> 标签的 name / property 和 content，属性顺序不限 */
function metaTags(head: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
    const name = (attrs.get("name") ?? attrs.get("property") ?? attrs.get("itemprop"))?.toLowerCase();
    const content = attrs.get("content");
    if (!name || content === undefined) continue;
    const value = clean(content);
    if (value) out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

/** 期刊官网文章页的元数据：citation_*（Highwire）、DC.*（Dublin Core）、prism.*；DC.source 形如“工程力学, 2021, Vol. 38, Issue 9, Pages: 146-160” */
export function parseArticleMeta(html: string, url = ""): ArticleMeta | undefined {
  const end = html.search(/<\/head>/i);
  const meta = metaTags(end > 0 ? html.slice(0, end) : html.slice(0, 500_000));
  const all = (...names: string[]) => names.flatMap((n) => meta.get(n) ?? []);
  const first = (...names: string[]) => all(...names)[0];
  const source = first("dc.source", "dcterms.source") ?? "";

  const titles = [...new Set(all("citation_title", "dc.title", "dcterms.title"))];
  let authors = splitNames(all("citation_author"));
  if (!authors.length) {
    // citation_authors 一个标签放全部作者，中英文两套时各占一个，优先用汉字的那个
    const joined = all("citation_authors");
    const chosen = joined.find((v) => /\p{Script=Han}/u.test(v)) ?? joined[0];
    authors = chosen ? splitNames([chosen]) : [];
  }
  if (!authors.length) authors = splitNames(all("dc.creator", "dcterms.creator"));
  if (!authors.length) authors = splitNames(all("dc.contributor"));

  const venue = first("citation_journal_title", "prism.publicationname") ?? (source.split(/[,，]/)[0]?.trim() || undefined);
  const years = [
    source.match(/(?:^|[,，]\s*)((?:19|20)\d{2})(?=\s*[,，]|$)/)?.[1],
    ...all("citation_date", "citation_publication_date", "prism.publicationdate", "dc.date", "citation_online_date").map((d) => d.match(/\b((?:19|20)\d{2})\b/)?.[1]),
  ].map((y) => validYear(Number(y))).filter((y): y is number => y !== undefined);

  // 勤云、玛格泰克平台的文章网址里写着年、卷、期、起始页：/Y2023/V34/I11/2958、/Y2021/I9/146
  const path = url.match(/\/Y((?:19|20)\d{2})(?:\/V(\d{1,4}))?\/I([0-9A-Za-z]{1,4})\/(\d{1,6})(?:$|[/?#])/i);
  // 卷号、期号写成 0 的是平台没填（农业环境科学学报的页面），当作没有
  const nonZero = (v?: string) => (v && !/^0+$/.test(v.trim()) ? v.trim() : undefined);
  const volume = nonZero(first("citation_volume", "prism.volume") ?? source.match(/\bVol\.?\s*(\d{1,4})/i)?.[1] ?? source.match(/第\s*(\d{1,4})\s*卷/)?.[1] ?? path?.[2]);
  const issue = issueOf(nonZero(first("citation_issue", "prism.number") ?? source.match(/\b(?:Issue|No)\.?\s*([0-9A-Za-z]{1,4})\b/i)?.[1] ?? source.match(/第\s*([0-9A-Za-z]{1,4})\s*期/)?.[1] ?? path?.[3]));
  const firstPage = first("citation_firstpage", "prism.startingpage") ?? source.match(/Pages?\s*[:：]?\s*(\d+)/i)?.[1] ?? path?.[4];
  const lastPage = first("citation_lastpage", "prism.endingpage") ?? source.match(/Pages?\s*[:：]?\s*\d+\s*[-–—~]\s*(\d+)/i)?.[1];
  // 只认普通页码或文章号；“122513-125”这类拼了文章号的写法（水生生物学报的页面）不取，免得拼进规范写法
  const plainPage = (p?: string) => (p && /^[A-Za-z]?\d{1,7}$/.test(p.trim()) ? p.trim() : undefined);
  const pageFrom = plainPage(firstPage);
  const pageTo = plainPage(lastPage);
  const pages = pageFrom ? (pageTo && pageTo !== pageFrom ? `${pageFrom}-${pageTo}` : pageFrom) : undefined;
  const doi = [first("citation_doi", "prism.doi"), ...all("dc.identifier", "dcterms.identifier")]
    .map((d) => d?.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").trim().toLowerCase())
    .find((d) => !!d && /^10\.\d{4,9}\/\S+$/.test(d));
  const issn = [...new Set(all("citation_issn", "prism.issn", "prism.eissn").map((s) => s.trim().toUpperCase()).filter((s) => /^\d{4}-\d{3}[\dX]$/.test(s)))];
  if (!titles.length || !venue) return undefined;
  if (path && !years.includes(Number(path[1]))) years.push(Number(path[1]));
  // 页面上期刊自己写的刊期行里的年份是刊期年份：“地球科学进展, 2023, 38(1): 57-69”“地球科学进展 ›› 2023, Vol. 38 ›› Issue (1)”
  // “Acta Agronomica Sinica, 2023, 49(4): 1065-1078”。元数据的日期空着（地球科学进展），或只写了在线首发日期
  // （作物学报写的是前一年的 2022-09-15）时，以刊期行为准，元数据里的其他年份留作其他日期
  if (volume) {
    const text = decodeEntities(stripTags(html)).replace(/\s+/g, " ");
    const name = venue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 不带刊名的写法（英文刊名）要卷、期、起始页都对上，免得取到页面参考文献里别的文章
    const exact = pageFrom ? `${issue ? `\\s*[(（]\\s*0*${issue}\\s*[)）]` : ""}\\s*[:：]\\s*0*${pageFrom}(?!\\d)` : undefined;
    const line = text.match(new RegExp(`${name}[^0-9\\p{Script=Han}]{0,8}((?:19|20)\\d{2})\\s*[,，]\\s*(?:Vol\\.?\\s*|第\\s*)?0*${volume}(?!\\d)`, "u"))
      ?? (exact ? text.match(new RegExp(`[,，]\\s*((?:19|20)\\d{2})\\s*[,，]\\s*0*${volume}${exact}`, "u")) : null);
    const year = validYear(Number(line?.[1]));
    if (year) years.unshift(year);
  }
  return { titles, authors, venue, years: [...new Set(years)], volume, issue, pages, doi, issn };
}

/** 期刊官网文章页 → 记录。题名有中英文两套时，取与引文同语种的那个 */
export function fetchJournalArticle(url: string, citedTitleHan: boolean, signal?: AbortSignal): Promise<PageResult<WorkRecord>> {
  if (!officialCandidate(url)) return Promise.resolve({ reason: "转载站或数据库页面，不作为期刊官网来源" });
  return cachedPage(url, signal, (html, finalUrl) => {
    const meta = parseArticleMeta(html, finalUrl);
    if (!meta) return { reason: "页面没有文章元数据" };
    if (!meta.authors.length) return { reason: "页面元数据里没有作者" };
    const title = meta.titles.find((t) => /\p{Script=Han}/u.test(t) === citedTitleHan) ?? meta.titles[0];
    const [year, ...years] = meta.years;
    return {
      value: {
        source: "web", site: "期刊官网", title, authors: meta.authors, venue: meta.venue, year, years: years.length ? years : undefined,
        volume: meta.volume, issue: meta.issue, pages: meta.pages, doi: meta.doi, issn: meta.issn.length ? meta.issn : undefined,
        type: "journal-article", url: finalUrl,
      },
    };
  });
}

/** 知网文献编号开头的字母是刊物代码 */
export function cnkiJournalCode(url: string): string | undefined {
  return cnkiArticleCode(url)?.match(/^([A-Z]{2,8})\d{4}/)?.[1];
}
