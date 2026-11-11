// 论断检索评测：同一批论断、同一份全文，对比几种检索方式召回的前 6 段是否包含标注的出处句子。
//   bm25        原论断的词面检索（中英文词 + 汉字 bigram）
//   vector      只用本机向量模型的语义相似度（multilingual-e5-small，不调用大模型）
//   bm25+vector 词面 + 向量两路按排名融合（不调用大模型）
//   expanded    原论断 + 模型扩展检索词，两路 BM25 按排名融合
//   hybrid-v1   expanded 的前 20 段再由模型重排（加向量召回之前的产品默认）
//   hybrid      词面 + 扩展词 + 向量三路融合，再由模型重排（产品默认）
// 向量模型要先运行 node scripts/fetch-embedding-model.mjs 下载到 models/。
// 用法：pnpm eval:retrieval [--out=eval/results/retrieval-xxx.json]
// 需要 .env.local 里的 DEEPSEEK_API_KEY；全文通过 Europe PMC 实时获取，不写入仓库。网络需要代理时先设置 NODE_USE_ENV_PROXY=1。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandQuery, hybridRetrieve } from "../src/lib/claims/assist";
import { EMBEDDING_MODEL, embeddingAvailable, rankByEmbedding } from "../src/lib/claims/embedding";
import { europePmcFullText } from "../src/lib/claims/fulltext";
import { chunkEvidence, MAX_RETRIEVED_CHUNKS, normalizeEvidence, rankEvidence, retrieveEvidence, termWeights } from "../src/lib/claims/retrieval";
import type { EvidenceChunk } from "../src/lib/claims/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有密钥时扩展和重排会失败，评测会如实记录
}

interface Case { id: string; doc: string; lang: "en" | "zh"; claim: string; gold: string[] }
interface Doc { id: string; doi: string; citation: string }
const dataset = JSON.parse(readFileSync("eval/claims-retrieval/cases.json", "utf8")) as { name: string; documents: Doc[]; cases: Case[] };
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? join("eval", "results", `retrieval-${new Date().toISOString().slice(0, 10)}.json`);

/** 出处句子在全文中的所有位置 */
function spans(text: string, gold: string[]): [number, number][] {
  const found: [number, number][] = [];
  for (const g of gold) for (let at = text.indexOf(g); at >= 0; at = text.indexOf(g, at + 1)) found.push([at, at + g.length]);
  return found;
}
/** 片段是否包含某个出处句子的至少 80% */
const hits = (chunk: EvidenceChunk, golds: [number, number][]) =>
  golds.some(([g0, g1]) => Math.max(0, Math.min(g1, chunk.end) - Math.max(g0, chunk.start)) >= 0.8 * (g1 - g0));
const firstHit = (chunks: EvidenceChunk[], golds: [number, number][]) => chunks.findIndex((c) => hits(c, golds)) + 1;

