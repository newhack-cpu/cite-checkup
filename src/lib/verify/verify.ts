// 单条文献的核验流程：
// 1. 有 DOI → Crossref 直查；查不到再问 doi.org 这个 DOI 是否注册、取元数据；知网登记的 DOI 取不到元数据，读中国 DOI 注册机构的解析页看它登记的是哪篇
// 2. DOI 没对上同一篇 → Crossref 整条引文模糊检索
// 3. 还没找到且是英文文献 → OpenAlex 题名检索兜底（消耗额度，按请求限次）
// 4. 还没找到且是中文期刊论文 → DeepSeek 搜索接口在知网、万方、维普找原文页，再读原文页面补作者（见 cnjournal.ts；没配置密钥时跳过）
// 5. 选出最佳候选，逐字段比对后给出结论；所有"建议写法"都来自数据库记录或原文页面

import { chineseJournalView, defaultCnBudget, lookupChineseJournal, type CnBudget, type CnLookup } from "./cnjournal";
import { suggestCitation } from "./format";
import { UpstreamError } from "./http";
import { nameOnly, notReference } from "./extract";
import { dice, isCjk, normalizeText, stripRetractionPrefix } from "./normalize";
import {
  chineseOrganizationCited,
  fieldChecks,
  formatAuthorsShort,
  fuzzyRecall,
  yearVaries,
  recordYears,
  scoreCandidate,
  venueSimilarity,
  versionedRecord,
  webVerdict,
  type MatchScore,
} from "./match";
import { crossrefByDoi, crossrefJournals, crossrefSearch } from "./sources/crossref";
import { fetchChndoi } from "./sources/cnpage";
import { doiCsl, doiRegistry, type RegistryStatus } from "./sources/doi";
import { openalexByDoi, openalexSearchTitle, openalexSourceTitles } from "./sources/openalex";
import type { CheckStep, ParsedRef, RefKind, RefResult, WorkRecord } from "./types";

export interface VerifyContext {
  /** 本次请求里还允许发起几次 OpenAlex 题名检索 */
  openalexBudget: { left: number };
  signal?: AbortSignal;
  /** 中文期刊联网核查的额度和时限；没配置 DeepSeek 密钥时不传，这一步跳过、结论照旧 */
  cn?: CnBudget;
}

interface Ranked {
  rec: WorkRecord;
  score: MatchScore;
}

interface DoiEvidence {
  doiRecord?: WorkRecord;
  registry?: RegistryStatus;
  openalexSkipped?: boolean;
  /** 已经到知网、万方、维普联网查过（查到与否都算） */
  cnSearched?: boolean;
  /** 知网登记的 DOI：中国 DOI 注册机构登记的题名、作者与引文一致。登记信息没有年份、期刊和卷期页，只说明 DOI 属于这一篇 */
  doiRegistered?: WorkRecord;
}

const OUT_OF_SCOPE: Partial<Record<RefKind, string>> = {
  book: "图书",
  thesis: "学位论文",
  standard: "标准",
  patent: "专利",
  report: "报告",
  newspaper: "报纸",
  web: "网页 / 电子资源",
  legal: "法律法规",
  presentation: "会议报告 / 海报",
  archive: "档案 / 手稿",
  software: "软件 / 数据集",
};

/** 开放数据库覆盖不足的文献类型（图书、报告、网页等），返回中文类名 */
export function outOfScope(kind: RefKind): string | undefined {
  return OUT_OF_SCOPE[kind];
}

const SOURCE_LABEL: Record<WorkRecord["source"], string> = {
  crossref: "Crossref",
  "doi-csl": "DOI 注册机构",
  openalex: "OpenAlex",
  datacite: "DataCite",
  web: "中文学术网页",
};

const sourceName = (rec: WorkRecord) => (rec.source === "web" && rec.site ? rec.site : SOURCE_LABEL[rec.source]);
/** 记录里有起止页（“12-20”），拼出的规范写法才不会比引文少页码 */
const fullPages = (rec: WorkRecord) => /\d\s*[-–]\s*\d/.test(rec.pages ?? "");

/** AI 检索 Agent 追加的候选和检索步骤；候选一样要经过规则逐字段比对 */
export interface ExtraEvidence {
  candidates: WorkRecord[];
  steps: CheckStep[];
}

// 这些前缀属于 DataCite（arXiv、Zenodo、figshare），Crossref 里一定查不到，直接问 doi.org
const DATACITE_PREFIXES = ["10.48550/", "10.5281/", "10.6084/"];

function short(s: string, n = 40): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function base(ref: ParsedRef, steps: CheckStep[]) {
  return { index: ref.index, raw: ref.raw, issues: [] as string[], notes: [] as string[], fields: [], steps, parsed: ref };
}

async function step<T>(
  steps: CheckStep[],
  action: CheckStep["action"],
  run: () => Promise<T>,
  describe: (r: T) => { detail: string; ok: boolean },
): Promise<T> {
  const t = Date.now();
  try {
    const r = await run();
    steps.push({ action, ...describe(r), ms: Date.now() - t });
    return r;
  } catch (err) {
    steps.push({ action, detail: err instanceof Error ? err.message : "查询失败", ok: false, ms: Date.now() - t });
    throw err;
  }
}

/**
 * OpenAlex 合并记录是不是已确认的这一篇：题名基本一致、第一作者姓氏相同。
 * 合并记录的年份、期刊可能取自别的版本（W2626778328 登记为 2025 年），所以不比这两项。
 */
function sameMergedWork(rec: WorkRecord, merged: WorkRecord): boolean {
  const titles = (r: WorkRecord) => [r.title, r.subtitle ? `${r.title} ${r.subtitle}` : ""].filter(Boolean).map(stripRetractionPrefix);
  const similarity = Math.max(...titles(rec).flatMap((a) => titles(merged).map((b) => dice(a, b))));
  const first = (r: WorkRecord) => normalizeText(r.authors[0]?.family ?? "");
  return similarity >= 0.9 && !!first(rec) && first(rec) === first(merged);
}

/**
 * OpenAlex 把这个 DOI 归到登记了另一个 DOI 的记录：是同一篇且没有撤稿标记，就算交叉核验完成；
 * 其余情况只提示人工核对——合并记录里的撤稿标记可能属于另一个登记号（比如转载或重复登记），不据此判撤稿。
 */
