// 场景测试二：只贴 DOI，能不能补全成规范条目。从 Crossref 随机抽期刊论文的 DOI（/works?sample），逐条只贴 DOI 交给引用体检，
// 再把生成的 GB/T 7714 条目和 Crossref 原始记录逐项对照：题名、前三位作者、年份、刊名、卷、期、页码、DOI。
// 用法：NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/scenario-doi.mts [--n=30] [--from=上次的结果.json] [--out=eval/scenario-2026-10-23/doi-completion.json]
//   --from  用上次抽到的同一批 DOI 重跑（修改前后对照）

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseReference } from "../src/lib/verify/extract";
import { formatGbt } from "../src/lib/verify/format";
import { decodeEntities } from "../src/lib/verify/normalize";
import type { RefResult } from "../src/lib/verify/types";
import { verifyReference } from "../src/lib/verify/verify";

const args = process.argv.slice(2);
const n = Number(args.find((a) => a.startsWith("--n="))?.slice(4) ?? 30);
const out = args.find((a) => a.startsWith("--out="))?.slice(6) ?? "eval/scenario-2026-10-23/doi-completion.json";
const UA = "cite-checkup-scenario/0.1 (https://github.com/newhack-cpu/cite-checkup)";

const from = args.find((a) => a.startsWith("--from="))?.slice(7);

interface CrossrefWork {
  DOI: string; title?: string[]; author?: { family?: string; given?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] }; "container-title"?: string[]; volume?: string; issue?: string; page?: string;
}
async function crossref<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return ((await res.json()) as { message: T }).message;
      if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`Crossref HTTP ${res.status}`);
    } catch (error) {
      if (attempt >= 3) throw error;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}
const usable = (m: CrossrefWork) => !!(m.DOI && m.title?.[0] && m.author?.some((a) => a.family) && m.issued?.["date-parts"]?.[0]?.[0] && m["container-title"]?.[0]);
const items: CrossrefWork[] = [];
if (from) {
  // 逐条取，免得同时发太多请求被限流
  for (const r of (JSON.parse(readFileSync(from, "utf8")) as { rows: { doi: string }[] }).rows) items.push(await crossref<CrossrefWork>(`https://api.crossref.org/works/${encodeURIComponent(r.doi)}`));
} else {
  items.push(...(await crossref<{ items: CrossrefWork[] }>(`https://api.crossref.org/works?sample=${n * 2}&filter=type:journal-article`)).items.filter(usable).slice(0, n));
}

// Crossref 的题名、刊名常带 HTML 转义（&amp;）和标签，比对前先还原
const norm = (s?: string) => decodeEntities(s ?? "").normalize("NFKC").toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
const rows = [];
for (const [i, m] of items.entries()) {
  const t = Date.now();
  const result: RefResult = await verifyReference(parseReference(m.DOI, i + 1), { openalexBudget: { left: 0 } });
  const rec = result.match;
  const gbt = rec ? formatGbt(rec) : "";
  const expected = {
    title: m.title?.[0] ?? "", authors: (m.author ?? []).filter((a) => a.family).slice(0, 3).map((a) => a.family ?? ""), year: m.issued?.["date-parts"]?.[0]?.[0] ?? 0,
    venue: m["container-title"]?.[0] ?? "", volume: m.volume, issue: m.issue, pages: m.page, doi: m.DOI.toLowerCase(),
  };
  // 生成的条目里每一项都要和 Crossref 记录一致；记录本身没有的项（比如没有页码）不算缺
  const checks = {
    title: !!rec && norm(rec.title).startsWith(norm(expected.title).slice(0, 40)),
    authors: !!rec && expected.authors.every((f: string, k: number) => norm(rec.authors[k]?.family) === norm(f)),
    year: !!rec && (rec.year === expected.year || !!rec.years?.includes(expected.year)),
    venue: !!rec && norm(rec.venue) === norm(expected.venue),
    volume: !expected.volume || rec?.volume === expected.volume,
    issue: !expected.issue || rec?.issue === expected.issue,
    pages: !expected.pages || rec?.pages === expected.pages,
    doi: !!rec && rec.doi?.toLowerCase() === expected.doi,
    inCitation: !!rec && gbt.includes(String(expected.year)) && gbt.toLowerCase().includes(expected.doi),
  };
  rows.push({ doi: m.DOI, verdict: result.verdict, summary: result.summary, seconds: (Date.now() - t) / 1000, checks, expected, generated: gbt });
  console.log(`${String(i + 1).padStart(2)} ${result.verdict.padEnd(12)} ${Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k).join(",") || "全部一致"}  ${m.DOI}`);
}

const verified = rows.filter((r) => r.verdict === "verified" || r.verdict === "retracted" || r.verdict === "concern");
const allOk = rows.filter((r) => Object.values(r.checks).every(Boolean));
const summary = {
  sampled: rows.length,
  completed: verified.length,
  fieldsAllConsistent: allOk.length,
  verdicts: rows.reduce<Record<string, number>>((c, r) => ((c[r.verdict] = (c[r.verdict] ?? 0) + 1), c), {}),
  medianSeconds: rows.map((r) => r.seconds).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
};
console.log(JSON.stringify(summary));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), source: "Crossref /works?sample, type:journal-article", summary, rows }, null, 2) + "\n");
console.log(`已写入 ${out}`);
