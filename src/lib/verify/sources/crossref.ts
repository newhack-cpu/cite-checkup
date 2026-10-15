// Crossref REST API：按 DOI 取元数据（含 Retraction Watch 撤稿标记）、按整条引文模糊检索。
// 文档：https://api.crossref.org/swagger-ui/index.html

import { getJson } from "../http";
import { compact, decodeEntities, isCjk, stripTags } from "../normalize";
import type { Author, RetractionInfo, WorkRecord } from "../types";

const BASE = "https://api.crossref.org";
const SELECT = [
  "DOI", "title", "subtitle", "author", "issued", "published-print", "published-online", "container-title", "short-container-title",
  "ISSN", "volume", "issue", "page", "article-number", "type", "score", "updated-by", "URL",
].join(",");

interface CrossrefAuthor {
  family?: string;
  given?: string;
  name?: string;
}

interface CrossrefUpdate {
  type?: string;
  source?: string;
  DOI?: string;
  updated?: { "date-time"?: string };
}

export type DateParts = { "date-parts"?: (number | string | null)[][] };

export interface CrossrefItem {
  DOI?: string;
  title?: string[];
  subtitle?: string[];
  author?: CrossrefAuthor[];
  issued?: DateParts;
  "published-print"?: DateParts;
  "published-online"?: DateParts;
  "container-title"?: string[];
  "short-container-title"?: string[];
  ISSN?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  "article-number"?: string;
  type?: string;
  score?: number;
  "updated-by"?: CrossrefUpdate[];
  URL?: string;
}

export function yearOf(date: DateParts | undefined): number | undefined {
  const y = Number(date?.["date-parts"]?.[0]?.[0]);
  return Number.isInteger(y) && y > 0 ? y : undefined;
}

/** 在线首发、纸本出版等日期里与主年份不同的年份：引文写其中任何一个都不算错 */
export function otherYears(main: number | undefined, dates: (DateParts | undefined)[]): number[] | undefined {
  const years = new Set(dates.map(yearOf).filter((y): y is number => y !== undefined && y !== main));
  return years.size ? [...years].sort((a, b) => a - b) : undefined;
}

export function validIssns(list: unknown): string[] | undefined {
  const issns = (Array.isArray(list) ? list : [list]).filter((v): v is string => typeof v === "string" && /^\d{4}-\d{3}[\dX]$/i.test(v));
  return issns.length ? [...new Set(issns.map((v) => v.toUpperCase()))] : undefined;
}

function withMailto(params: URLSearchParams): URLSearchParams {
  const mailto = process.env.CROSSREF_MAILTO;
  if (mailto) params.set("mailto", mailto);
  return params;
}

export function doiPath(doi: string): string {
  return doi.split("/").map(encodeURIComponent).join("/");
}

/** 中文作者有时被整串塞进 family（"张三，李四"），这里拆开 */
export function mapAuthors(list: CrossrefAuthor[] | undefined): Author[] {
  const out: Author[] = [];
  for (const a of list ?? []) {
    const family = (a.family ?? a.name ?? "").trim();
    const given = a.given?.trim() || undefined;
    if (!family) continue;
    if (isCjk(family[0]) && /[，,、;；]/.test(family)) {
      for (const part of family.split(/[，,、;；]/)) if (part.trim()) out.push({ family: compact(part) });
      continue;
    }
    out.push({ family, given });
  }
  return out;
}

const RETRACTION_RANK: Record<RetractionInfo["status"], number> = { retracted: 3, withdrawn: 2, concern: 1 };

export function mapRetraction(updates: CrossrefUpdate[] | undefined): RetractionInfo | undefined {
  let best: RetractionInfo | undefined;
  for (const u of updates ?? []) {
    const status: RetractionInfo["status"] | undefined =
      u.type === "retraction" || u.type === "removal"
        ? "retracted"
        : u.type === "withdrawal"
          ? "withdrawn"
          : u.type === "expression_of_concern" || u.type === "partial_retraction"
            ? "concern"
            : undefined;
    if (!status) continue;
    if (!best || RETRACTION_RANK[status] > RETRACTION_RANK[best.status]) {
      best = { status, noticeDoi: u.DOI, date: u.updated?.["date-time"]?.slice(0, 10), source: u.source };
    }
  }
  return best;
}

export function mapCrossref(it: CrossrefItem): WorkRecord {
  const year = yearOf(it.issued);
  const title = decodeEntities(stripTags(it.title?.[0] ?? "")).replace(/\s+/g, " ").trim();
  const prefix = title.match(/^(retracted(?: article)?|withdrawn)\s*[:：]/i)?.[1].toLowerCase();
  const prefixRetraction: RetractionInfo | undefined = prefix
    ? { status: prefix === "withdrawn" ? "withdrawn" : "retracted", source: "crossref-title" }
    : undefined;
  const updateRetraction = mapRetraction(it["updated-by"]);
  const retraction = prefixRetraction && (!updateRetraction || RETRACTION_RANK[prefixRetraction.status] > RETRACTION_RANK[updateRetraction.status])
    ? prefixRetraction : updateRetraction;
  return {
    source: "crossref",
    doi: it.DOI?.toLowerCase(),
    title,
    subtitle: it.subtitle?.[0] ? decodeEntities(stripTags(it.subtitle[0])).trim() : undefined,
    authors: mapAuthors(it.author),
    year,
    years: otherYears(year, [it["published-print"], it["published-online"]]),
    venue: it["container-title"]?.[0] ? decodeEntities(it["container-title"][0]) : undefined,
    venueShort: it["short-container-title"]?.[0] ? decodeEntities(it["short-container-title"][0]) : undefined,
    issn: validIssns(it.ISSN),
    volume: it.volume,
    issue: it.issue,
    pages: it.page ?? it["article-number"],
    type: it.type,
    url: it.URL,
    retraction,
  };
}