function mergedLookup(rec: WorkRecord, merged: WorkRecord): { detail: string; ok: boolean; note?: string } {
  const doi = merged.doi ?? "未知";
  if (!sameMergedWork(rec, merged)) {
    return {
      detail: `OpenAlex 把该 DOI 归到另一条记录《${short(merged.title)}》（登记 DOI ${doi}），撤稿状态交叉核验未完成`,
      ok: false,
      note: `OpenAlex 把该 DOI 归到另一条记录（登记 DOI ${doi}），无法确认是同一篇，撤稿状态交叉核验未完成；请人工核对出版社页面`,
    };
  }
  if (merged.retraction) {
    return {
      detail: `OpenAlex：该 DOI 归在合并记录下（登记 DOI ${doi}），该记录带撤稿标记，需人工核对`,
      ok: false,
      note: `OpenAlex 把该 DOI 与登记 DOI 为 ${doi} 的记录合并，该记录带撤稿标记；无法确认被撤稿的是不是这一版本，撤稿状态交叉核验未完成，请人工核对出版社页面`,
    };
  }
  return { detail: `OpenAlex：该 DOI 归在合并记录下（登记 DOI ${doi}），题名、第一作者一致，未发现撤稿标记`, ok: true };
}

function rank(ref: ParsedRef, candidates: WorkRecord[]): Ranked[] {
  const seen = new Set<string>();
  const list: Ranked[] = [];
  for (const rec of candidates) {
    if (!rec.title) continue;
    // 网页记录按链接区分：知网、维普同一篇文章的两条结果题名相同，带作者的维普记录不能被去重掉；
    // 期刊官网记录的 DOI 也常与 Crossref 里只有英文题名的记录相同，同样不能按 DOI 去重掉（T110）
    const key = rec.source === "web" && rec.url ? `web ${rec.url}` : rec.doi ?? rec.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ rec, score: scoreCandidate(ref, rec) });
  }
  // 同一篇中文文章常有几条网页记录（知网、维普、期刊官网）：能下结论的排前面，核实优先于作者不符
  const decided = (r: Ranked) => (r.rec.source !== "web" || !r.score.same ? 0 : { verified: 2, mismatch: 1, incomplete: 0 }[webVerdict(r.score)]);
  return list.sort((a, b) => Number(b.score.same) - Number(a.score.same) || decided(b) - decided(a) || b.score.composite - a.score.composite);
}

/** 4xx（429 除外）是数据源拒绝了这次查询本身，不是限流；429、5xx 和网络错误才可能是暂时的 */
function upstreamSummary(err: UpstreamError): string {
  const status = err.status ?? 0;
  return status >= 400 && status < 500 && status !== 429
    ? `查询被数据源拒绝（HTTP ${status}），本条未完成核验，请人工核查`
    : "数据源暂时不可用（可能被限流），请稍后重试";
}

