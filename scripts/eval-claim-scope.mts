// 论断“范围错配”评测：数据集 eval/claims-scope/cases.json（三篇论文的真实摘要 20 条 + 合成材料 27 条）。
// 起因：10-19 走查中 Europe PMC 全文超时、退回摘要，“GPT-4 引用的书籍章节七成是编造的”被摘要里“GPT-4 总体 18%”判成“与证据矛盾”。
// 每条论断判 N 次；同一次判定结果上同时算三种做法，便于比较：
//   judge   只做判定（10-19 之前的线上做法）
//   contra  初判为“矛盾”时做范围复核，引句没覆盖论断的限定范围就改判“证据不足”（10-19 上线的做法）
//   both    初判为“矛盾”或“支持”时都做范围复核（候选）
// 用法：NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/eval-claim-scope.mts [--runs=3] [--tag=v1] [--concurrency=4] [--only=W1,S5c]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkContradictionScope } from "../src/lib/claims/assist";
import { judgeRetrievedEvidence } from "../src/lib/claims/model";
import { chunkEvidence, retrieveEvidence } from "../src/lib/claims/retrieval";
import { fetchDoiEvidence } from "../src/lib/claims/sources";
import type { ClaimSource, ClaimVerdict, EvidenceChunk } from "../src/lib/claims/types";

try {
  process.loadEnvFile(".env.local");
} catch { /* 已在环境变量里配置 */ }

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const runs = Number(arg("runs") ?? 3);
const tag = arg("tag") ?? "run";
const concurrency = Number(arg("concurrency") ?? 4);
const only = arg("only")?.split(",");

interface Doc { id: string; kind: "doi" | "synthetic"; doi?: string; text?: string }
interface Case { id: string; doc: string; category: string; claim: string; expected: ClaimVerdict[] }
const data = JSON.parse(readFileSync("eval/claims-scope/cases.json", "utf8")) as { documents: Doc[]; cases: Case[]; categories: Record<string, string> };
const cases = data.cases.filter((c) => !only || only.includes(c.id));

// 证据：DOI 只取摘要（模拟全文取不到）；合成材料按用户提供的正文处理，与 checkClaim 相同
const evidence = new Map<string, { source: ClaimSource; text: string; chunks: EvidenceChunk[] }>();
for (const doc of data.documents.filter((d) => cases.some((c) => c.doc === d.id))) {
  let source: ClaimSource;
  let text: string;
  if (doc.kind === "doi") {
    const fetched = await fetchDoiEvidence(doc.doi!, undefined, { fullText: false });
    source = fetched.source;
    text = fetched.text;
  } else {
    text = doc.text!;
    source = { id: "source-1", kind: "user_provided", label: "合成测试材料", retrievedAt: new Date().toISOString(), scope: "user_provided_text", totalChars: text.length };
  }
  evidence.set(doc.id, { source, text, chunks: chunkEvidence(text, source.id) });
  console.log(`证据 ${doc.id}：${source.label}，${text.length} 字符`);
}

type Variant = "judge" | "contra" | "both";
const VARIANTS: Variant[] = ["judge", "contra", "both"];
interface Run { verdict?: ClaimVerdict; quotes?: string[]; scope?: { sameScope: boolean; missing: string[] } | null; final?: Record<Variant, ClaimVerdict>; judgeMs?: number; scopeMs?: number; explanation?: string; error?: string }
const results = new Map<string, Run[]>(cases.map((c) => [c.id, []]));

async function runOne(c: Case) {
  const { source, chunks } = evidence.get(c.doc)!;
  const retrieved = retrieveEvidence(c.claim, chunks);
  const used = retrieved.length ? retrieved : chunks;
  const run: Run = {};
  try {
    const started = Date.now();
    const judged = await judgeRetrievedEvidence(c.claim, source, used);
    run.judgeMs = Date.now() - started;
    run.verdict = judged.verdict;
    run.quotes = judged.citations.map((citation) => citation.quote);
    run.explanation = judged.explanation;
    if (judged.verdict === "contradicted" || judged.verdict === "supported") {
      const scopeStarted = Date.now();
      const cited = used.filter((chunk) => judged.citations.some((citation) => citation.chunkId === chunk.id)).map((chunk) => chunk.text);
      run.scope = await checkContradictionScope(c.claim, run.quotes, cited, AbortSignal.timeout(30_000));
      run.scopeMs = Date.now() - scopeStarted;
    }
    const narrowed = run.scope ? !run.scope.sameScope : false;
    run.final = {
      judge: judged.verdict,
      contra: judged.verdict === "contradicted" && narrowed ? "insufficient_evidence" : judged.verdict,
      both: (judged.verdict === "contradicted" || judged.verdict === "supported") && narrowed ? "insufficient_evidence" : judged.verdict,
    };
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
  }
  results.get(c.id)!.push(run);
  const scopeNote = run.scope === undefined ? "" : run.scope === null ? " 复核未完成" : run.scope.sameScope ? " 同范围" : ` 缺:${run.scope.missing.join("/")}`;
  console.log(`${c.id} ${run.error ? `错误 ${run.error}` : `${run.verdict}${scopeNote} → contra=${run.final!.contra} both=${run.final!.both}`}（期望 ${c.expected.join("/")}）`);
}

