// OpenAlex：按 DOI 查询免费（不消耗额度），用于撤稿交叉核对；
// 题名检索每次消耗 10 credits（无 key 每天 1000 credits），只作为 Crossref 查不到时的兜底。

import { getJson } from "../http";
import { compact, decodeEntities, isCjk } from "../normalize";
import type { Author, WorkRecord } from "../types";
import { doiPath } from "./crossref";

const BASE = "https://api.openalex.org";
const SELECT = "id,doi,title,publication_year,authorships,primary_location,is_retracted,type,biblio";

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string; type?: string | null } | null } | null;
  is_retracted?: boolean;
  type?: string;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
}

function withKey(params: URLSearchParams): URLSearchParams {
  const key = process.env.OPENALEX_API_KEY;
  if (key) params.set("api_key", key);
  return params;
}

/** OpenAlex 只给显示名，这里拆成姓 / 名：中文名整体当姓，西文名取最后一个词 */
function splitName(display: string): Author {
  const name = display.trim();
  if (isCjk(name[0])) return { family: compact(name) };
  const parts = name.split(/\s+/);
  return parts.length === 1 ? { family: name } : { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

export function mapOpenAlex(w: OpenAlexWork): WorkRecord {
  const b = w.biblio ?? {};
  const pages = b.first_page ? (b.last_page && b.last_page !== b.first_page ? `${b.first_page}-${b.last_page}` : b.first_page) : undefined;
  return {
    source: "openalex",
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() : undefined,
    title: decodeEntities(w.title ?? ""),
    authors: (w.authorships ?? []).map((a) => a.author?.display_name).filter((n): n is string => !!n).map(splitName),
    year: w.publication_year ?? undefined,
    // 首要位置是机构知识库（"Lund University Publications"）时，那不是期刊名，不拿来和引文比对
    venue: w.primary_location?.source?.display_name && w.primary_location.source.type !== "repository"
      ? decodeEntities(w.primary_location.source.display_name) : undefined,
    volume: b.volume ?? undefined,
    issue: b.issue ?? undefined,
    pages,
    type: w.type,
    url: w.id,
    retraction: w.is_retracted ? { status: "retracted", source: "openalex" } : undefined,
  };
}

function validWork(value: unknown): value is OpenAlexWork {
  if (!value || typeof value !== "object") return false;
  const work = value as OpenAlexWork;
  return typeof work.title === "string" && !!work.title.trim()
    && (work.doi == null || typeof work.doi === "string")
    && (work.authorships === undefined || Array.isArray(work.authorships))
    && (work.is_retracted === undefined || typeof work.is_retracted === "boolean");
}

/** OpenAlex 的已识别记录可能没有题名，不能让它覆盖同批中可核对的候选。 */
function untitledWork(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const work = value as OpenAlexWork;
  const identified = typeof work.id === "string" && /^https:\/\/openalex\.org\/W\d+$/.test(work.id)
    || typeof work.doi === "string" && /^(?:https?:\/\/doi\.org\/)?10\.\d{4,9}\/.+/i.test(work.doi);
  return identified && (work.title == null || (typeof work.title === "string" && !work.title.trim()))
    && (work.doi == null || typeof work.doi === "string")
    && (work.authorships === undefined || Array.isArray(work.authorships))
    && (work.is_retracted === undefined || typeof work.is_retracted === "boolean");
}

export async function openalexByDoi(doi: string, signal?: AbortSignal): Promise<{ record?: WorkRecord; ms: number }> {
  const params = withKey(new URLSearchParams({ select: SELECT }));
  const res = await getJson(`${BASE}/works/doi:${doiPath(doi)}?${params}`, {
    signal,
    validate: (json) => validWork(json) && typeof json.is_retracted === "boolean" && typeof json.doi === "string"
      && json.doi.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() === doi.toLowerCase(),
  });
  if (res.status !== 200 || !res.json) return { ms: res.ms };
  return { record: mapOpenAlex(res.json as OpenAlexWork), ms: res.ms };
}

export async function openalexSearchTitle(
  title: string,
  rows = 5,
  signal?: AbortSignal,
  year?: number,
): Promise<{ records: WorkRecord[]; ms: number }> {
  // filter 的值里逗号、竖线、冒号有特殊含义；问号、星号是通配符，title.search 遇到就返回 400。统一换成空格
  const q = title.replace(/[,|:：，?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 250);
  const filter = year ? `title.search:${q},publication_year:${year - 1}-${year + 1}` : `title.search:${q}`;
  const params = withKey(new URLSearchParams({ filter, "per-page": String(rows), select: SELECT }));
  const res = await getJson(`${BASE}/works?${params}`, {
    signal,
    allowNotFound: false,
    validate: (json) => {
      const results = (json as { results?: unknown } | null)?.results;
      return Array.isArray(results) && results.every((work) => validWork(work) || untitledWork(work))
        && (results.length === 0 || results.some(validWork));
    },
  });
  if (res.status !== 200) return { records: [], ms: res.ms };
  const results = (res.json as { results?: OpenAlexWork[] })?.results ?? [];
  return { records: results.filter(validWork).map(mapOpenAlex), ms: res.ms };
}

interface OpenAlexSource {
  display_name?: unknown;
  alternate_titles?: unknown;
}

/** 按 ISSN 取期刊登记过的其他名称（外文刊名、旧刊名、缩写）；单条查询免费，不消耗额度 */
export async function openalexSourceTitles(issn: string, signal?: AbortSignal): Promise<{ titles: string[]; ms: number }> {
  const params = withKey(new URLSearchParams({ select: "display_name,alternate_titles" }));
  const res = await getJson(`${BASE}/sources/issn:${encodeURIComponent(issn)}?${params}`, {
    signal,
    validate: (json) => {
      const s = json as OpenAlexSource | null;
      return !!s && typeof s.display_name === "string"
        && (s.alternate_titles == null || (Array.isArray(s.alternate_titles) && s.alternate_titles.every((t) => typeof t === "string")));
    },
  });
  if (res.status !== 200 || !res.json) return { titles: [], ms: res.ms };
  const s = res.json as { display_name: string; alternate_titles?: string[] | null };
  const titles = [s.display_name, ...(s.alternate_titles ?? [])].map((t) => decodeEntities(t).trim()).filter(Boolean);
  return { titles: [...new Set(titles)], ms: res.ms };
}
