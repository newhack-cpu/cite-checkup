// DataCite：软件、数据集、报告、学位论文、arXiv 预印本、Zenodo 等由 DataCite 注册 DOI 的成果。免费，不需要密钥。
// 文档：https://support.datacite.org/docs/api-queries

import { getJson } from "../http";
import { compact, decodeEntities, isCjk } from "../normalize";
import type { Author, WorkRecord } from "../types";

const BASE = "https://api.datacite.org";

interface DataciteItem {
  id?: unknown;
  attributes?: {
    doi?: unknown;
    titles?: unknown;
    creators?: unknown;
    publicationYear?: unknown;
    publisher?: unknown;
    container?: unknown;
    types?: unknown;
  };
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const field = (v: unknown, key: string): unknown => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined);

/** DataCite 检索语法基于 Elasticsearch，括号、引号、冒号会被当成运算符，统一去掉 */
export function dataciteQuery(query: string): string {
  return query.normalize("NFKC").replace(/[^\p{L}\p{N}\s'-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 250);
}

function mapCreator(creator: unknown): Author | undefined {
  const family = text(field(creator, "familyName"));
  const given = text(field(creator, "givenName"));
  if (family) return isCjk(family[0]) ? { family: compact(family + (given ?? "")) } : { family, given };
  const name = text(field(creator, "name"));
  if (!name) return undefined;
  if (isCjk(name[0])) return { family: compact(name) };
  // "Esteban, Oscar" 这种写法拆成姓、名；机构名整串当作姓
  const comma = name.match(/^([^,]+),\s*(.+)$/);
  return comma ? { family: comma[1].trim(), given: comma[2].trim() } : { family: name };
}

export function mapDatacite(item: DataciteItem): WorkRecord | undefined {
  const a = item.attributes;
  const title = (Array.isArray(a?.titles) ? a.titles : []).map((t) => text(field(t, "title"))).find(Boolean);
  if (!a || !title) return undefined;
  const doi = text(a.doi) ?? text(item.id);
  const year = Number(a.publicationYear);
  const publisher = text(a.publisher) ?? text(field(a.publisher, "name"));
  return {
    source: "datacite",
    doi: doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? doi.toLowerCase() : undefined,
    title: decodeEntities(title).replace(/\s+/g, " ").trim(),
    authors: (Array.isArray(a.creators) ? a.creators : []).map(mapCreator).filter((x): x is Author => !!x),
    year: Number.isInteger(year) && year > 0 ? year : undefined,
    venue: text(field(a.container, "title")) ?? publisher,
    type: text(field(a.types, "resourceTypeGeneral")),
  };
}

export async function dataciteSearch(query: string, rows = 5, signal?: AbortSignal): Promise<{ records: WorkRecord[]; ms: number }> {
  const q = dataciteQuery(query);
  if (!q) return { records: [], ms: 0 };
  const params = new URLSearchParams({ query: q, "page[size]": String(rows) });
  const res = await getJson(`${BASE}/dois?${params}`, {
    signal,
    allowNotFound: false,
    validate: (json) => Array.isArray((json as { data?: unknown } | null)?.data),
  });
  if (res.status !== 200) return { records: [], ms: res.ms };
  const data = (res.json as { data: DataciteItem[] }).data;
  return { records: data.map(mapDatacite).filter((r): r is WorkRecord => !!r), ms: res.ms };
}
