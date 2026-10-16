// 单条文献的核验流程：
// 1. 有 DOI → Crossref 直查；查不到再问 doi.org 这个 DOI 是否注册、取元数据
// 2. DOI 没对上同一篇 → Crossref 整条引文模糊检索
// 3. 还没找到且是英文文献 → OpenAlex 题名检索兜底（消耗额度，按请求限次）
// 4. 选出最佳候选，逐字段比对后给出结论；所有"建议写法"都来自数据库记录

import { suggestCitation } from "./format";
import { UpstreamError } from "./http";
import { tokenCount } from "./normalize";
import {
  fieldChecks,
  formatAuthorsShort,
  fuzzyRecall,
  yearVaries,
  recordYears,
  scoreCandidate,
  venueSimilarity,
  type MatchScore,
} from "./match";
import { crossrefByDoi, crossrefJournals, crossrefSearch } from "./sources/crossref";
import { doiCsl, doiRegistry, type RegistryStatus } from "./sources/doi";
import { openalexByDoi, openalexSearchTitle, openalexSourceTitles } from "./sources/openalex";
import type { CheckStep, ParsedRef, RefKind, RefResult, WorkRecord } from "./types";

export interface VerifyContext {
  /** 本次请求里还允许发起几次 OpenAlex 题名检索 */
  openalexBudget: { left: number };
  signal?: AbortSignal;
}

interface Ranked {
  rec: WorkRecord;
  score: MatchScore;
}

interface DoiEvidence {
  doiRecord?: WorkRecord;
  registry?: RegistryStatus;
  openalexSkipped?: boolean;
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
};

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

function rank(ref: ParsedRef, candidates: WorkRecord[]): Ranked[] {
  const seen = new Set<string>();
  const list: Ranked[] = [];
  for (const rec of candidates) {
    if (!rec.title) continue;
    const key = rec.doi ?? rec.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ rec, score: scoreCandidate(ref, rec) });
  }
  return list.sort((a, b) => Number(b.score.same) - Number(a.score.same) || b.score.composite - a.score.composite);
}

export async function verifyReference(ref: ParsedRef, ctx: VerifyContext, extra?: ExtraEvidence): Promise<RefResult> {
  const steps: CheckStep[] = [];
  const candidates: WorkRecord[] = [];
  const evidence: DoiEvidence = {};

  try {
    ctx.signal?.throwIfAborted();
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

    const best = ranked[0];
    if (best?.score.same) {
      let rec = best.rec;
      const extraNotes: string[] = [];
      const score = await withVenueAlias(ref, rec, best.score, steps, ctx, extraNotes);
      // Crossref 撤稿元数据可能不完整，同样需要 OpenAlex 交叉核对。
      if (rec.doi && rec.source !== "openalex" && rec.retraction?.status !== "retracted" && rec.retraction?.status !== "withdrawn") {
        const doi = rec.doi;
        try {
          const oa = await step(steps, "openalex_lookup", () => openalexByDoi(doi, ctx.signal), (r) => ({
            detail: r.record ? (r.record.retraction ? "OpenAlex：该文献已被标记撤稿" : "OpenAlex：未发现撤稿标记") : "OpenAlex 中没有该 DOI，撤稿状态交叉核验未完成",
            ok: !!r.record,
          }));
          if (oa.record?.retraction) rec = { ...rec, retraction: oa.record.retraction };
          if (!oa.record) extraNotes.push("OpenAlex 未收录该 DOI，撤稿状态交叉核验未完成；已保留数据库中的文献信息，请人工核对出版社页面");
        } catch {
          ctx.signal?.throwIfAborted();
          extraNotes.push("OpenAlex 暂时不可用，撤稿状态交叉核验未完成；已保留数据库中的文献信息，请稍后重试或核对出版社页面");
        }
      }
      ctx.signal?.throwIfAborted();
      const result = judgeSame(ref, rec, score, steps, evidence);
      result.notes.push(...extraNotes);
      if (extraNotes.some((n) => n.includes("撤稿状态交叉核验未完成"))) result.summary += "；撤稿状态交叉核验未完成";
      return result;
    }
    const result = judgeNotSame(ref, best, steps, evidence);
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
      summary: err instanceof UpstreamError ? "数据源暂时不可用（可能被限流），请稍后重试" : "核验过程出错",
      issues: [String((err as Error)?.message ?? err)],
    };
  }
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