function validItem(value: unknown): value is CrossrefItem {
  if (!value || typeof value !== "object") return false;
  const item = value as CrossrefItem;
  return Array.isArray(item.title) && item.title.some((t) => typeof t === "string" && !!t.trim())
    && item.title.every((t) => typeof t === "string")
    && (item.DOI === undefined || typeof item.DOI === "string")
    && (item.author === undefined || Array.isArray(item.author));
}

/** 部分合法 Crossref 记录未提供题名：仅在可识别 DOI 且其余关键字段结构正常时跳过。 */
function untitledItem(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as CrossrefItem;
  return typeof item.DOI === "string" && /^10\.\d{4,9}\/.+/.test(item.DOI)
    && (item.title === undefined || (Array.isArray(item.title) && item.title.every((t) => typeof t === "string" && !t.trim())))
    && (item.author === undefined || Array.isArray(item.author));
}

export async function crossrefByDoi(doi: string, signal?: AbortSignal): Promise<{ record?: WorkRecord; ms: number }> {
  const params = withMailto(new URLSearchParams());
  const qs = params.toString();
  const res = await getJson(`${BASE}/works/${doiPath(doi)}${qs ? "?" + qs : ""}`, {
    signal,
    validate: (json) => validItem((json as { message?: unknown } | null)?.message),
  });
  if (res.status !== 200) return { ms: res.ms };
  const msg = (res.json as { message?: CrossrefItem })?.message;
  return { record: msg ? mapCrossref(msg) : undefined, ms: res.ms };
}

/** 把整条引文丢给 Crossref 的 query.bibliographic，它对各种引文格式都比较鲁棒 */
export async function crossrefSearch(
  query: string,
  rows = 5,
  signal?: AbortSignal,
): Promise<{ records: (WorkRecord & { score?: number })[]; ms: number }> {
  const cleaned = query
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(doi\s*[:：]?\s*)?10\.\d{4,9}\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  const params = withMailto(new URLSearchParams({ "query.bibliographic": cleaned, rows: String(rows), select: SELECT }));
  const res = await getJson(`${BASE}/works?${params}`, {
    signal,
    allowNotFound: false,
    validate: (json) => {
      const items = (json as { message?: { items?: unknown } } | null)?.message?.items;
      return Array.isArray(items) && items.every((item) => validItem(item) || untitledItem(item))
        && (items.length === 0 || items.some(validItem));
    },
  });
  if (res.status !== 200) return { records: [], ms: res.ms };
  const items = (res.json as { message?: { items?: CrossrefItem[] } })?.message?.items ?? [];
  return { records: items.filter(validItem).map((it) => ({ ...mapCrossref(it), score: it.score })), ms: res.ms };
}

interface CrossrefJournal {
  title?: unknown;
  ISSN?: unknown;
  breakdowns?: { "dois-by-issued-year"?: unknown };
}

export interface JournalCoverage {
  title: string;
  issn: string[];
  /** Crossref 中该刊有文献记录的最早、最晚出版年份 */
  firstYear?: number;
  lastYear?: number;
}

/** 在 Crossref 期刊目录里按刊名检索，带回每本刊有文献记录的年份范围（不消耗任何额度） */
export async function crossrefJournals(query: string, signal?: AbortSignal): Promise<{ journals: JournalCoverage[]; ms: number }> {
  const params = withMailto(new URLSearchParams({ query: query.replace(/\s+/g, " ").trim().slice(0, 200), rows: "10" }));
  const res = await getJson(`${BASE}/journals?${params}`, {
    signal,
    allowNotFound: false,
    validate: (json) => Array.isArray((json as { message?: { items?: unknown } } | null)?.message?.items),
  });
  if (res.status !== 200) return { journals: [], ms: res.ms };
  const items = (res.json as { message: { items: CrossrefJournal[] } }).message.items;
  const journals: JournalCoverage[] = [];
  for (const j of items) {
    const issn = validIssns(j.ISSN);
    if (typeof j.title !== "string" || !j.title.trim() || !issn) continue;
    const byYear = j.breakdowns?.["dois-by-issued-year"];
    const years = (Array.isArray(byYear) ? byYear : [])
      .filter((p): p is [number, number] => Array.isArray(p) && Number.isInteger(p[0]) && Number(p[1]) > 0)
      .map((p) => p[0]);
    journals.push({
      title: decodeEntities(j.title),
      issn,
      firstYear: years.length ? Math.min(...years) : undefined,
      lastYear: years.length ? Math.max(...years) : undefined,
    });
  }
  return { journals, ms: res.ms };
}
