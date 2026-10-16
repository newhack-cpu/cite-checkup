// AI 检索 Agent 可以调用的工具。只能查固定的几个学术数据源，参数逐项校验；
// 返回给模型的是精简后的候选和规则比对提示，返回给界面的是一句中文说明。
import { unwrapToolArguments } from "../tool-args";
import { extractDoi } from "../verify/extract";
import { formatAuthorsShort, scoreCandidate } from "../verify/match";
import { crossrefByDoi, crossrefFieldSearch } from "../verify/sources/crossref";
import { dataciteSearch } from "../verify/sources/datacite";
import { doiCsl, doiRegistry } from "../verify/sources/doi";
import { openalexSearchTitle } from "../verify/sources/openalex";
import type { ParsedRef, WorkRecord } from "../verify/types";

const string = (description: string) => ({ type: "string", description });
const reason = string("用一句简体中文（不超过 40 字）说明这次检索想验证什么。");

/** OpenAI 兼容的函数定义，按 DeepSeek tools 参数格式发送 */
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_crossref",
      description: "Search Crossref: journal articles, books, book chapters and proceedings that have DOIs. Best first choice.",
      parameters: {
        type: "object", additionalProperties: false, required: ["query", "reason"],
        properties: {
          query: string("Title or the most distinctive title words copied from the citation (original language). At most 300 characters."),
          author: string("Optional: one author surname copied from the citation."),
          year: { type: "integer", description: "Optional: publication year written in the citation; results are limited to ±1 year." },
          reason,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_openalex",
      description: "Search OpenAlex by title: broad index including theses, conference papers and preprints. Costly: at most once per reference.",
      parameters: {
        type: "object", additionalProperties: false, required: ["title", "reason"],
        properties: {
          title: string("Title copied from the citation. At most 300 characters."),
          year: { type: "integer", description: "Optional: publication year written in the citation; results are limited to ±1 year." },
          reason,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_datacite",
      description: "Search DataCite: software, datasets, reports, theses, arXiv and Zenodo records.",
      parameters: {
        type: "object", additionalProperties: false, required: ["query", "reason"],
        properties: { query: string("Title or distinctive keywords copied from the citation. At most 300 characters."), reason },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_doi",
      description: "Resolve a DOI that literally appears in the citation or in an earlier tool result. Never guess a DOI.",
      parameters: {
        type: "object", additionalProperties: false, required: ["doi", "reason"],
        properties: { doi: string("The DOI, e.g. 10.1000/xyz123."), reason },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Stop searching.",
      parameters: {
        type: "object", additionalProperties: false, required: ["note"],
        properties: { note: string("一到两句简体中文：查了哪些来源、找到了什么。不要判断文献真假，不要写网址。") },
      },
    },
  },
] as const;

export type ToolArgs =
  | { name: "search_crossref"; query: string; author?: string; year?: number; reason: string }
  | { name: "search_openalex"; title: string; year?: number; reason: string }
  | { name: "search_datacite"; query: string; reason: string }
  | { name: "lookup_doi"; doi: string; reason: string }
  | { name: "finish"; note: string };

export type SearchArgs = Exclude<ToolArgs, { name: "finish" }>;

/** 模型给的参数不合规：告诉模型错在哪，这次调用照样计入次数 */
export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgumentError";
  }
}

const ALLOWED_KEYS: Record<ToolArgs["name"], string[]> = {
  search_crossref: ["query", "author", "year", "reason"],
  search_openalex: ["title", "year", "reason"],
  search_datacite: ["query", "reason"],
  lookup_doi: ["doi", "reason"],
  finish: ["note"],
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const stripUrls = (s: string) => s.replace(/(?:https?:\/\/|www\.)\S+/gi, "").replace(/\s+/g, " ").trim();
// 模型只说明查了什么；出现真伪判断的说明一律不显示，避免看起来像 AI 给了结论
const VERDICT_WORDS = /编造|伪造|虚构|捏造|杜撰|真实存在|确实存在|确认存在|不存在|可信|靠谱|fabricat|fake|bogus|genuine|authentic|legitimate|verified|hallucinat/i;
export const guardNote = (note: string) => (VERDICT_WORDS.test(note) ? "" : note);

function text(args: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolArgumentError(`参数 ${key} 必须是文本`);
  const s = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) throw new ToolArgumentError(`参数 ${key} 超过 ${max} 个字符`);
  return s || undefined;
}

function required(args: Record<string, unknown>, key: string, max: number): string {
  const s = text(args, key, max);
  if (!s) throw new ToolArgumentError(`缺少参数 ${key}`);
  return s;
}

function year(args: Record<string, unknown>): number | undefined {
  const value = args.year;
  if (value === undefined || value === null) return undefined;
  const y = typeof value === "string" && /^\d{4}$/.test(value.trim()) ? Number(value) : value;
  if (typeof y !== "number" || !Number.isInteger(y) || y < 1800 || y > new Date().getFullYear() + 1) {
    throw new ToolArgumentError("参数 year 不是合理的出版年份");
  }
  return y;
}

export function parseToolCall(name: string, argumentsJson: string): ToolArgs {
  if (!Object.hasOwn(ALLOWED_KEYS, name)) throw new ToolArgumentError(`没有名为 ${name.slice(0, 40)} 的工具`);
  let args: unknown;
  try {
    args = unwrapToolArguments(JSON.parse(argumentsJson));
  } catch {
    throw new ToolArgumentError("参数不是有效的 JSON");
  }
  if (!isRecord(args)) throw new ToolArgumentError("参数必须是 JSON 对象");
  const extra = Object.keys(args).filter((key) => !ALLOWED_KEYS[name as ToolArgs["name"]].includes(key));
  if (extra.length) throw new ToolArgumentError(`不允许的参数：${extra.join(", ").slice(0, 80)}`);
  const why = guardNote(stripUrls(text(args, "reason", 120) ?? ""));
  switch (name as ToolArgs["name"]) {
    case "search_crossref":
      return { name: "search_crossref", query: required(args, "query", 300), author: text(args, "author", 80), year: year(args), reason: why };
    case "search_openalex":
      return { name: "search_openalex", title: required(args, "title", 300), year: year(args), reason: why };
    case "search_datacite":
      return { name: "search_datacite", query: required(args, "query", 300), reason: why };
    case "lookup_doi": {
      const doi = required(args, "doi", 200).toLowerCase().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/, "");
      if (!/^10\.\d{4,9}\/[^\s"<>]+$/.test(doi)) throw new ToolArgumentError("参数 doi 不是有效的 DOI");
      return { name: "lookup_doi", doi, reason: why };
    }
    case "finish":
      return { name: "finish", note: guardNote(stripUrls(text(args, "note", 300) ?? "")) };
  }
}

export interface ToolContext {
  ref: ParsedRef;
  signal?: AbortSignal;
  /** 只允许查询引文或检索结果里出现过的 DOI，防止模型凭空编 DOI */
  knownDois: Set<string>;
  /** OpenAlex 题名检索要消耗额度，单条文献限次 */
  openalexLeft: { left: number };
  /** 可选的共享额度（批量评测封顶用） */
  openalexPool?: { left: number };
  /** 给候选编号，便于模型在后续轮次里引用 */
  nextId: { n: number };
}

export interface ToolOutcome {
  records: WorkRecord[];
  /** 界面上显示的一句话 */
  detail: string;
  ok: boolean;
  /** 回传给模型的 JSON */
  forModel: Record<string, unknown>;
}

const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 规则比对给模型的提示，帮它调整下一次检索；不是结论 */
function fit(ref: ParsedRef, rec: WorkRecord) {
  const s = scoreCandidate(ref, rec);
  return {
    title: s.titleMissing ? "not_in_citation" : s.titleScore >= 0.8 ? "high" : s.titleScore >= 0.5 ? "partial" : "low",
    firstAuthor: s.firstAuthor,
    year: s.yearDiff === undefined ? "unknown" : s.yearDiff === 0 ? "match" : s.yearDiff === 1 ? "off_by_one" : "mismatch",
  };
}

function summarize(ctx: ToolContext, records: WorkRecord[]) {
  return records.slice(0, 5).map((rec) => ({
    id: `c${ctx.nextId.n++}`,
    title: short(rec.title, 200),
    authors: rec.authors.slice(0, 3).map((a) => a.family),
    year: rec.year ?? null,
    venue: rec.venue ? short(rec.venue, 120) : null,
    doi: rec.doi ?? null,
    type: rec.type ?? null,
    fit: fit(ctx.ref, rec),
  }));
}

/** 候选里和引文最接近的一条，用于界面说明 */
function closest(ref: ParsedRef, records: WorkRecord[]): WorkRecord | undefined {
  return [...records].sort((a, b) => scoreCandidate(ref, b).composite - scoreCandidate(ref, a).composite)[0];
}

function searchOutcome(ctx: ToolContext, label: string, records: WorkRecord[]): ToolOutcome {
  for (const rec of records) if (rec.doi) ctx.knownDois.add(rec.doi.toLowerCase());
  const best = closest(ctx.ref, records);
  const authors = best?.authors.length ? `（${formatAuthorsShort(best.authors, 2)}${best.year ? `，${best.year}` : ""}）` : "";
  return {
    records,
    ok: records.length > 0,
    detail: records.length ? `${label}：${records.length} 条候选，最接近《${short(best!.title)}》${authors}` : `${label}：没有结果`,
    forModel: { candidates: summarize(ctx, records) },
  };
}

export async function runTool(args: SearchArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const { signal } = ctx;
  switch (args.name) {
    case "search_crossref": {
      const { records } = await crossrefFieldSearch({ bibliographic: args.query, author: args.author, year: args.year }, 5, signal);
      const extras = [args.author && `作者 ${args.author}`, args.year && `${args.year}±1 年`].filter(Boolean).join("，");
      return searchOutcome(ctx, `Crossref 检索「${short(args.query, 30)}」${extras ? `（${extras}）` : ""}`, records);
    }
    case "search_openalex": {
      if (ctx.openalexLeft.left <= 0 || (ctx.openalexPool && ctx.openalexPool.left <= 0)) {
        return { records: [], ok: false, detail: "OpenAlex 检索次数已用完，本次未执行", forModel: { error: "search_openalex budget is used up" } };
      }
      ctx.openalexLeft.left--;
      if (ctx.openalexPool) ctx.openalexPool.left--;
      const { records } = await openalexSearchTitle(args.title, 5, signal, args.year);
      return searchOutcome(ctx, `OpenAlex 题名检索「${short(args.title, 30)}」${args.year ? `（${args.year}±1 年）` : ""}`, records);
    }
    case "search_datacite": {
      const { records } = await dataciteSearch(args.query, 5, signal);
      return searchOutcome(ctx, `DataCite 检索「${short(args.query, 30)}」`, records);
    }
    case "lookup_doi": {
      const doi = args.doi;
      if (!ctx.knownDois.has(doi)) {
        return {
          records: [], ok: false, detail: `DOI ${short(doi)} 没有出现在引文或检索结果中，未查询`,
          forModel: { error: "Only DOIs that appear in the citation or in earlier tool results may be looked up" },
        };
      }
      const { record } = await crossrefByDoi(doi, signal);
      if (record) return searchOutcome(ctx, `Crossref 查询 DOI ${short(doi)}`, [record]);
      const registry = await doiRegistry(doi, signal);
      if (registry.exists === false) {
        return { records: [], ok: false, detail: `doi.org：DOI ${short(doi)} 未注册`, forModel: { candidates: [], registered: false } };
      }
      const { record: csl } = registry.exists ? await doiCsl(doi, signal) : { record: undefined };
      if (csl) return searchOutcome(ctx, `doi.org 查询 DOI ${short(doi)}`, [csl]);
      return {
        records: [], ok: false, detail: `doi.org：DOI ${short(doi)} ${registry.exists ? `已在 ${registry.ra ?? "注册机构"} 注册，但没有可比对的元数据` : "注册状态无法确认"}`,
        forModel: { candidates: [], registered: registry.exists ?? null },
      };
    }
  }
}

/** 引文里出现的 DOI 都允许查询 */
export function citationDois(ref: ParsedRef): string[] {
  const doi = ref.doi ?? extractDoi(ref.raw);
  return doi ? [doi.toLowerCase()] : [];
}
