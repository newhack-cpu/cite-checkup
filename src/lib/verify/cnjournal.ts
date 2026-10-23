// 中文期刊论文的联网核查：标准体检里 Crossref 没确认时的一步，AI 检索复核时也走这里（结果有缓存）。
// 1. DeepSeek 搜索接口（DeepSeek 自研的搜索引擎，不是大模型）在知网、万方、维普按题名找论文页；
// 2. 补作者，拿到足以下结论的记录就停：维普结果自带作者 → 手机知网文章页 → 再查一次维普 → 不限站点找期刊官网文章页的元数据
//    → Crossref（刊物在 Crossref 注册了 DOI 时，按 ISSN、年、卷、起始页定位，作者用汉字 ↔ 拼音比对）。
// 搜索结果和页面只提供候选，哪一篇算同一篇、算不算核实，仍由 match.ts 的规则决定；查不到不说明文献不存在。
// 没配置 DeepSeek 密钥时整步跳过，结论照旧。

import { deepseekConfiguration } from "../ai";
import { nameOnly, notReference, parseReference } from "./extract";
import { UpstreamError } from "./http";
import { formatAuthorsShort, scoreCandidate, webVerdict } from "./match";
import { romanizeHanName } from "./romanize";
import { cnkiJournalCode, fetchCnkiArticle, fetchCnkiJournalIssn, fetchJournalArticle, officialCandidate, pageUrl } from "./sources/cnpage";
import { cnSiteSearch, cnkiArticleCode, cqvipSearch, openWebSearch, parseHits, sameTitle } from "./sources/cnweb";
import { crossrefByDoi, crossrefJournalWorks } from "./sources/crossref";
import type { CheckStep, ParsedRef, WorkRecord } from "./types";

/** 一次核查请求共用的额度：还能查几条中文期刊；deadline 是整个请求的时限（毫秒时间戳），没有就不限 */
export interface CnBudget {
  left: number;
  deadline?: number;
}

export const CN_LIMITS = {
  /** 单条文献联网核查的总时限 */
  itemMs: 25_000,
  /** 离请求时限不到这么久就不再开始新的联网核查 */
  minStartMs: 8_000,
  /** 单条时限要在请求时限之前留出的余量 */
  reserveMs: 2_000,
  /** 每条最多读几个知网文章页、几个期刊官网页面 */
  cnkiPages: 2,
  officialPages: 2,
  /** 一次核查请求默认最多联网核查几条中文期刊（环境变量 CN_SEARCH_BUDGET 可改） */
  perRequest: 30,
};

export function cnSearchConfigured(): boolean {
  const { apiKey, searchEndpoint } = deepseekConfiguration();
  return !!apiKey && !!searchEndpoint;
}

/** 一次核查请求的默认额度 */
export function defaultCnBudget(deadline?: number): CnBudget | undefined {
  if (!cnSearchConfigured()) return undefined;
  const n = Number(process.env.CN_SEARCH_BUDGET ?? CN_LIMITS.perRequest);
  return { left: Number.isFinite(n) ? Math.max(0, Math.min(80, Math.floor(n))) : CN_LIMITS.perRequest, deadline };
}

const hanCount = (s?: string) => s?.match(/\p{Script=Han}/gu)?.length ?? 0;
const journalish = (r: ParsedRef) => r.kind === "journal" || (r.kind === "unknown" && !!r.venueGuess);

/**
 * 按中文期刊论文核对时用的那份解析结果：题名是中文的就是引文本身；
 * 英文译名后面用方括号附了中文原文的（“… (in Chinese). Acta …, 2022, 62: 1–10 [王某, 李某. 中文题名. 中文刊名, 2022, 62: 1–10]”），
 * 取方括号里的中文原文。都不是中文期刊论文时返回 undefined
 */
export function chineseJournalView(ref: ParsedRef): ParsedRef | undefined {
  if (ref.lang !== "zh" || nameOnly(ref) || notReference(ref)) return undefined;
  if (hanCount(ref.titleGuess) >= 4) return journalish(ref) ? ref : undefined;
  const inner = ref.raw.match(/[[［]([^[\]［］]{8,})[\]］]\s*[.。]?\s*$/)?.[1]?.trim();
  if (!inner || hanCount(inner) < 8) return undefined;
  const view = parseReference(inner, ref.index);
  return hanCount(view.titleGuess) >= 4 && journalish(view) ? view : undefined;
}