const tasks = cases.flatMap((c) => Array.from({ length: runs }, () => c));
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
  while (next < tasks.length) await runOne(tasks[next++]);
}));

// 统计：错判矛盾 = 不该矛盾却判矛盾；丢失矛盾 = 该矛盾却没判；支持同理
const summary: Record<string, unknown> = {};
const byCategory: Record<string, Record<Variant, string>> = {};
for (const variant of VARIANTS) {
  let n = 0, ok = 0, falseContra = 0, lostContra = 0, falseSupport = 0, lostSupport = 0, errors = 0;
  for (const c of cases) {
    let catN = 0, catOk = 0;
    for (const run of results.get(c.id)!) {
      if (!run.final) { errors++; continue; }
      const verdict = run.final[variant];
      n++; catN++;
      if (c.expected.includes(verdict)) { ok++; catOk++; }
      if (verdict === "contradicted" && !c.expected.includes("contradicted")) falseContra++;
      if (c.expected.includes("contradicted") && verdict !== "contradicted") lostContra++;
      if (verdict === "supported" && !c.expected.includes("supported")) falseSupport++;
      if (c.expected.includes("supported") && verdict !== "supported") lostSupport++;
    }
    const cat = (byCategory[c.category] ??= {} as Record<Variant, string>);
    const [prevOk, prevN] = (cat[variant] ?? "0/0").split("/").map(Number);
    cat[variant] = `${prevOk + catOk}/${prevN + catN}`;
  }
  summary[variant] = { correct: `${ok}/${n}`, falseContradicted: falseContra, lostContradicted: lostContra, falseSupported: falseSupport, lostSupported: lostSupport, errors };
}
const allRuns = [...results.values()].flat();
const reviewed = allRuns.filter((run) => run.scope !== undefined);
const latency = {
  judgeMedianMs: median(allRuns.flatMap((run) => (run.judgeMs ? [run.judgeMs] : []))),
  scopeMedianMs: median(reviewed.flatMap((run) => (run.scopeMs ? [run.scopeMs] : []))),
  scopeIncomplete: reviewed.filter((run) => run.scope === null).length,
  scopeCalls: reviewed.length,
};
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

console.log("\n做法\t正确\t错判矛盾\t丢失矛盾\t错判支持\t丢失支持\t出错");
for (const variant of VARIANTS) {
  const s = summary[variant] as Record<string, number | string>;
  console.log(`${variant}\t${s.correct}\t${s.falseContradicted}\t${s.lostContradicted}\t${s.falseSupported}\t${s.lostSupported}\t${s.errors}`);
}
console.log("\n分类\tjudge\tcontra\tboth");
for (const [category, row] of Object.entries(byCategory)) console.log(`${category}\t${row.judge}\t${row.contra}\t${row.both}`);
console.log(`\n判定中位耗时 ${latency.judgeMedianMs} ms；范围复核 ${latency.scopeCalls} 次，中位 ${latency.scopeMedianMs} ms，未完成 ${latency.scopeIncomplete} 次`);

mkdirSync("eval/results/claim-scope-2026-10-19", { recursive: true });
const out = `eval/results/claim-scope-2026-10-19/${tag}.json`;
writeFileSync(out, JSON.stringify({
  ranAt: new Date().toISOString(), model: process.env.DEEPSEEK_MODEL || "deepseek-flash", dataset: "eval/claims-scope/cases.json", runs, summary, byCategory, latency,
  evidence: Object.fromEntries([...evidence].map(([id, e]) => [id, { label: e.source.label, scope: e.source.scope, text: e.text }])),
  cases: cases.map((c) => ({ ...c, runs: results.get(c.id) })),
  limitation: "47 条论断由评测者编写，真实部分只用三篇论文的摘要；用于检查“范围错配”这一类错判和复核的副作用，不代表论断核查的总体准确率。",
}, null, 2));
console.log(`结果：${out}`);
