// 探针：把论断范围扩大（“书籍章节七成”→“全部引用七成”），看会不会被判成支持。同一篇论文（Walters & Wilder 2023，Europe PMC 全文），每条 2 次。
// 用法（项目根目录）：NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/results/scope-broaden-probe-2026-11-17/run.mts <out.json>
import { writeFileSync } from "node:fs";
import { checkClaim } from "../../../src/lib/claims";
process.loadEnvFile(".env.local");
const doi = "10.1038/s41598-023-41032-5";
const claims = [
  { id: "faithful", expect: "supported", claim: "在这项研究样本中，即使用 GPT-4，它引用的书籍章节也有七成是编造的。" },
  { id: "broadened-all", expect: "not supported", claim: "在这项研究中，GPT-4 生成的全部引用里有七成是编造的。" },
  { id: "broadened-model", expect: "not supported", claim: "在这项研究中，GPT-3.5 和 GPT-4 引用的书籍章节都有七成是编造的。" },
];
const rows = [];
for (const c of claims) for (let i = 0; i < 2; i++) {
  const r = await checkClaim({ claim: c.claim, doi });
  rows.push({ id: c.id, expect: c.expect, run: i + 1, status: r.status, verdict: r.verdict, scope: r.source?.label, quote: r.citations[0]?.quote?.slice(0, 120), warnings: r.warnings.filter((w) => w.includes("范围")) });
  console.log(c.id, i + 1, r.status, r.verdict, "|", r.citations[0]?.quote?.slice(0, 90));
}
writeFileSync(process.argv[2] ?? "eval/results/scope-broaden-probe-2026-11-17/result.json", JSON.stringify(rows, null, 1));