/** 引文里的卷号和起始页（“63: 802–816”“2020, 39(4): 773–781”“第 39 卷第 4 期, 773-781”），只用于去 Crossref 定位 */
export function citedVolumePage(raw: string): { volume?: string; firstPage?: string } {
  const t = raw.normalize("NFKC");
  const gbt = t.match(/(?:18|19|20)\d{2}\s*[,，]\s*(\d{1,4})\s*(?:\(\s*[0-9A-Za-z]{1,4}\s*\))?\s*[:：]\s*[eE]?(\d{1,6})/);
  if (gbt) return { volume: gbt[1], firstPage: gbt[2] };
  const short = t.match(/[,，]\s*(\d{1,4})\s*[:：]\s*[eE]?(\d{1,6})\s*(?:[-–—~]\s*\d|[.。,，;；]|$)/);
  if (short) return { volume: short[1], firstPage: short[2] };
  const volume = t.match(/第\s*(\d{1,4})\s*卷/)?.[1];
  const firstPage = t.match(/期\s*[,，:：]?\s*(?:第\s*)?(\d{1,6})\s*[-–—~]/)?.[1];
  return { volume, firstPage };
}

/** 网页标题常在题名后面带站点名、栏目名（“题名 - 地球物理学报”“题名 - | Citation Search | …”）：整串或任一分隔符之前的部分与题名一致就算 */
function hitTitleMatches(hitTitle: string, title: string): boolean {
  const t = hitTitle.trim();
  if (sameTitle(t, title)) return true;
  return [...t.matchAll(/\s*(?:[-_|｜–—]+)\s*/g)].some((m) => m.index > 0 && sameTitle(t.slice(0, m.index), title));
}

const short = (s: string, n = 30) => (s.length > n ? s.slice(0, n) + "…" : s);

function locator(rec: WorkRecord): string {
  const parts = [rec.venue, rec.year ? `${rec.year} 年` : undefined, rec.volume ? `第 ${rec.volume} 卷` : undefined, rec.issue ? `第 ${rec.issue} 期` : undefined, rec.pages ? `${rec.pages} 页` : undefined];
  return parts.filter(Boolean).join(" ");
}

/** 拼音或西文姓氏是否与汉字姓名的读音一致（“高原” ↔ GAO Yuan） */
function sameFirstAuthor(a: WorkRecord, b: WorkRecord): boolean {
  const family = (rec: WorkRecord) => {
    const first = rec.authors[0];
    if (!first) return "";
    const roman = /\p{Script=Han}/u.test(first.family) ? romanizeHanName(first.family + (first.given ?? "")) : first;
    return (roman?.family ?? "").toLowerCase().replace(/[^a-z]/g, "");
  };
  return !!family(a) && family(a) === family(b);
}

export interface CnLookup {
  records: WorkRecord[];
  notes: string[];
  /** 是否真的联网查了；没查时结论照旧，notes 里说明原因 */
  searched: boolean;
}

/**
 * 对一条中文期刊引文（chineseJournalView 的结果）做联网核查，返回可交给规则比对的记录。
 * 单条有总时限；时限到了、数据源暂时不可用时保留已经找到的记录；取消照常抛出
 */