/** 整条只有一个 DOI（可带序号、“doi:” 或 doi.org 链接），没有题名、作者可以比对 */
const BARE_DOI_RE = /^(?:\[\d+\]\s*|\d+[.、)]\s*)?(?:doi\s*[:：]?\s*|(?:https?:\/\/)?(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+$/i;

/**
 * 只贴了 DOI 的条目：拿 DOI 记录去和空的题名、作者比对，只会得出“不是同一篇”，以前因此误判成“DOI 指向另一篇文献，疑似编造”。
 * 按 DOI 查到记录就是这一篇：补全信息、照常到 OpenAlex 核对撤稿、给出规范写法。
 * 查不到记录时返回 undefined，交给常规流程判断 DOI 是否存在（请求有缓存，不会重复访问数据源）。
 */
async function verifyBareDoi(ref: ParsedRef, doi: string, ctx: VerifyContext, steps: CheckStep[]): Promise<RefResult | undefined> {
  let rec: WorkRecord | undefined;
  if (!DATACITE_PREFIXES.some((p) => doi.startsWith(p))) {
    const cr = await step(steps, "doi_lookup", () => crossrefByDoi(doi, ctx.signal), (r) =>
      r.record
        ? { detail: `Crossref：DOI ${doi} 对应《${short(r.record.title)}》`, ok: true }
        : { detail: `Crossref 中没有 DOI ${doi}`, ok: false },
    );
    rec = cr.record;
  }
  if (!rec) {
    const registry = await step(steps, "doi_registry", () => doiRegistry(doi, ctx.signal), (r) =>
      r.exists === true
        ? { detail: `doi.org：该 DOI 已在 ${r.ra} 注册`, ok: true }
        : r.exists === false
          ? { detail: "doi.org：该 DOI 未注册（不存在）", ok: false }
          : { detail: "doi.org：无法确认该 DOI 的注册状态", ok: false },
    );
    if (!registry.exists) return undefined;
    const csl = await step(steps, "doi_csl", () => doiCsl(doi, ctx.signal), (r) =>
      r.record
        ? { detail: `doi.org 内容协商：取得《${short(r.record.title)}》的元数据`, ok: true }
        : { detail: "该 DOI 的注册机构不提供元数据", ok: false },
    );
    if (!csl.record) return undefined;
    rec = csl.record;
  }

  const issues: string[] = [];
  const notes = ["引文只写了 DOI，没有题名、作者可以比对：题名、作者、期刊等信息都按 DOI 从数据库补全"];
  if (rec.doi && rec.source !== "openalex" && rec.retraction?.status !== "retracted" && rec.retraction?.status !== "withdrawn") {
    const matched = rec;
    const recDoi = rec.doi;
    try {
      const oa = await step(steps, "openalex_lookup", () => openalexByDoi(recDoi, ctx.signal), (r) => {
        if (r.merged) {
          const { detail, ok } = mergedLookup(matched, r.merged);
          return { detail, ok };
        }
        return {
          detail: r.record ? (r.record.retraction ? "OpenAlex：该文献已被标记撤稿" : "OpenAlex：未发现撤稿标记") : "OpenAlex 中没有该 DOI，撤稿状态交叉核验未完成",
          ok: !!r.record,
        };
      });
      if (oa.record?.retraction) rec = { ...rec, retraction: oa.record.retraction };
      if (oa.merged) {
        const note = mergedLookup(matched, oa.merged).note;
        if (note) notes.push(note);
      } else if (!oa.record) notes.push("OpenAlex 未收录该 DOI，撤稿状态交叉核验未完成，请人工核对出版社页面");
    } catch {
      ctx.signal?.throwIfAborted();
      notes.push("OpenAlex 暂时不可用，撤稿状态交叉核验未完成，请稍后重试或核对出版社页面");
    }
  }

  const fields: RefResult["fields"] = [
    { field: "title", status: "missing", actual: rec.subtitle ? `${rec.title}: ${rec.subtitle}` : rec.title },
    { field: "authors", status: "missing", actual: rec.authors.length ? formatAuthorsShort(rec.authors) : undefined },
    { field: "year", status: "missing", actual: recordYears(rec).join(" / ") || undefined },
    ...(rec.venue ? [{ field: "venue" as const, status: "missing" as const, actual: rec.venue }] : []),
    { field: "doi", status: "match", cited: doi, actual: rec.doi ?? doi },
  ];
  const result: RefResult = {
    ...base(ref, steps),
    verdict: "verified",
    confidence: 0.95,
    summary: `已按 DOI 查到这篇文献，补全了题名、作者等信息（来源：${SOURCE_LABEL[rec.source]}）`,
    match: rec,
    matchStatus: "confirmed",
    fields,
    issues,
    notes,
    // 中文记录给 GB/T 7714，其余给 APA；整份换格式在“规范参考文献”里选
    suggestion: suggestCitation(rec, rec.title),
  };
  if (rec.retraction) {
    const r = rec.retraction;
    const what = { retracted: "已被撤稿", withdrawn: "已被撤回", concern: "被期刊发布了关注声明（Expression of Concern）" }[r.status];
    const src =
      r.source === "retraction-watch" ? "Retraction Watch" : r.source === "publisher" ? "出版社" : r.source === "openalex" ? "OpenAlex" : r.source === "crossref-title" ? "Crossref 题名前缀" : r.source;
    issues.unshift(`该文献${r.date ? `于 ${r.date} ` : ""}${what}${src ? `（来源：${src}）` : ""}${r.noticeDoi ? `，声明 DOI：${r.noticeDoi}` : ""}`);
    result.verdict = r.status === "concern" ? "concern" : "retracted";
    result.summary = r.status === "concern" ? `文献存在，但${what}，请阅读声明并谨慎引用` : `文献存在，但${what}，不宜作为论据引用`;
  }
  if (notes.some((n) => n.includes("撤稿状态交叉核验未完成"))) result.summary += "；撤稿状态交叉核验未完成";
  return result;
}

export async function verifyReference(ref: ParsedRef, ctx: VerifyContext, extra?: ExtraEvidence): Promise<RefResult> {
  const steps: CheckStep[] = [];
  const candidates: WorkRecord[] = [];
  const evidence: DoiEvidence = {};

  try {
    ctx.signal?.throwIfAborted();
    if (ref.doi && !extra && BARE_DOI_RE.test(ref.raw.trim())) {
      const bare = await verifyBareDoi(ref, ref.doi, ctx, steps);
      if (bare) return bare;
      steps.length = 0;
    }
    if (ref.doi) {
      const doi = ref.doi;
      if (!DATACITE_PREFIXES.some((p) => doi.startsWith(p))) {
        const cr = await step(steps, "doi_lookup", () => crossrefByDoi(doi, ctx.signal), (r) =>
          r.record
            ? { detail: `Crossref：DOI ${doi} 对应《${short(r.record.title)}》`, ok: true }
            : { detail: `Crossref 中没有 DOI ${doi}`, ok: false },
        );
        evidence.doiRecord = cr.record;
      }
      if (!evidence.doiRecord) {
        evidence.registry = await step(steps, "doi_registry", () => doiRegistry(doi, ctx.signal), (r) =>
          r.exists === true
            ? { detail: `doi.org：该 DOI 已在 ${r.ra} 注册`, ok: true }
            : r.exists === false
              ? { detail: "doi.org：该 DOI 未注册（不存在）", ok: false }
              : { detail: "doi.org：无法确认该 DOI 的注册状态", ok: false },
        );
        if (evidence.registry.exists) {
          const csl = await step(steps, "doi_csl", () => doiCsl(doi, ctx.signal), (r) =>
            r.record
              ? { detail: `doi.org 内容协商：取得《${short(r.record.title)}》的元数据`, ok: true }
              : { detail: "该 DOI 的注册机构不提供元数据", ok: false },
          );
          evidence.doiRecord = csl.record;
        }
      }
      if (evidence.doiRecord) candidates.push(evidence.doiRecord);
      else if (evidence.registry?.ra === "CNKI") {
        // 知网登记的 DOI 取不到元数据：读中国 DOI 注册机构的解析页，只用来判断这个 DOI 登记的是不是这一篇；
        // 登记信息没有年份、期刊和卷期页，不当作候选，也不据此判已核实
        const reg = await step(steps, "doi_chndoi", () => fetchChndoi(doi, ctx.signal), (r) =>
          r.value
            ? { detail: `中国 DOI 注册机构：该 DOI 登记的是《${short(r.value.title)}》（${formatAuthorsShort(r.value.authors, 3) || "作者不详"}）`, ok: true }
            : { detail: `中国 DOI 注册机构的解析页：${r.reason ?? "没有读到登记信息"}`, ok: false },
        );
        const owner = reg.value ? doiOwner(ref, reg.value) : undefined;
        // 登记的是另一篇：和 DOI 指向别的文献一样处理（DOI 去掉，免得按“DOI 一致”认成同一篇）
        if (owner === "other") evidence.doiRecord = { ...reg.value!, doi: undefined };
        else if (owner === "same") evidence.doiRegistered = reg.value;
      }
    }

    const doiIsSame = evidence.doiRecord ? scoreCandidate(ref, evidence.doiRecord).same : false;
    if (!doiIsSame) {
      const { records } = await step(steps, "crossref_search", () => crossrefSearch(ref.raw, 5, ctx.signal), (r) => ({
        detail: r.records.length
          ? `Crossref 引文检索返回 ${r.records.length} 条候选，排第一的是《${short(r.records[0].title)}》`
          : "Crossref 引文检索没有返回结果",
        ok: r.records.length > 0,
      }));
      candidates.push(...records);
    }

    let ranked = rank(ref, candidates);
    evidence.openalexSkipped = !ranked[0]?.score.same && ref.lang === "en" && !!ref.titleGuess
      && !OUT_OF_SCOPE[ref.kind] && ctx.openalexBudget.left <= 0;

    if (
      !ranked[0]?.score.same &&
      ref.lang === "en" &&
      ref.titleGuess &&
      !OUT_OF_SCOPE[ref.kind] &&
      ctx.openalexBudget.left > 0
    ) {
      ctx.openalexBudget.left--;
      const title = ref.titleGuess;
      const { records } = await step(steps, "openalex_search", () => openalexSearchTitle(title, 5, ctx.signal), (r) => ({
        detail: r.records.length ? `OpenAlex 题名检索返回 ${r.records.length} 条候选` : "OpenAlex 题名检索没有返回结果",
        ok: r.records.length > 0,
      }));
      candidates.push(...records);
      ranked = rank(ref, candidates);
    }
    // 模型只负责找候选，哪一篇算同一篇仍由下面的规则决定
    if (extra) {
      steps.push(...extra.steps);
      candidates.push(...extra.candidates);
      ranked = rank(ref, candidates);
    }

    // 中文期刊论文：到知网、万方、维普和期刊官网找原文页、补作者。英文译名附中文原文的引文按方括号里的中文原文比对
    const view = ctx.cn && !ranked[0]?.score.same ? chineseJournalView(ref) : undefined;
    let cn: CnLookup | undefined;
    let viewBest: Ranked | undefined;
    if (view && ctx.cn) {
      cn = await lookupChineseJournal(view, steps, ctx.signal, ctx.cn);
      evidence.cnSearched = cn.searched;
      if (view === ref) {
        candidates.push(...cn.records);
        ranked = rank(ref, candidates);
      } else {
        viewBest = rank(view, cn.records)[0];
      }
    }
    const withCn = (result: RefResult): RefResult => {
      if (!cn?.notes.length) return result;
      return { ...result, notes: [...result.notes, ...cn.notes] };
    };
    // 方括号里的中文原文另作一份解析：结论按它给，卡片上仍显示整条引文
    const asWhole = (result: RefResult): RefResult => withCn({
      ...result, raw: ref.raw, parsed: ref,
      notes: [...result.notes, "引文的英文译名无法与中文网页记录比对，已按方括号里的中文原文核对"],
    });

    const best = ranked[0];
    if (!best?.score.same && viewBest?.score.same && view) {
      return asWhole(judgeSame(view, viewBest.rec, viewBest.score, steps, evidence));
    }
    if (best?.score.same) {
      let rec = best.rec;
      const extraNotes: string[] = [];
      let score = await withVenueAlias(ref, rec, best.score, steps, ctx, extraNotes);
      // Crossref 撤稿元数据可能不完整，同样需要 OpenAlex 交叉核对。中文网页记录（知网、期刊官网）的 DOI 多由 ISTIC、知网注册，
      // OpenAlex 基本没有，这里不查（结论里注明没有核对撤稿状态）
      if (rec.doi && rec.source !== "openalex" && rec.source !== "web" && rec.retraction?.status !== "retracted" && rec.retraction?.status !== "withdrawn") {
        const doi = rec.doi;
        try {
          const matched = rec;
          const oa = await step(steps, "openalex_lookup", () => openalexByDoi(doi, ctx.signal), (r) => {
            if (r.merged) {
              const { detail, ok } = mergedLookup(matched, r.merged);
              return { detail, ok };
            }
            return {
              detail: r.record ? (r.record.retraction ? "OpenAlex：该文献已被标记撤稿" : "OpenAlex：未发现撤稿标记") : "OpenAlex 中没有该 DOI，撤稿状态交叉核验未完成",
              ok: !!r.record,
            };
          });
          if (oa.record?.retraction) rec = { ...rec, retraction: oa.record.retraction };
          // 两个数据库登记的出版年份不同、引文与 OpenAlex 一致时，不算引文写错（Crossref 把 2014 年的论文登记成 2020 年，B015）
          const oaYear = oa.record?.year;
          if (oaYear && ref.year && score.yearDiff !== undefined && score.yearDiff > 1 && Math.abs(ref.year - oaYear) < score.yearDiff) {
            extraNotes.push(`Crossref 登记的出版年份为 ${recordYears(rec).join(" / ")}，OpenAlex 为 ${oaYear}；引用年份与 OpenAlex 一致或更接近，两个数据库的记录不一致，请以原文为准`);
            rec = { ...rec, years: [...(rec.years ?? []), oaYear] };
            score = { ...score, yearDiff: Math.abs(ref.year - oaYear) };
          }
          if (oa.merged) {
            const note = mergedLookup(matched, oa.merged).note;
            if (note) extraNotes.push(note);
          } else if (!oa.record) extraNotes.push("OpenAlex 未收录该 DOI，撤稿状态交叉核验未完成；已保留数据库中的文献信息，请人工核对出版社页面");
        } catch {
          ctx.signal?.throwIfAborted();
          extraNotes.push("OpenAlex 暂时不可用，撤稿状态交叉核验未完成；已保留数据库中的文献信息，请稍后重试或核对出版社页面");
        }
      }
      ctx.signal?.throwIfAborted();
      const result = judgeSame(ref, rec, score, steps, evidence);
      result.notes.push(...extraNotes);
      if (extraNotes.some((n) => n.includes("撤稿状态交叉核验未完成"))) result.summary += "；撤稿状态交叉核验未完成";
      return withCn(result);
    }
    if (!best?.score.partial && viewBest?.score.partial && view) return asWhole(judgeNotSame(view, viewBest, steps, evidence));
    const result = withCn(judgeNotSame(ref, best, steps, evidence));
    // 只有"两个数据源都检索不到"这一种查无此文需要再确认期刊收录范围；DOI 证据不受影响
    if (result.verdict === "not_found" && !ref.doi && ref.venueGuess && ref.year) {
      const gap = await coverageGap(ref.venueGuess, ref.year, steps, ctx);
      if (gap) {
        return {
          ...base(ref, steps), verdict: "unverifiable", confidence: 0, notes: [gap],
          summary: "引用的期刊在该年份不在开放数据库收录范围内，查不到不代表不存在，请人工核查",
        };
      }
    }
    return result;
  } catch (err) {
    ctx.signal?.throwIfAborted();
    return {
      ...base(ref, steps),
      verdict: "error",
      confidence: 0,
      summary: err instanceof UpstreamError ? upstreamSummary(err) : "核验过程出错",
      issues: [String((err as Error)?.message ?? err)],
    };
  }
}

/**
 * 中国 DOI 注册机构登记的题名、作者和引文比：same 是这一篇（题名几乎一致、第一作者对上）；
 * other 是另一篇（题名明显不同、第一作者也对不上）；中文题名对英文译名这类比不了的，以及介于两者之间的，都不下判断
 */
function doiOwner(ref: ParsedRef, rec: WorkRecord): "same" | "other" | undefined {
  if (!ref.titleGuess || isCjk(ref.titleGuess.trim()[0] ?? "") !== isCjk(rec.title.trim()[0] ?? "")) return undefined;
  const s = scoreCandidate(ref, { ...rec, doi: undefined });
  if (s.titleScore >= 0.9 && s.firstAuthor === "match") return "same";
  if (s.titleScore < 0.5 && s.firstAuthor === "mismatch") return "other";
  return undefined;
}

/** 判"期刊名不符"之前，先查该刊登记过的其他名称（外文刊名、旧刊名、缩写） */
async function withVenueAlias(
  ref: ParsedRef,
  rec: WorkRecord,
  score: MatchScore,
  steps: CheckStep[],
  ctx: VerifyContext,
  notes: string[],
): Promise<MatchScore> {
  const cited = ref.venueGuess;
  const issn = rec.issn?.[0];
  if (!cited || !issn || !score.venueCited || (score.venueScore ?? 1) >= 0.6) return score;
  try {
    const { titles } = await step(steps, "openalex_source", () => openalexSourceTitles(issn, ctx.signal), (r) => {
      const alias = r.titles.find((t) => venueSimilarity(cited, t) >= 0.6);
      return alias
        ? { detail: `OpenAlex：引用中的刊名对应该刊的另一名称《${short(alias)}》`, ok: true }
        : { detail: `OpenAlex：该刊登记的 ${r.titles.length} 个名称中没有与引用相符的`, ok: false };
    });
    const best = Math.max(0, ...titles.map((t) => venueSimilarity(cited, t)));
    if (best >= 0.6) {
      notes.push(`引用中的刊名「${cited}」是该刊登记的另一名称，与数据库记录「${rec.venue}」是同一本期刊`);
      return { ...score, venueScore: best };
    }
  } catch {
    ctx.signal?.throwIfAborted();
  }
  return score;
}

/** 刊名要与引文写法双向吻合（缩写也算）才算同一本刊；"J." 缩写在切词时会丢掉，所以反向比对时不计 journal */
function sameJournal(cited: string, title: string): boolean {
  return venueSimilarity(cited, title) >= 0.9 && fuzzyRecall(title.replace(/\bjournal\b/gi, " "), cited) >= 0.9;
}

/**
 * 下"查无此文"的结论前，确认引文写的期刊在该年份是否在 Crossref 收录范围内。
 * 期刊目录里没有同名期刊时不算缺口：Crossref 期刊目录、OpenAlex 期刊库都认不出 "J Surg Oncol" "N Engl J Med" 这类缩写
 * （2026-10-17 实测），据此放行会把配了缩写刊名的编造文献也改判成无法核验
 */
async function coverageGap(venue: string, year: number, steps: CheckStep[], ctx: VerifyContext): Promise<string | undefined> {
  try {
    const { journals } = await step(steps, "crossref_journal", () => crossrefJournals(venue, ctx.signal), (r) => {
      const named = r.journals.filter((j) => sameJournal(venue, j.title));
      return {
        detail: named.length
          ? `Crossref 期刊目录：与「${short(venue)}」同名的期刊 ${named.length} 本，核对其收录年份`
          : `Crossref 期刊目录中没有与「${short(venue)}」同名的期刊`,
        ok: named.length > 0,
      };
    });
    // 该刊在 Crossref 的记录不覆盖引文年份：之前就停了（只登记过 2007–2009 年），或之后才开始注册 DOI
    // （Indian J Pure Appl Phys 从 2020 年起才有 DOI），这一年的论文查不到不能当作证据
    // 之后才开始注册 DOI 的情况要排除同名新刊：只要有一本同名期刊覆盖引文年份，就不算缺口
    const named = journals.filter((j) => sameJournal(venue, j.title) && j.firstYear !== undefined && j.lastYear !== undefined);
    const covered = named.some((j) => j.firstYear! <= year && year <= j.lastYear!);
    const lapsed = named.find((j) => j.lastYear! < year) ?? (covered ? undefined : named.find((j) => j.firstYear! > year));
    if (lapsed) {
      return `Crossref 中的《${lapsed.title}》（ISSN ${lapsed.issn[0]}）只有 ${lapsed.firstYear}–${lapsed.lastYear} 年的文献记录，`
        + `引用写的 ${year} 年不在收录范围内，查不到不代表文献不存在`;
    }
  } catch {
    ctx.signal?.throwIfAborted();
  }
  return undefined;
}

function judgeSame(ref: ParsedRef, rec: WorkRecord, s: MatchScore, steps: CheckStep[], ev: DoiEvidence): RefResult {
  const issues: string[] = [];
  const notes: string[] = [];
  const fields = fieldChecks(ref, rec, s);
  const web = rec.source === "web";
  const site = sourceName(rec);
  // 中文网页记录的提示写明是哪个网站的记录（“知网记录”“期刊官网记录”），其余沿用“数据库”
  const db = web ? `${site}${/[A-Za-z]$/.test(site) ? " " : ""}记录` : "数据库记录";

  if (ref.doi && rec.doi && ref.doi !== rec.doi) {
    if (ev.registry?.exists === false) issues.push(`引用中的 DOI ${ref.doi} 并不存在，正确 DOI 应为 ${rec.doi}`);
    else if (ev.doiRecord && ev.doiRecord.doi !== rec.doi)
      issues.push(`引用中的 DOI 指向另一篇文献《${short(ev.doiRecord.title)}》，正确 DOI 应为 ${rec.doi}`);
    else issues.push(`DOI 与${db}不一致，${db}为 ${rec.doi}`);
  } else if (ref.doi && !rec.doi) {
    // 网页记录没有 DOI 时，引文里的 DOI 仍要看注册情况：没注册、指向别的文献都算写错
    if (ev.registry?.exists === false) issues.push(`引用中的 DOI ${ref.doi} 在 doi.org 查无注册记录`);
    else if (ev.doiRecord && !scoreCandidate(ref, ev.doiRecord).same) issues.push(`引用中的 DOI 指向另一篇文献《${short(ev.doiRecord.title)}》`);
    else if (ev.doiRegistered) notes.push("中国 DOI 注册机构登记的题名、作者与引文一致，DOI 属于这一篇");
  }
  // 数据库记录可能是另一版本、转载或软件包的总 DOI：年份差得远时提示核对版本，不算写错
  const otherVersion = s.yearDiff !== undefined && s.yearDiff > 1 && yearVaries(ref, rec);
  if (s.authorRatio !== undefined) {
    const names = formatAuthorsShort(rec.authors);
    // 知网、期刊官网的作者顺序可靠，顺序不同算写错；Crossref 的中文记录有时把顺序登记错，只提示
    if (s.authorsReordered && web) issues.push(`作者顺序与${db}不一致，${db}的顺序为 ${names}`);
    else if (s.authorsReordered) notes.push(`引用列出的作者都在数据库记录中，但顺序不同（数据库为 ${names}）；Crossref 的中文记录有时把作者顺序登记错，请以原文为准`);
    else if (s.authorRatio === 0) issues.push(web ? `作者与${db}不符，${db}的作者为 ${names}` : `作者与数据库记录不符，数据库作者为 ${names}`);
    else if (s.firstAuthor === "mismatch") issues.push(web ? `第一作者不符，${db}的第一作者为 ${formatAuthorsShort(rec.authors.slice(0, 1))}` : `第一作者不符，数据库第一作者为 ${formatAuthorsShort(rec.authors.slice(0, 1))}`);
    else if ((s.authorOrderOk === false || s.authorListMismatch) && versionedRecord(ref, rec))
      notes.push(`软件、数据集的作者名单随版本变化，数据库记录的作者为 ${names}，请核对所引版本`);
    else if (s.authorOrderOk === false) issues.push(web ? `作者顺序与${db}不一致，${db}的顺序为 ${names}` : `作者顺序与数据库不一致，数据库顺序为 ${names}`);
    else if (s.authorListMismatch) issues.push(web ? `引用中有作者姓名与${db}不符，${db}的作者为 ${names}` : `引用中有作者姓名与数据库记录不符，数据库作者为 ${names}`);
  }
  if (s.yearDiff !== undefined) {
    const dbYears = recordYears(rec).join(" / ");
    if (otherVersion) notes.push(`数据库记录的年份为 ${dbYears}，引用写 ${ref.year}；图书、学位论文、报告、网页、软件常有多个版本、转载或后来的存档记录，请核对所引版本`);
    else if (s.yearDiff > 1) issues.push(`年份不符：引用写 ${ref.year}，数据库记录为 ${dbYears}`);
    else if (s.yearDiff === 1)
      notes.push(`年份相差一年（引用 ${ref.year}，数据库 ${dbYears}），可能是在线发表与正式出版年份不同`);
  }
  if (s.titleMissing) notes.push("引用中没有写题名，已按作者、刊名、卷号和页码与数据库记录核对");
  if (fields.find((f) => f.field === "venue")?.status === "mismatch")
    issues.push(`期刊名不符：引用写「${ref.venueGuess}」，数据库记录为「${rec.venue}」`);
  if (fields.find((f) => f.field === "title")?.status === "partial") notes.push("题名与数据库记录不完全一致，请核对用词");
  if (fields.find((f) => f.field === "title")?.status === "mismatch") issues.push(`题名与数据库记录不符，数据库题名为《${rec.title}》`);
  if (!ref.doi && rec.doi) {
    notes.push(otherVersion ? `数据库记录的 DOI 为 ${rec.doi}，可能属于另一版本或转载，核对版本后再决定是否补充` : `建议补充 DOI：${rec.doi}`);
  }

  const common = {
    ...base(ref, steps),
    match: rec,
    matchStatus: "confirmed" as const,
    fields,
    issues,
    notes,
    // 知网页面没有卷号和印刷页码、期刊官网有时只给起始页，拼出的写法会丢掉引文里正确的卷页：网页记录有完整起止页才给规范写法
    suggestion: web && !fullPages(rec) ? undefined : suggestCitation(rec, ref.raw),
  };

  if (web) return judgeWeb(ref, rec, s, common, site, db);

  if (rec.retraction) {
    const r = rec.retraction;
    const what = { retracted: "已被撤稿", withdrawn: "已被撤回", concern: "被期刊发布了关注声明（Expression of Concern）" }[r.status];
    const src =
      r.source === "retraction-watch" ? "Retraction Watch" : r.source === "publisher" ? "出版社" : r.source === "openalex" ? "OpenAlex" : r.source === "crossref-title" ? "Crossref 题名前缀" : r.source;
    issues.unshift(`该文献${r.date ? `于 ${r.date} ` : ""}${what}${src ? `（来源：${src}）` : ""}${r.noticeDoi ? `，声明 DOI：${r.noticeDoi}` : ""}`);
    return r.status === "concern"
      ? { ...common, verdict: "concern", confidence: 0.95, summary: `文献存在，但${what}，请阅读声明并谨慎引用` }
      : { ...common, verdict: "retracted", confidence: 0.95, summary: `文献存在，但${what}，不宜作为论据引用` };
  }

  const confidence = Math.min(0.98, 0.55 + s.composite * 0.45);
  const src = `（来源：${site}）`;
  if (issues.length) {
    return { ...common, verdict: "mismatch", confidence, summary: `文献存在，但有 ${issues.length} 处信息与数据库记录不一致${src}` };
  }
  return { ...common, verdict: "verified", confidence, summary: `已核实：与数据库记录一致${src}` };
}

/**
 * 中文网页记录（知网、维普、期刊官网，卷页可能取自 Crossref）确认是同一篇之后：
 * 作者对得上、年份一致、卷期页至少一项一致才算已核实；作者对不上算信息有误；
 * 只差作者核对不了、年份差一年或卷期页对不上时仍是相近候选，附原文链接请人工核对
 */
function judgeWeb(
  ref: ParsedRef,
  rec: WorkRecord,
  s: MatchScore,
  common: Omit<RefResult, "verdict" | "confidence" | "summary">,
  site: string,
  db: string,
): RefResult {
  const confidence = Math.min(0.98, 0.55 + s.composite * 0.45);
  const src = `（来源：${site}）`;
  if (common.issues.length) {
    return { ...common, verdict: "mismatch", confidence, summary: `文献存在，但有 ${common.issues.length} 处信息与${db}不一致${src}` };
  }
  if (webVerdict(s) === "verified") {
    return {
      ...common, verdict: "verified", confidence,
      notes: [...common.notes, `${site.split("、")[0]}的页面不标注撤稿，这一条没有核对撤稿状态`],
      summary: `已核实：与${db}一致${src}`,
    };
  }
  const rule = "已核实需要题名、刊名、年份、作者都对得上，并且卷号、期号或起始页至少一项与记录一致";
  if (s.yearDiff !== 0) {
    return {
      ...common, verdict: "near_match", matchStatus: "candidate", confidence: 0.6,
      summary: `在${site}找到题名、作者、刊名一致的文章，但年份相差一年（引用 ${ref.year}，${db} ${recordYears(rec).join(" / ")}），请打开链接核对`,
      notes: [...common.notes, `${rule}；这一条年份差一年，可能是在线首发与刊期年份不同，不能确认，也不算写错`],
    };
  }
  const where = [rec.year ? `${rec.year} 年` : "", rec.volume ? `第 ${rec.volume} 卷` : "", rec.issue ? `第 ${rec.issue} 期` : "", rec.pages ? ` ${rec.pages} 页` : ""].join("");
  const missing = rec.volume ? "" : rec.issue ? "，没有卷号" : "，没有卷期";
  return {
    ...common, verdict: "near_match", matchStatus: "candidate", confidence: 0.6,
    summary: `在${site}找到题名、作者、刊名、年份一致的文章，但卷期页码没能核对（${db}为 ${where}${missing}），请打开链接核对卷期页码`,
    notes: [...common.notes, `${rule}；这一条只差卷期页码：引文写的卷号、期号、起始页在${db}里都对不上或没有，不能确认，也不算写错`],
  };
}

function judgeNotSame(ref: ParsedRef, best: Ranked | undefined, steps: CheckStep[], ev: DoiEvidence): RefResult {
  const b = base(ref, steps);
  const near = best?.score.partial ? best : undefined;
  const nearPart = near
    ? {
        match: near.rec,
        matchStatus: "candidate" as const,
        fields: fieldChecks(ref, near.rec, near.score),
        // 知网、万方的网页记录没有作者或完整页码，拼出的写法缺项，复制过去反而丢信息，不给
        suggestion: near.rec.source === "web" && (near.rec.authors.length === 0 || !fullPages(near.rec)) ? undefined : suggestCitation(near.rec, ref.raw),
      }
    : {};

  if (ev.openalexSkipped) {
    const issues: string[] = [];
    if (ref.doi && ev.registry?.exists === false) issues.push(`DOI ${ref.doi} 在 doi.org 查无注册记录`);
    else if (ev.doiRecord) issues.push(`DOI 指向《${short(ev.doiRecord.title)}》，与引用内容不符`);
    // DOI 确认写错才算信息有误；只有相近候选时不能确认是同一篇，也就说不上哪里写错
    return {
      ...b, ...nearPart, issues,
      verdict: near ? (issues.length ? "mismatch" : "near_match") : "unverifiable", confidence: near ? 0.5 : 0,
      notes: ["OpenAlex 检索额度已用完，本条的文献检索尚不完整，证据不足以判断文献不存在"],
      summary: near
        ? issues.length ? "DOI 有误；找到相近文献，但检索尚不完整，请人工核对" : "找到相近文献，但检索尚不完整，不能确认是同一篇，请人工核对"
        : "检索覆盖不完整，暂时无法确认，请人工核查或稍后重试",
    };
  }

  if (ref.doi && ev.registry?.exists === false) {
    const issues = [`DOI ${ref.doi} 在 doi.org 查无注册记录`];
    if (near) {
      return {
        ...b, ...nearPart, issues,
        verdict: "mismatch", confidence: 0.5,
        summary: "DOI 不存在；检索到一篇相近的文献，请核对是否为同一篇",
      };
    }
    issues.push("Crossref 中也检索不到题名、作者相符的文献");
    return { ...b, issues, verdict: "not_found", confidence: 0.9, summary: "DOI 未注册，且检索不到同名文献，疑似编造" };
  }

  if (ref.doi && ev.doiRecord) {
    const d = ev.doiRecord;
    const issues = [
      `DOI ${ref.doi} 实际指向《${short(d.title, 60)}》（${formatAuthorsShort(d.authors, 3) || "作者不详"}，${d.year ?? "年份不详"}），与引用内容不符`,
    ];
    if (near) {
      return {
        ...b, ...nearPart, issues,
        verdict: "mismatch", confidence: 0.5,
        summary: "DOI 张冠李戴；另检索到一篇相近的文献，请核对",
      };
    }
    issues.push("检索不到与引用题名、作者相符的文献");
    return { ...b, issues, verdict: "not_found", confidence: 0.85, summary: "DOI 指向的是另一篇文献，引用内容疑似编造" };
  }

  if (ref.doi && ev.registry?.exists) {
    if (ev.doiRegistered) {
      return {
        ...b, verdict: "unverifiable", confidence: 0,
        notes: [`中国 DOI 注册机构登记的题名、作者与引文一致，文献存在（${ev.doiRegistered.url}）；登记信息里没有年份、期刊和卷期页，这几项请对照原文核对`],
        summary: "DOI 登记的题名、作者与引文一致；年份、期刊、卷期页没有可比对的记录，请人工核对",
      };
    }
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      notes: [`DOI 已在 ${ev.registry.ra ?? "注册机构"} 注册，可打开 https://doi.org/${ref.doi} 人工核对`],
      summary: "DOI 已注册，但注册机构不提供可比对的元数据，请人工核对",
    };
  }

  const scope = OUT_OF_SCOPE[ref.kind];
  if (scope) {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      summary: `${scope}类文献不在开放学术数据库的覆盖范围内，请人工核查`,
    };
  }
  if (nameOnly(ref)) {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      summary: "引文只写了名称，没有作者、年份或 DOI，信息不足以核验，请补全后再查",
    };
  }
  // 粘进来的是一段正文而不是参考文献：别再提示“去知网核查”或给相近候选（可用性走查，10-18）
  if (notReference(ref)) {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      summary: "这段文字看起来不像参考文献（没有年份、出处或 DOI），没有核查依据；如果确实是参考文献，请补全后再查",
    };
  }
  // 在知网、万方、维普或期刊官网找到题名相近的文章、但不能确认是同一篇：给出候选和来源链接，请人工核对。
  // 知网、万方的搜索结果没有作者、原文页面又没读到时，最常见的就是这种情况
  if (near?.rec.source === "web") {
    const site = near.rec.site ?? "中文学术网站";
    const s = near.score;
    // 题名、年份一致，记录有刊名时刊名也一致：多半就是这一篇，只差作者核对不了
    const consistent = s.titleScore >= 0.9 && s.yearDiff === 0 && (!near.rec.venue || (s.venueScore ?? 0) >= 0.6);
    const what = `题名、${near.rec.venue ? "刊名、" : ""}年份`;
    if (near.rec.authors.length && consistent && chineseOrganizationCited(ref)) {
      return {
        ...b, ...nearPart, verdict: "near_match", confidence: 0.5,
        notes: [`引文署名是单位，${site}记录列的是执笔人（${formatAuthorsShort(near.rec.authors, 3)}），没法逐个比对；请打开来源页面核对`],
        summary: `在${site}找到${what}一致的文章；引文署名是单位，没法与${site}记录的作者比对，请打开链接核对`,
      };
    }
    if (near.rec.authors.length === 0) {
      return {
        ...b, ...nearPart, verdict: "near_match", confidence: 0.5,
        notes: [`${site}的搜索结果没有作者信息，原文页面也没有读到，无法确认是不是同一篇；请打开来源页面核对作者`],
        summary: consistent
          ? `在${site}找到${what}一致的文章，但没有作者信息，请打开链接核对作者`
          : `在${site}找到相近文章，但没有作者信息，不能确认是同一篇，请人工核对`,
      };
    }
    return {
      ...b, ...nearPart, verdict: "near_match", confidence: 0.5,
      notes: [`${site}上有题名相近的文章，但作者、年份或刊名没有吻合到能确认是同一篇；请打开来源页面核对`],
      summary: `在${site}找到相近文章，但不能确认是同一篇，请人工核对`,
    };
  }
  if (ref.lang === "zh") {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      // 联网查过也只说“没找到题名一致的”，查不到不代表不存在
      summary: ev.cnSearched
        ? "开放数据库和知网、万方、维普联网检索都没能核对到这篇文章；查不到不代表不存在，请人工核查"
        : "开放数据库对中文文献收录有限，未检索到不代表不存在，请到知网 / 万方核查",
    };
  }
  // 只找到相近候选：哪项信息写错要以确认同一篇为前提，所以单列为"相近候选"，不算信息有误
  if (near) {
    return {
      ...b, ...nearPart, verdict: "near_match", confidence: 0.55,
      notes: ["数据库中有一篇题名相近的记录，但题名、作者、年份或刊名没有吻合到能确认是同一篇；可能是引文格式特殊或数据库记录不全，也可能是引文写错了"],
      summary: "找到相近文献，但不能确认是同一篇，请人工核对",
    };
  }
  // 题名检索查不到，只对看得出是期刊、会议论文的引文才算证据（not_found 的定义）。没写编号的预印本（B056），
  // 以及类型认不出、又没写期刊名的引文（报告、法院文件、专利的写法五花八门：B054 / B055 / B059）可能根本不在收录范围内
  if (!ref.doi && ref.kind === "preprint") {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      summary: "预印本没有写 arXiv 编号或 DOI，开放数据库未必收录，查不到不代表不存在，请人工核查",
    };
  }
  if (!ref.doi && ref.kind === "unknown" && !ref.venueGuess) {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      summary: "引文没有写期刊、会议或 DOI，看不出是期刊论文，查不到不代表不存在，请人工核查",
    };
  }
  const searched = steps.filter((s) => s.action === "crossref_search" || s.action === "openalex_search").length;
  if (searched < 2) {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      notes: ["未完成两个数据源的题名检索，证据不足以判断文献不存在"],
      summary: "检索覆盖不完整，暂时无法确认，请人工核查或稍后重试",
    };
  }
  // AI 辅助解析摘出的题名只用来找候选，查不到时不作为“疑似不存在”的依据（与 AI 检索 Agent 同一原则）。
  // 10-17 第五批盲测：加拿大语言学会年会论文（B052）没有 DOI、不在两个库里，题名由模型摘出后被判成了疑似不存在
  if (ref.aiFields?.includes("title")) {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      notes: ["题名是 AI 从原文中摘出的（规则没解析出来），只用于检索候选；两个数据库都查不到时，不据此判断文献不存在"],
      summary: "按 AI 摘出的题名仍未检索到，查不到不代表不存在，请人工核查",
    };
  }
  return {
    ...b,
    verdict: "not_found",
    confidence: ref.titleGuess ? 0.75 : 0.6,
    issues: [`在 ${searched > 1 ? "Crossref 和 OpenAlex" : "Crossref"} 中都检索不到题名、作者相符的文献`],
    summary: "开放数据库中查无此文，疑似不存在（请人工复核）",
  };
}

/** 并发核验一组文献，每完成一条就回调一次（用于流式返回） */
export async function verifyAll(
  refs: ParsedRef[],
  onResult: (r: RefResult) => void,
  opts: {
    concurrency?: number;
    openalexBudget?: number;
    signal?: AbortSignal;
    /** 中文期刊联网核查：不传时配置了 DeepSeek 密钥就按默认额度开启；false 关闭 */
    cn?: CnBudget | false;
    /** 整个请求的时限（毫秒时间戳），快到时不再开始新的中文期刊联网核查 */
    deadline?: number;
  } = {},
): Promise<void> {
  const cn = opts.cn === false ? undefined : opts.cn ?? defaultCnBudget(opts.deadline);
  const ctx: VerifyContext = { openalexBudget: { left: opts.openalexBudget ?? 20 }, signal: opts.signal, cn };
  let next = 0;
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 3, refs.length) }, async () => {
    while (next < refs.length && !opts.signal?.aborted) {
      const ref = refs[next++];
      try {
        const result = await verifyReference(ref, ctx);
        if (!opts.signal?.aborted) onResult(result);
      } catch (err) {
        if (!opts.signal?.aborted) throw err;
      }
    }
  });
  await Promise.all(workers);
}
