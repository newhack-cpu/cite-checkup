// 真实世界评测：数据集里的每条参考文献都出自已发表论文，视为真实存在。
// 因此"疑似不存在"一律算误报；"信息有误"只在标注允许时算对（例如原文确有笔误）。
// "相近候选"按两种口径报告（见 real-results.ts）：旧口径算误报、与此前的结果可比；新口径不算误报、单列条数。
// 用法：pnpm eval:real eval/real-world/dev-2026-10-14.json [--ai] [--quiet] [--out=eval/results/xxx.json]
//   --ai     先走 DeepSeek 字段补全（需要 .env.local 里的 DEEPSEEK_API_KEY），再查数据库
//   --quiet  只打印汇总，不逐条列出被标为有问题的条目
//   --out    明细写到指定文件（默认 eval/results/real-<数据集>-<模式>.json，会覆盖上一次的结果）
// 网络需要代理时，可先设置环境变量 NODE_USE_ENV_PROXY=1，让 Node 使用 HTTPS_PROXY。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { prepareAIReferences } from "../src/lib/ai";
import { parseReference } from "../src/lib/verify/extract";
import { VERDICTS, type ParsedRef, type RefResult, type Verdict } from "../src/lib/verify/types";
import { verifyAll } from "../src/lib/verify/verify";
import { isFalseAlarm, type Caliber } from "./real-results";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 也能跑标准模式
}

interface Case {
  id: string;
  group: string;
  raw: string;
  assertedDoi?: string | null;
  label: { kind?: string; lang: "zh" | "en"; note?: string; acceptMismatch?: boolean };
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("请指定数据集文件，例如 eval/real-world/dev-2026-10-14.json");
const useAI = args.includes("--ai");
const quiet = args.includes("--quiet");
const { name, cases } = JSON.parse(readFileSync(file, "utf8")) as { name: string; cases: Case[] };

const AI_BATCH = 40;
let aiFallbackBatches = 0;
let refs: ParsedRef[] = cases.map((c, i) => parseReference(c.raw, i + 1));
if (useAI) {
  const prepared: ParsedRef[] = [];
  for (let start = 0; start < cases.length; start += AI_BATCH) {
    const chunk = cases.slice(start, start + AI_BATCH);
    try {
      const { refs: got } = await prepareAIReferences(chunk.map((c, i) => `[${i + 1}] ${c.raw}`).join("\n"));
      for (const r of got) prepared.push({ ...r, index: start + r.index });
    } catch (error) {
      aiFallbackBatches++;
      console.log(`AI 第 ${start / AI_BATCH + 1} 批失败（${(error as Error).message}），该批退回规则解析`);
      chunk.forEach((c, i) => prepared.push(parseReference(c.raw, start + i + 1)));
    }
  }
  refs = prepared;
}

const started = Date.now();
const results: RefResult[] = [];
// 预算按条数给足，避免评测结果受条目顺序影响；线上默认每次请求 20 次。
await verifyAll(refs, (r) => results.push(r), { concurrency: 3, openalexBudget: cases.length });
results.sort((a, b) => a.index - b.index);
const seconds = (Date.now() - started) / 1000;

const LABEL: Record<Verdict, string> = {
  verified: "已核实", mismatch: "有误", near_match: "相近", not_found: "不存在", retracted: "撤稿", concern: "关注", unverifiable: "无法核验", error: "出错",
};

const alarm = (r: RefResult, caliber: Caliber) =>
  isFalseAlarm({ verdict: r.verdict, acceptMismatch: cases[r.index - 1].label.acceptMismatch }, caliber);

function row(title: string, subset: RefResult[]) {
  const n = subset.length;
  const count = (v: Verdict) => subset.filter((r) => r.verdict === v).length;
  const old = subset.filter((r) => alarm(r, "old")).length;
  const now = subset.filter((r) => alarm(r, "new")).length;
  const pct = (k: number) => (n ? `${((k / n) * 100).toFixed(0)}%` : "-");
  console.log(
    `${title.padEnd(22)}${String(n).padStart(4)}  ` +
      VERDICTS.map((v) => String(count(v)).padStart(6)).join("") +
      `   误报 旧口径 ${String(old).padStart(3)} (${pct(old)}) / 新口径 ${String(now).padStart(3)} (${pct(now)})  核实率 ${pct(count("verified"))}`,
  );
}

console.log(`\n数据集 ${name}，${useAI ? "AI 辅助解析" : "标准规则"}模式，${cases.length} 条，用时 ${seconds.toFixed(1)}s`);
if (useAI) console.log(`AI 批次失败后退回规则：${aiFallbackBatches} 批`);
console.log("误报旧口径：信息有误、相近候选、疑似不存在都算（与此前的结果可比）；新口径：相近候选不算误报，见“相近”一列。");
console.log("".padEnd(26) + VERDICTS.map((v) => LABEL[v].padStart(6 - (LABEL[v].length - 2))).join(""));
row("合计", results);
row("英文", results.filter((r) => cases[r.index - 1].label.lang === "en"));
row("中文", results.filter((r) => cases[r.index - 1].label.lang === "zh"));
const kinds = [...new Set(cases.map((c) => c.label.kind).filter((k): k is string => !!k))];
if (kinds.length > 1) for (const k of kinds) row(`类型 ${k}`, results.filter((r) => cases[r.index - 1].label.kind === k));

// 按旧口径列出，相近候选也在里面，方便逐条复核
const flagged = results.filter((r) => alarm(r, "old") || r.verdict === "error");
if (!quiet && flagged.length) {
  console.log(`\n被误标或出错的条目（${flagged.length}，含相近候选）：`);
  for (const r of flagged) {
    const c = cases[r.index - 1];
    console.log(`${c.id} [${c.label.kind ?? "?"}/${c.label.lang}] ${LABEL[r.verdict]}：${r.summary}`);
    console.log(`     ${c.raw.slice(0, 150)}`);
    if (r.issues.length) console.log(`     问题：${r.issues.join("；").slice(0, 200)}`);
  }
}

const out = args.find((a) => a.startsWith("--out="))?.slice("--out=".length)
  || join("eval", "results", `real-${basename(file, ".json")}-${useAI ? "ai" : "rules"}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      dataset: name,
      mode: useAI ? "ai" : "rules",
      total: cases.length,
      seconds,
      aiFallbackBatches: useAI ? aiFallbackBatches : undefined,
      counts: Object.fromEntries(VERDICTS.map((v) => [v, results.filter((r) => r.verdict === v).length])),
      // falseAlarms 保持此前结果文件的口径（相近候选也算），falseAlarmsNew 是新口径
      falseAlarms: results.filter((r) => alarm(r, "old")).length,
      falseAlarmsNew: results.filter((r) => alarm(r, "new")).length,
      calibers: {
        falseAlarms: "旧口径：信息有误（标注允许的除外）、相近候选、疑似不存在都算误报，与 2026-10-16 及以前的结果文件同一口径",
        falseAlarmsNew: "新口径：相近候选不算误报（只找到相近记录、没有确认是同一篇），条数见 counts.near_match",
      },
      results: results.map((r) => ({
        id: cases[r.index - 1].id,
        verdict: r.verdict,
        matchStatus: r.matchStatus,
        summary: r.summary,
        issues: r.issues,
        kind: r.parsed.kind,
        match: r.match ? { doi: r.match.doi, title: r.match.title, year: r.match.year, source: r.match.source } : undefined,
      })),
    },
    null,
    1,
  ),
);
console.log(`\n明细已写入 ${out}`);