export async function lookupChineseJournal(
  view: ParsedRef,
  steps: CheckStep[],
  signal: AbortSignal | undefined,
  budget: CnBudget,
): Promise<CnLookup> {
  const title = view.titleGuess;
  if (!title) return { records: [], notes: [], searched: false };
  const remaining = budget.deadline === undefined ? Infinity : budget.deadline - Date.now();
  if (budget.left <= 0) {
    return { records: [], notes: ["本次核查的中文期刊联网检索条数已用完，这一条没有到知网、万方、维普检索；可以单独再查这一条"], searched: false };
  }
  if (remaining < CN_LIMITS.minStartMs) {
    return { records: [], notes: ["本次核查的时间快用完了，这一条没有到知网、万方、维普检索；可以单独再查这一条"], searched: false };
  }
  budget.left--;
  const capMs = Math.min(CN_LIMITS.itemMs, remaining - CN_LIMITS.reserveMs);
  const cap = AbortSignal.timeout(capMs);
  const run = signal ? AbortSignal.any([signal, cap]) : cap;
  const records: WorkRecord[] = [];
  const notes: string[] = [];
  const strong = (rec: WorkRecord) => sameTitle(rec.title, title);
  // 有一条记录已经能下结论（作者对得上且卷期页一致，或作者明确对不上）就不再往下查
  const decisive = () => records.some((rec) => {
    const s = scoreCandidate(view, rec);
    return s.same && webVerdict(s) !== "incomplete";
  });
  const add = (list: WorkRecord[]) => {
    for (const rec of list) if (!records.some((r) => r.url === rec.url)) records.push(rec);
  };

  async function track<T>(action: CheckStep["action"], task: () => Promise<T>, describe: (r: T) => { detail: string; ok: boolean }): Promise<T> {
    const t = Date.now();
    try {
      const r = await task();
      steps.push({ action, ...describe(r), ms: Date.now() - t });
      return r;
    } catch (error) {
      const detail = run.aborted && !signal?.aborted ? "联网检索时限已到，这一步没有完成" : error instanceof Error ? error.message : "查询失败";
      steps.push({ action, detail, ok: false, ms: Date.now() - t });
      throw error;
    }
  }

  /** 手机知网文章页补作者、刊名、年期：替换掉搜索结果里没有作者的知网记录 */
  async function readCnki(list: WorkRecord[]) {
    const seen = new Set<string>();
    for (const rec of list) {
      const code = rec.url ? cnkiArticleCode(rec.url) : undefined;
      if (!code || seen.has(code) || seen.size >= CN_LIMITS.cnkiPages) continue;
      seen.add(code);
      const page = await track("cn_page", () => fetchCnkiArticle(code, run), (r) => r.value
        ? { detail: `手机知网文章页 ${code}：作者 ${formatAuthorsShort(r.value.authors, 4)}；${locator(r.value)}`, ok: true }
        : { detail: `手机知网文章页 ${code}：${r.reason}`, ok: false });
      if (page.value) {
        const at = records.indexOf(rec);
        if (at >= 0) records.splice(at, 1, page.value);
        else add([page.value]);
      }
      if (decisive()) return;
    }
  }

  /** 期刊官网页有 DOI 却缺年份或卷期页时，到 Crossref 按 DOI 补齐（第一作者读音一致才补） */
  async function fillFromCrossref(rec: WorkRecord): Promise<WorkRecord> {
    if (!rec.doi || (rec.year && rec.volume && rec.pages)) return rec;
    const doi = rec.doi;
    const { record } = await track("cn_crossref", () => crossrefByDoi(doi, run), (r) => ({
      detail: r.record ? `Crossref：DOI ${doi} 登记为 ${locator(r.record) || "（无卷期信息）"}` : `Crossref 中没有 DOI ${doi}（可能在其他注册机构）`,
      ok: !!r.record,
    }));
    if (!record || !sameFirstAuthor(rec, record)) return rec;
    return {
      ...rec, site: "期刊官网、Crossref",
      year: rec.year ?? record.year, years: rec.year ? rec.years : record.years,
      volume: rec.volume ?? record.volume, issue: rec.issue ?? record.issue, pages: rec.pages ?? record.pages,
    };
  }

  /** 刊物在 Crossref 注册了 DOI 时，按 ISSN、年、卷、起始页定位，补上知网页面没有的卷号和印刷页码 */
  async function locateInCrossref() {
    const { volume, firstPage } = citedVolumePage(view.raw);
    const year = view.year;
    const base = records.find((r) => strong(r) && r.site === "知网" && r.authors.length)
      ?? records.find((r) => strong(r) && (r.site === "知网" || r.site === "万方"));
    if (!volume || !firstPage || !year || !base) return;
    let issn = records.find((r) => r.issn?.length)?.issn?.[0];
    const journalCode = base.url ? cnkiJournalCode(base.url) : undefined;
    if (!issn && journalCode) {
      const page = await track("cn_page", () => fetchCnkiJournalIssn(journalCode, run), (r) => ({
        detail: r.value ? `知网期刊页 ${journalCode}：ISSN ${r.value}` : `知网期刊页 ${journalCode}：${r.reason}`, ok: !!r.value,
      }));
      issn = page.value;
    }
    if (!issn) return;
    const issnValue = issn;
    const cited = (view.authorsGuess ?? "").split(/\s*[,，、;；]\s*/).map((n) => romanizeHanName(n)).filter((a) => !!a).slice(0, 3);
    const query = [...cited.map((a) => `${a!.family} ${a!.given ?? ""}`), volume, firstPage].join(" ");
    const { records: found } = await track("cn_crossref", () => crossrefJournalWorks(issnValue, year, query, run), (r) => ({
      detail: `Crossref 按 ISSN ${issnValue}、${year} 年检索：${r.records.length} 条记录，第 ${volume} 卷起始页 ${firstPage} 的 ${r.records.filter((x) => x.volume === volume && x.pages?.split(/[-–]/)[0] === firstPage).length} 条`,
      ok: r.records.some((x) => x.volume === volume && x.pages?.split(/[-–]/)[0] === firstPage),
    }));
    const hit = found.find((x) => x.volume === volume && x.pages?.split(/[-–]/)[0] === firstPage
      && (x.year === year || x.years?.includes(year))
      && (!base.issue || !x.issue || String(Number(x.issue)) === String(Number(base.issue)) || x.issue === base.issue)
      && (!base.authors.length || sameFirstAuthor(base, x)));
    if (!hit) return;
    // 合并后的记录和知网记录是同一个链接，替换掉原来那条（按链接去重的 add 会把它丢掉）
    records.splice(records.indexOf(base), 1, {
      ...base, site: `${base.site}、Crossref`, authors: base.authors.length ? base.authors : hit.authors,
      volume: hit.volume, issue: base.issue ?? hit.issue, pages: hit.pages, doi: hit.doi, issn: hit.issn ?? [issnValue],
    });
  }

  let searched = false;
  try {
    // 1. 知网、万方、维普三站
    add(await track("cn_search", () => cnSiteSearch(title, run), (list) => {
      searched = true;
      const same = list.filter(strong);
      return {
        detail: list.length
          ? `知网 / 万方 / 维普检索「${short(title)}」：${list.length} 篇论文页，题名一致的 ${same.length} 篇${same.some((r) => r.authors.length) ? `（${same.filter((r) => r.authors.length).map((r) => r.site).join("、")}带作者）` : ""}`
          : `知网 / 万方 / 维普检索「${short(title)}」：没有找到论文页`,
        ok: same.length > 0,
      };
    }));
    // 2. 维普结果自带作者已经够了；否则读手机知网文章页
    if (!decisive()) await readCnki(records.filter((r) => r.site === "知网" && strong(r) && !r.authors.length));
    // 3. 同题名的记录都还没有作者时，再只查一次维普
    if (!decisive() && records.some(strong) && !records.some((r) => strong(r) && r.authors.length)) {
      try {
        add(await track("cn_search", () => cqvipSearch(title, run), (list) => ({
          detail: `维普检索「${short(title)}」：${list.length} 篇论文页，题名一致且带作者的 ${list.filter((r) => strong(r) && r.authors.length).length} 篇`,
          ok: list.some((r) => strong(r) && r.authors.length),
        })));
      } catch (error) {
        if (run.aborted || !(error instanceof UpstreamError)) throw error;
      }
    }
    // 4. 不限站点：期刊官网文章页的元数据；顺带读前面没找到的知网文章页
    if (!decisive()) {
      const isOfficial = (h: { url: string; title: string }) => officialCandidate(h.url) && hitTitleMatches(h.title, title);
      const hits = await track("cn_search", () => openWebSearch(title, run), (list) => ({
        detail: `不限站点检索「${short(title)}」：${list.length} 条结果，题名一致、可能是期刊官网文章页的 ${list.filter(isOfficial).length} 条`,
        ok: list.length > 0,
      }));
      const known = new Set(records.map((x) => (x.url ? cnkiArticleCode(x.url) : undefined)).filter(Boolean));
      const fresh = parseHits(hits).filter((r) => {
        const code = r.url ? cnkiArticleCode(r.url) : undefined;
        return r.site === "知网" && strong(r) && !!code && !known.has(code);
      });
      add(fresh);
      await readCnki(fresh);
      // 同一页面常以“#1”“#2”出现两次，按去掉片段的网址去重
      const official = hits.filter(isOfficial).filter((h, i, list) => list.findIndex((x) => pageUrl(x.url) === pageUrl(h.url)) === i)
        .slice(0, CN_LIMITS.officialPages);
      for (const hit of official) {
        if (decisive()) break;
        const page = await track("cn_page", () => fetchJournalArticle(hit.url, true, run), (r) => r.value
          ? { detail: `期刊官网 ${new URL(hit.url).hostname}：作者 ${formatAuthorsShort(r.value.authors, 4)}；${locator(r.value)}`, ok: true }
          : { detail: `期刊官网 ${new URL(hit.url).hostname}：${r.reason}`, ok: false });
        if (page.value && strong(page.value)) add([await fillFromCrossref(page.value)]);
      }
    }
    // 5. Crossref 按刊物 ISSN、年、卷、起始页定位
    if (!decisive()) await locateInCrossref();
  } catch (error) {
    if (signal?.aborted) throw error;
    const why = cap.aborted ? `${Math.round(capMs / 1000)} 秒内没有查完` : error instanceof UpstreamError ? error.message : undefined;
    if (!why) throw error;
    notes.push(searched
      ? `中文期刊联网检索没有全部完成（${why}），已用找到的候选比对`
      : `中文期刊联网检索没有完成（${why}），这一条没能到知网、万方、维普核对；可以稍后单独再查`);
  }
  return { records, notes, searched };
}
