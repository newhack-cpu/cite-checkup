// 用评测集跑一遍真实接口，输出混淆矩阵和准确率，结果写到 eval/results/。
// 用法：pnpm eval        （会调用 Crossref / doi.org / OpenAlex 的线上接口）

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseReference } from "../src/lib/verify/extract";
import { VERDICTS, type RefResult, type Verdict } from "../src/lib/verify/types";
import { verifyAll } from "../src/lib/verify/verify";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 也能跑，只是 Crossref 会走限流更严的公共池
}

interface Case {
  id: string;
  group: string;
  expected: Verdict[];
  raw: string;
  note?: string;
  synthetic?: boolean;
}

const LABEL: Record<Verdict, string> = {
  verified: "已核实",
  mismatch: "信息有误",
  near_match: "相近候选",
  not_found: "疑似不存在",
  retracted: "撤稿",
  concern: "关注声明",
  unverifiable: "无法核验",
  error: "出错",
};

const { cases } = JSON.parse(readFileSync(join("eval", "cases.json"), "utf8")) as { cases: Case[] };
const refs = cases.map((c, i) => parseReference(c.raw, i + 1));
const results: RefResult[] = [];
const started = Date.now();

await verifyAll(refs, (r) => {
  results.push(r);
  const c = cases[r.index - 1];
  const ok = c.expected.includes(r.verdict);
  console.log(`${ok ? "✔" : "✘"} ${c.id.padEnd(3)} 期望 ${c.expected.join("/").padEnd(22)} 实际 ${r.verdict.padEnd(12)} ${r.summary}`);
});

results.sort((a, b) => a.index - b.index);
const total = cases.length;
const correct = results.filter((r) => cases[r.index - 1].expected.includes(r.verdict)).length;

// 混淆矩阵：行 = 期望（取第一个可接受结论），列 = 实际
const matrix = new Map<string, Map<string, number>>();
for (const r of results) {
  const exp = cases[r.index - 1].expected[0];
  const row = matrix.get(exp) ?? new Map<string, number>();
  row.set(r.verdict, (row.get(r.verdict) ?? 0) + 1);
  matrix.set(exp, row);
}

console.log("\n混淆矩阵（行：期望，列：实际）");
console.log("".padEnd(14) + VERDICTS.map((v) => LABEL[v].padEnd(8)).join(""));
for (const exp of VERDICTS) {
  const row = matrix.get(exp);
  if (!row) continue;
  console.log(LABEL[exp].padEnd(12) + VERDICTS.map((v) => String(row.get(v) ?? 0).padEnd(10)).join(""));
}

// 关键指标：编造文献检出率、真实文献误报率
const fabricated = results.filter((r) => cases[r.index - 1].group === "编造");
const genuine = results.filter((r) => cases[r.index - 1].group.startsWith("真实"));
const caught = fabricated.filter((r) => r.verdict === "not_found").length;
const falseAlarm = genuine.filter((r) => r.verdict === "not_found").length;
const secs = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n总体准确率 ${correct}/${total} = ${((correct / total) * 100).toFixed(1)}%`);
console.log(`编造文献检出率 ${caught}/${fabricated.length}；真实文献被误判为"不存在" ${falseAlarm}/${genuine.length}`);
console.log(`耗时 ${secs}s（含限流等待）`);

mkdirSync(join("eval", "results"), { recursive: true });
const outArg = process.argv.find(a => a.startsWith("--out="));
const out = outArg ? outArg.slice("--out=".length) : join("eval", "results", "latest.json");
writeFileSync(
  out,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      accuracy: correct / total,
      correct,
      total,
      fabricatedCaught: `${caught}/${fabricated.length}`,
      genuineFalseAlarm: `${falseAlarm}/${genuine.length}`,
      seconds: Number(secs),
      results: results.map((r) => ({
        id: cases[r.index - 1].id,
        expected: cases[r.index - 1].expected,
        verdict: r.verdict,
        confidence: Number(r.confidence.toFixed(2)),
        summary: r.summary,
        issues: r.issues,
        notes: r.notes,
        match: r.match ? { doi: r.match.doi, title: r.match.title, year: r.match.year, source: r.match.source } : undefined,
        steps: r.steps,
      })),
    },
    null,
    1,
  ),
);
console.log(`明细已写入 ${out}`);
// Regression runs must fail visibly; printing a lower score with exit 0 hides regressions in CI.
if (correct !== total || results.length !== total) process.exitCode = 1;
