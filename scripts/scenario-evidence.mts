// 场景测试一的查证材料：对大模型写出的每条参考文献，收集判定真假要看的客观证据——
// DOI 是否注册、注册在哪、指向哪篇论文；按题名在 Crossref、OpenAlex 检索到的最接近记录。
// 只收集证据、不下结论；真值由人对照这些证据（必要时再做网页检索）逐条判定，写进 truth.json。
// 用法：NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/scenario-evidence.mts [eval/scenario-2026-10-23] [--only=edu]
//   --only  只查某一份列表（可以几份并行跑）；每查完一条就写盘，中断后重跑会跳过已查过的条目

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractDoi, splitReferences } from "../src/lib/verify/extract";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "eval/scenario-2026-10-23";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const generated = JSON.parse(readFileSync(join(dir, "generated.json"), "utf8")) as { lists: { id: string; text: string }[] };
const UA = "cite-checkup-scenario/0.1 (https://github.com/newhack-cpu/cite-checkup)";

async function getJson(url: string, accept = "application/json"): Promise<{ status: number; json?: unknown }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      return { status: res.status, json: res.ok ? await res.json() : undefined };
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return { status: 0 };
}

interface Work { source: string; doi?: string; title?: string; authors?: string[]; year?: number; venue?: string; volume?: string; issue?: string; pages?: string }

interface CrossrefItem {
  DOI?: string; title?: string[]; author?: { family?: string; name?: string }[]; issued?: { "date-parts"?: number[][] };
  "container-title"?: string[]; volume?: string; issue?: string; page?: string;
}
interface CslItem {
  DOI?: string; title?: string | string[]; author?: { family?: string; literal?: string }[]; issued?: { "date-parts"?: number[][] };
  "container-title"?: string | string[]; volume?: string; issue?: string; page?: string;
}
interface OpenAlexWork {
  doi?: string; title?: string; authorships?: { author?: { display_name?: string } }[]; publication_year?: number;
  primary_location?: { source?: { display_name?: string } }; biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
}
const first = <T,>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

function fromCrossref(m: CrossrefItem): Work {
  return {
    source: "crossref", doi: m.DOI, title: m.title?.[0], authors: (m.author ?? []).map((a) => a.family ?? a.name ?? "").slice(0, 6),
    year: m.issued?.["date-parts"]?.[0]?.[0], venue: m["container-title"]?.[0], volume: m.volume, issue: m.issue, pages: m.page,
  };
}
function fromCsl(m: CslItem): Work {
  return {
    source: "doi.org", doi: m.DOI, title: first(m.title), authors: (m.author ?? []).map((a) => a.family ?? a.literal ?? "").slice(0, 6),
    year: m.issued?.["date-parts"]?.[0]?.[0], venue: first(m["container-title"]), volume: m.volume, issue: m.issue, pages: m.page,
  };
}
function fromOpenAlex(w: OpenAlexWork): Work {
  return {
    source: "openalex", doi: w.doi?.replace(/^https:\/\/doi\.org\//, ""), title: w.title, authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").slice(0, 6),
    year: w.publication_year, venue: w.primary_location?.source?.display_name, volume: w.biblio?.volume, issue: w.biblio?.issue,
    pages: w.biblio?.first_page ? `${w.biblio.first_page}-${w.biblio.last_page ?? ""}` : undefined,
  };
}

/** 引文里的题名：GB/T 7714 写法“作者. 题名[J]. …” */
function citedTitle(raw: string): string | undefined {
  return raw.replace(/^\s*\[\d+\]\s*/, "").match(/^[^.]+\.\s*(.+?)\[[A-Z](?:\/OL)?\]/)?.[1]?.trim();
}

const outFile = join(dir, only ? `evidence-${only}.json` : "evidence.json");
type Entry = { id: string; raw: string; doi?: string; title?: string; evidence: Record<string, unknown> };
const entries: Entry[] = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, "utf8")) as { entries: Entry[] }).entries : [];
const save = () => writeFileSync(outFile, JSON.stringify({ collectedAt: new Date().toISOString(), entries }, null, 2) + "\n");
for (const list of generated.lists.filter((l) => !only || l.id === only)) {
  const refs = splitReferences(list.text);
  for (const [i, raw] of refs.entries()) {
    const id = `${list.id}-${String(i + 1).padStart(2, "0")}`;
    if (entries.some((e) => e.id === id)) continue;
    const doi = extractDoi(raw);
    const title = citedTitle(raw);
    const evidence: Record<string, unknown> = {};
    if (doi) {
      const ra = await getJson(`https://doi.org/ra/${encodeURIComponent(doi)}`);
      const reg = Array.isArray(ra.json) ? (ra.json[0] as { RA?: string; status?: string }) : undefined;
      evidence.doiRegistry = reg?.RA ?? reg?.status ?? `HTTP ${ra.status}`;
      if (reg?.RA === "Crossref") {
        const cr = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
        evidence.doiRecord = cr.json ? fromCrossref((cr.json as { message: CrossrefItem }).message) : `Crossref HTTP ${cr.status}`;
      } else if (reg?.RA === "DataCite") {
        const csl = await getJson(`https://doi.org/${encodeURIComponent(doi)}`, "application/vnd.citationstyles.csl+json");
        evidence.doiRecord = csl.json ? fromCsl(csl.json as CslItem) : `内容协商 HTTP ${csl.status}`;
      }
      // 知网（CNKI）等登记机构不提供可读的元数据，只记下登记在哪，题名、作者另行人工核对
    }
    if (title) {
      const cr = await getJson(`https://api.crossref.org/works?rows=3&query.bibliographic=${encodeURIComponent(title)}`);
      evidence.crossrefSearch = ((cr.json as { message?: { items?: CrossrefItem[] } } | undefined)?.message?.items ?? []).map(fromCrossref);
      const oa = await getJson(`https://api.openalex.org/works?per_page=3&search=${encodeURIComponent(title)}`);
      evidence.openalexSearch = ((oa.json as { results?: OpenAlexWork[] } | undefined)?.results ?? []).map(fromOpenAlex);
    }
    entries.push({ id, raw, doi, title, evidence });
    save();
    console.log(id, doi ?? "-", "|", title ?? "?", "|", evidence.doiRegistry ?? "");
  }
}
save();
console.log(`已写入 ${outFile}，共 ${entries.length} 条`);