const docs = new Map<string, { text: string; chunks: EvidenceChunk[]; abstractEnd: number }>();
for (const doc of dataset.documents) {
  const full = await europePmcFullText(doc.doi);
  if (!full) throw new Error(`${doc.doi} 没有取到开放全文`);
  const text = normalizeEvidence(full.text);
  // 摘要到第一个非 Abstract 的节标题为止，用来统计“只看摘要能否找到证据”
  const abstractEnd = text.search(/^## (?!Abstract)/m);
  docs.set(doc.id, { text, chunks: chunkEvidence(text, "source-1"), abstractEnd });
  console.log(`${doc.id}：${text.length.toLocaleString()} 字符，${docs.get(doc.id)!.chunks.length} 段`);
}

if (!embeddingAvailable()) throw new Error("没有找到向量模型，请先运行 node scripts/fetch-embedding-model.mjs");
const methods = ["bm25", "vector", "bm25+vector", "expanded", "hybrid-v1", "hybrid"] as const;
// 每篇全文第一次向量化的耗时（之后同一篇命中进程内缓存）
const embedSeconds: Record<string, number> = {};
const rows = [];
for (const c of dataset.cases) {
  const doc = docs.get(c.doc)!;
  const golds = spans(doc.text, c.gold);
  if (!golds.length) throw new Error(`${c.id} 的出处句子不在全文里，请检查标注`);
  const signal = new AbortController().signal;
  const started = Date.now();
  const bm25 = retrieveEvidence(c.claim, doc.chunks);
  let expansion: string[] | undefined;
  let expandError: string | undefined;
  try { expansion = await expandQuery(c.claim, signal); } catch (error) { expandError = (error as Error).message || "failed"; }
  const expanded = expansion ? fuseTop([rankEvidence(termWeights(c.claim), doc.chunks, 12), rankEvidence(termWeights(expansion.join("\n")), doc.chunks, 12)]) : bm25;
  const vectorStarted = Date.now();
  const vectorAll = (await rankByEmbedding(c.claim, doc.chunks, 12, signal)) ?? [];
  const vectorSeconds = (Date.now() - vectorStarted) / 1000;
  embedSeconds[c.doc] ??= vectorSeconds;
  const bm25Vector = fuseTop([rankEvidence(termWeights(c.claim), doc.chunks, 12), vectorAll]);
  const v1 = await hybridRetrieve(c.claim, doc.chunks, signal, { ...(expansion ? { expansion } : { expand: false }), vector: false });
  const hybrid = await hybridRetrieve(c.claim, doc.chunks, signal, expansion ? { expansion } : { expand: false });
  const row = {
    id: c.id, lang: c.lang, inAbstract: golds.some(([g0]) => doc.abstractEnd > 0 && g0 < doc.abstractEnd),
    rank: {
      bm25: firstHit(bm25, golds), vector: firstHit(vectorAll.slice(0, MAX_RETRIEVED_CHUNKS), golds), "bm25+vector": firstHit(bm25Vector, golds),
      expanded: firstHit(expanded, golds), "hybrid-v1": firstHit(v1.chunks, golds), hybrid: firstHit(hybrid.chunks, golds),
    },
    hybridMethod: hybrid.method, expansion: hybrid.expansion, expandError, warnings: [...new Set([...v1.warnings, ...hybrid.warnings])], vectorSeconds, seconds: (Date.now() - started) / 1000,
  };
  rows.push(row);
  console.log(`${c.id} [${c.lang}] ${methods.map((m) => `${m}=${row.rank[m] || "-"}`).join(" ")}${row.warnings.length ? `（${row.warnings.join("；")}）` : ""}`);
}

/** 与 hybridRetrieve 相同的排名融合，但不重排，用来单独看每一路召回的作用 */
function fuseTop(lists: EvidenceChunk[][]): EvidenceChunk[] {
  const fused = new Map<string, { chunk: EvidenceChunk; score: number }>();
  for (const list of lists) list.forEach((chunk, rank) => {
    const entry = fused.get(chunk.id) ?? { chunk, score: 0 };
    entry.score += 1 / (20 + rank + 1);
    fused.set(chunk.id, entry);
  });
  return [...fused.values()].sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start).slice(0, MAX_RETRIEVED_CHUNKS).map(({ chunk }) => chunk);
}

const summary: Record<string, Record<string, { recall: number; mrr: number; n: number }>> = {};
for (const group of ["all", "en", "zh"]) {
  const subset = rows.filter((r) => group === "all" || r.lang === group);
  summary[group] = Object.fromEntries(methods.map((m) => [m, {
    n: subset.length,
    recall: +(subset.filter((r) => r.rank[m] > 0).length / subset.length).toFixed(3),
    mrr: +(subset.reduce((s, r) => s + (r.rank[m] ? 1 / r.rank[m] : 0), 0) / subset.length).toFixed(3),
  }]));
}
const inAbstract = rows.filter((r) => r.inAbstract).length;
mkdirSync(join("eval", "results"), { recursive: true });
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), dataset: dataset.name, model: process.env.DEEPSEEK_MODEL || "deepseek-flash", embedding: EMBEDDING_MODEL, embedSeconds, chunksPerDoc: Object.fromEntries([...docs].map(([id, d]) => [id, d.chunks.length])), topK: MAX_RETRIEVED_CHUNKS, inAbstract, summary, rows }, null, 1));
console.log("\n前 6 段命中率 / MRR：");
for (const [group, values] of Object.entries(summary)) {
  console.log(`  ${group}（${values.bm25.n} 条）：${methods.map((m) => `${m} ${(values[m].recall * 100).toFixed(0)}% / ${values[m].mrr.toFixed(2)}`).join("，")}`);
}
console.log(`每篇全文第一次向量化用时（秒）：${Object.entries(embedSeconds).map(([id, s]) => `${id} ${s.toFixed(1)}`).join("，")}`);
console.log(`出处句子在摘要里的有 ${inAbstract}/${rows.length} 条；明细写入 ${out}`);
