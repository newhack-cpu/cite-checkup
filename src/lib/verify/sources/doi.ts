// doi.org：判断 DOI 是否注册（覆盖 Crossref、DataCite、中文 DOI 等所有注册机构），
// 并通过内容协商拿 CSL-JSON 元数据（主要用于 arXiv 等 DataCite DOI）。

import { getJson, UpstreamError, type FetchResult } from "../http";
import { compact, decodeEntities, isCjk } from "../normalize";
import type { Author, WorkRecord } from "../types";
import { doiPath, otherYears, validIssns, yearOf, type DateParts } from "./crossref";

export interface RegistryStatus {
  /** true：已注册；false：未注册；undefined：无法判断 */
  exists?: boolean;
  /** 注册机构，比如 Crossref、DataCite、ISTIC */
  ra?: string;
  ms: number;
}

export async function doiRegistry(doi: string, signal?: AbortSignal): Promise<RegistryStatus> {
  const res = await getJson(`https://doi.org/ra/${doiPath(doi)}`, {
    signal,
    validate: (json) => Array.isArray(json) && !!json[0] && typeof json[0] === "object"
      && (typeof json[0].RA === "string" || typeof json[0].status === "string"),
  });
  const first = Array.isArray(res.json) ? (res.json[0] as { RA?: string; status?: string }) : undefined;
  if (!first) return { ms: res.ms };
  if (first.RA) return { exists: true, ra: first.RA, ms: res.ms };
  if (first.status && /does not exist/i.test(first.status)) return { exists: false, ms: res.ms };
  return { ms: res.ms };
}

interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

interface CslItem {
  DOI?: string;
  title?: string | string[];
  author?: CslName[];
  issued?: DateParts;
  "published-print"?: DateParts;
  "published-online"?: DateParts;
  "container-title"?: string | string[];
  ISSN?: string | string[];
  publisher?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  type?: string;
  URL?: string;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function mapCslAuthors(list: CslName[] | undefined): Author[] {
  return (list ?? [])
    .map((a) => {
      const family = (a.family ?? a.literal ?? "").trim();
      if (!family) return undefined;
      return isCjk(family[0]) ? { family: compact(family + (a.given ?? "")) } : { family, given: a.given };
    })
    .filter((a): a is Author => !!a);
}

export async function doiCsl(doi: string, signal?: AbortSignal): Promise<{ record?: WorkRecord; ms: number }> {
  const started = Date.now();
  let res: FetchResult;
  try {
    res = await getJson(`https://doi.org/${doiPath(doi)}`, {
      headers: { Accept: "application/vnd.citationstyles.csl+json" },
      signal,
      validate: (json) => {
        const title = (json as CslItem | null)?.title;
        return typeof title === "string" ? !!title.trim() : Array.isArray(title) && typeof title[0] === "string" && !!title[0].trim();
      },
    });
  } catch (err) {
    // 知网等注册机构不支持内容协商，doi.org 会跳到网页并返回 200 的 HTML：这是"没有元数据"，不是查询故障
    if (err instanceof UpstreamError && err.status === 200) return { ms: Date.now() - started };
    throw err;
  }
  if (res.status !== 200 || !res.json) return { ms: res.ms };
  const it = res.json as CslItem;
  const title = first(it.title);
  if (!title) return { ms: res.ms };
  const year = yearOf(it.issued);
  const venue = first(it["container-title"]) || it.publisher;
  return {
    record: {
      source: "doi-csl",
      doi: (it.DOI ?? doi).toLowerCase(),
      title: decodeEntities(title),
      authors: mapCslAuthors(it.author),
      year,
      years: otherYears(year, [it["published-print"], it["published-online"]]),
      venue: venue ? decodeEntities(venue) : undefined,
      issn: validIssns(it.ISSN),
      volume: it.volume?.toString(),
      issue: it.issue?.toString(),
      pages: it.page,
      type: it.type,
      url: it.URL,
    },
    ms: res.ms,
  };
}
