// 论断判定的“范围错配”检查：只有摘要时，总体比例不能用来否定限定了范围的论断。
// 2026-10-19 走查中 Europe PMC 全文超时、退回摘要，“GPT-4 引用的书籍章节七成是编造的”被判成“与证据矛盾”
// （摘要只有 GPT-4 总体 18%）。这里固定用同一份摘要证据，每条论断判 N 次：
//   --mode=judge-only     只做判定（修复前线上的做法）
//   --mode=scope-review   判定后，初判为矛盾时做范围复核（与 checkClaim 相同）
// 另跑一次 DOI 全文路径（--fulltext），确认能取到全文时这句论断仍判“证据支持”；
// --probe 单独测范围复核：其他领域的合成引句（医学、经济、教育），看是不是只对这一篇论文有效。
// 用法：NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/eval-claim-scope.mts --mode=scope-review --runs=3 --tag=after --fulltext --probe
import { mkdirSync, writeFileSync } from "node:fs";
import { checkContradictionScope } from "../src/lib/claims/assist";
import { checkClaim } from "../src/lib/claims/index";
import { judgeRetrievedEvidence } from "../src/lib/claims/model";
import { chunkEvidence, retrieveEvidence } from "../src/lib/claims/retrieval";
import { fetchDoiEvidence } from "../src/lib/claims/sources";
import type { ClaimVerdict } from "../src/lib/claims/types";

try {
  process.loadEnvFile(".env.local");
} catch { /* 已在环境变量里配置 */ }

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const runs = Number(arg("runs") ?? 3);
const tag = arg("tag") ?? "run";
const mode = arg("mode") === "judge-only" ? "judge-only" : "scope-review";
const DOI = "10.1038/s41598-023-41032-5"; // Walters & Wilder 2023, Scientific Reports
const BOOK_CHAPTERS = "即使用 GPT-4，它引用的书籍章节里也有七成是编造的。";

// 摘要原文：55% of the GPT-3.5 citations but just 18% of the GPT-4 citations are fabricated（没有按文献类型细分）
const cases: { id: string; claim: string; expected: ClaimVerdict }[] = [
  { id: "subgroup-book-chapters", claim: BOOK_CHAPTERS, expected: "insufficient_evidence" },
  { id: "subgroup-journal-articles", claim: "在该研究样本中，GPT-4 引用的期刊论文有一半是编造的。", expected: "insufficient_evidence" },
  { id: "overall-contradicted", claim: "在该研究样本中，GPT-4 生成的引文有一半以上是编造的。", expected: "contradicted" },
  { id: "overall-supported", claim: "在该研究样本中，GPT-3.5 生成引文的 55% 为虚构，GPT-4 为 18%。", expected: "supported" },
];

const evidence = await fetchDoiEvidence(DOI, undefined, { fullText: false });
const chunks = chunkEvidence(evidence.text, evidence.source.id);
console.log(`模式：${mode}；证据：${evidence.source.label}，${evidence.text.length} 字符，${chunks.length} 段`);

const rows = [];
for (const c of cases) {
  const retrieved = retrieveEvidence(c.claim, chunks);
  const used = retrieved.length ? retrieved : chunks;
  const verdicts: string[] = [];
  const notes: string[] = [];
  for (let i = 0; i < runs; i++) {
    try {
      const judged = await judgeRetrievedEvidence(c.claim, evidence.source, used);
      let verdict: string = judged.verdict;
      let note = judged.explanation;
      if (mode === "scope-review" && verdict === "contradicted") {
        const scope = await checkContradictionScope(c.claim, judged.citations.map((citation) => citation.quote), AbortSignal.timeout(30_000));
        if (!scope) note = `范围复核未完成；${note}`;
        else if (!scope.sameScope) { verdict = "insufficient_evidence"; note = `范围复核：引句没有单独报告 ${scope.missing.join("、")}；初判 contradicted`; }
        else note = `范围复核：同一范围；${note}`;
      }
      verdicts.push(verdict);
      notes.push(note);
    } catch (error) {
      verdicts.push("error");
      notes.push(error instanceof Error ? error.message : String(error));
    }
  }
  const ok = verdicts.filter((v) => v === c.expected).length;
  rows.push({ ...c, verdicts, ok, notes });
  console.log(`${ok === runs ? "PASS" : "FAIL"} ${c.id}: ${verdicts.join(", ")}（期望 ${c.expected}）`);
}

let fulltext: Record<string, unknown> | undefined;
if (process.argv.includes("--fulltext")) {
  const started = Date.now();
  const result = await checkClaim({ doi: DOI, claim: BOOK_CHAPTERS });
  fulltext = { claim: BOOK_CHAPTERS, scope: result.coverage.scope, status: result.status, verdict: result.verdict, seconds: Math.round((Date.now() - started) / 100) / 10,
    quotes: result.citations.map((citation) => citation.quote), warnings: result.warnings };
  console.log(`DOI 路径：范围 ${result.coverage.scope}，${result.status} / ${result.verdict}，${fulltext.seconds} 秒`);
}

// 范围复核单独测：sameScope 期望值；false 表示引句没有报告论断限定的范围
let probe: Record<string, unknown>[] | undefined;
if (process.argv.includes("--probe")) {
  const probes: [string, string, string, boolean][] = [
    ["med-subgroup", "80 岁以上的患者中有四成出现副作用。", "Overall, 12% of patients reported side effects.", false],
    ["med-overall", "该试验中只有 2% 的患者出现副作用。", "Overall, 12% of patients reported side effects.", true],
    ["med-reverse", "该试验中总体有四成患者出现副作用。", "Among patients over 80, 40% reported side effects.", false],
    ["econ-time", "2021 年该地区失业率为 3%。", "In 2020, the regional unemployment rate was 8%.", false],
    ["edu-significance", "干预组的测验成绩显著高于对照组。", "The intervention group scored 5 points higher than the control group, but the difference was not significant (p = 0.30).", true],
  ];
  probe = [];
  for (const [id, claim, quote, expected] of probes) {
    const got: string[] = [];
    for (let i = 0; i < runs; i++) {
      const scope = await checkContradictionScope(claim, [quote], AbortSignal.timeout(30_000));
      got.push(!scope ? "incomplete" : scope.sameScope ? "same" : `differs: ${scope.missing.join("、")}`);
    }
    const ok = got.filter((g) => (expected ? g === "same" : g.startsWith("differs"))).length;
    probe.push({ id, claim, quote, expectedSameScope: expected, got, ok });
    console.log(`${ok === runs ? "PASS" : "FAIL"} probe ${id}: ${got.join("; ")}`);
  }
}

mkdirSync("eval/results/claim-scope-2026-10-19", { recursive: true });
const out = `eval/results/claim-scope-2026-10-19/${tag}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), mode, model: process.env.DEEPSEEK_MODEL || "deepseek-flash", doi: DOI, evidenceScope: evidence.source.scope, runs, rows, fulltext, probe,
  limitation: "同一篇论文摘要上的 4 条论断，用于检查“范围错配”这一类错判，不代表论断核查的总体准确率。" }, null, 2));
console.log(`结果：${out}`);