/** 下"查无此文"的结论前，确认引文写的期刊在该年份是否在 Crossref 收录范围内 */
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

  if (ref.doi && rec.doi && ref.doi !== rec.doi) {
    if (ev.registry?.exists === false) issues.push(`引用中的 DOI ${ref.doi} 并不存在，正确 DOI 应为 ${rec.doi}`);
    else if (ev.doiRecord && ev.doiRecord.doi !== rec.doi)
      issues.push(`引用中的 DOI 指向另一篇文献《${short(ev.doiRecord.title)}》，正确 DOI 应为 ${rec.doi}`);
    else issues.push(`DOI 与数据库记录不一致，数据库记录为 ${rec.doi}`);
  }
  if (s.authorRatio !== undefined) {
    if (s.authorsReordered) notes.push(`引用列出的作者都在数据库记录中，但顺序不同（数据库为 ${formatAuthorsShort(rec.authors)}）；Crossref 的中文记录有时把作者顺序登记错，请以原文为准`);
    else if (s.authorRatio === 0) issues.push(`作者与数据库记录不符，数据库作者为 ${formatAuthorsShort(rec.authors)}`);
    else if (s.firstAuthor === "mismatch") issues.push(`第一作者不符，数据库第一作者为 ${formatAuthorsShort(rec.authors.slice(0, 1))}`);
    else if (s.authorOrderOk === false) issues.push(`作者顺序与数据库不一致，数据库顺序为 ${formatAuthorsShort(rec.authors)}`);
    else if (s.authorListMismatch) issues.push(`引用中有作者姓名与数据库记录不符，数据库作者为 ${formatAuthorsShort(rec.authors)}`);
  }
  if (s.yearDiff !== undefined) {
    const dbYears = recordYears(rec).join(" / ");
    if (s.yearDiff > 1 && yearVaries(ref, rec)) notes.push(`数据库记录的年份为 ${dbYears}，引用写 ${ref.year}；图书、学位论文常有多个版本或后来的存档记录，请核对所引版本`);
    else if (s.yearDiff > 1) issues.push(`年份不符：引用写 ${ref.year}，数据库记录为 ${dbYears}`);
    else if (s.yearDiff === 1)
      notes.push(`年份相差一年（引用 ${ref.year}，数据库 ${dbYears}），可能是在线发表与正式出版年份不同`);
  }
  if (s.titleMissing) notes.push("引用中没有写题名，已按作者、刊名、卷号和页码与数据库记录核对");
  if (fields.find((f) => f.field === "venue")?.status === "mismatch")
    issues.push(`期刊名不符：引用写「${ref.venueGuess}」，数据库记录为「${rec.venue}」`);
  if (fields.find((f) => f.field === "title")?.status === "partial") notes.push("题名与数据库记录不完全一致，请核对用词");
  if (fields.find((f) => f.field === "title")?.status === "mismatch") issues.push(`题名与数据库记录不符，数据库题名为《${rec.title}》`);
  if (!ref.doi && rec.doi) notes.push(`建议补充 DOI：${rec.doi}`);

  const common = {
    ...base(ref, steps),
    match: rec,
    matchStatus: "confirmed" as const,
    fields,
    issues,
    notes,
    suggestion: suggestCitation(rec, ref.raw),
  };

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
  const src = `（来源：${SOURCE_LABEL[rec.source]}）`;
  if (issues.length) {
    return { ...common, verdict: "mismatch", confidence, summary: `文献存在，但有 ${issues.length} 处信息与数据库记录不一致${src}` };
  }
  return { ...common, verdict: "verified", confidence, summary: `已核实：与数据库记录一致${src}` };
}

function judgeNotSame(ref: ParsedRef, best: Ranked | undefined, steps: CheckStep[], ev: DoiEvidence): RefResult {
  const b = base(ref, steps);
  const near = best?.score.partial ? best : undefined;
  const nearPart = near
    ? {
        match: near.rec,
        matchStatus: "candidate" as const,
        fields: fieldChecks(ref, near.rec, near.score),
        suggestion: suggestCitation(near.rec, ref.raw),
      }
    : {};

  if (ev.openalexSkipped) {
    const issues: string[] = [];
    if (ref.doi && ev.registry?.exists === false) issues.push(`DOI ${ref.doi} 在 doi.org 查无注册记录`);
    else if (ev.doiRecord) issues.push(`DOI 指向《${short(ev.doiRecord.title)}》，与引用内容不符`);
    return {
      ...b, ...nearPart, issues,
      verdict: near ? "mismatch" : "unverifiable", confidence: near ? 0.5 : 0,
      notes: ["OpenAlex 检索额度已用完，本条的文献检索尚不完整，证据不足以判断文献不存在"],
      summary: near ? "找到相近文献，但检索尚不完整，请人工核对" : "检索覆盖不完整，暂时无法确认，请人工核查或稍后重试",
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
  // 只有一个名称、没有作者、年份和 DOI 的条目（"Nutrition landscape information system (NLiS)"）：
  // 相近的候选和查不到都说明不了什么
  if (!ref.year && !ref.authorsGuess && !ref.doi && tokenCount(ref.raw) <= 8) {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      summary: "引文只写了名称，没有作者、年份或 DOI，信息不足以核验，请补全后再查",
    };
  }
  if (ref.lang === "zh") {
    return {
      ...b, verdict: "unverifiable", confidence: 0,
      summary: "开放数据库对中文文献收录有限，未检索到不代表不存在，请到知网 / 万方核查",
    };
  }
  if (near) {
    return {
      ...b, ...nearPart, verdict: "mismatch", confidence: 0.55,
      issues: ["找到题名相近的文献，但题名或作者与引用有出入"],
      summary: "找到相近文献，但信息有出入，请核对是否为同一篇",
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
  opts: { concurrency?: number; openalexBudget?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const ctx: VerifyContext = { openalexBudget: { left: opts.openalexBudget ?? 20 }, signal: opts.signal };
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
