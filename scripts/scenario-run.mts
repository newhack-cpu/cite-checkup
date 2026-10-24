// 场景测试一：大模型写出的参考文献，引用体检能不能分辨真假。三个题目各 12 条（generated.json），真值先由人判定（truth.json），
// 再按线上标准体检的参数逐个列表核查（一个列表一次请求：并发 3、OpenAlex 题名检索 20 次、配置了密钥就做中文期刊联网核查），和真值对照。
// 用法：NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/scenario-run.mts [eval/scenario-2026-10-23] [--no-cn] [--out=…]
//   --no-cn    不做中文期刊联网核查，用来对照；结果默认写到 <目录>/scenario-run.json（--no-cn 时 scenario-run-no-cn.json）
//   --rescore  不重新核查，只按 truth.json 和现在的计分规则给已保存的结果文件（--out 指定，默认同上）重新计分
// 知网等国内站点走代理常连不上，跑之前可把它们排除在代理之外（NO_PROXY），见 eval-real.mts 的说明。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseReferenceList } from "../src/lib/verify/extract";
import type { RefResult, Verdict } from "../src/lib/verify/types";
import { verifyAll } from "../src/lib/verify/verify";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 也能跑，只是不做中文期刊联网核查
}

type Label = "real_correct" | "real_with_error" | "fabricated";
interface Truth { id: string; label: Label; errors?: string[]; actual?: string }
interface Row {
  id: string; label: Label; verdict: Verdict; outcome: string; summary: string; issues: string[];
  /** 没对上的字段，写成“字段:状态” */
  fields: string[];
  suggestion?: string; matchStatus?: string; steps: string; raw: string;
}

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "eval/scenario-2026-10-23";
const noCn = args.includes("--no-cn");
const rescore = args.includes("--rescore");
const out = args.find((a) => a.startsWith("--out="))?.slice(6) ?? join(dir, noCn ? "scenario-run-no-cn.json" : "scenario-run.json");
const truth = new Map((JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as { items: Truth[] }).items.map((t) => [t.id, t]));

// 写错的字段在问题描述里怎么说（字段比对表只有题名、作者、年份、期刊、DOI 五项，卷期页和网页记录没有 DOI 时只写在问题里）
const ISSUE_WORDS: Record<string, RegExp> = {
  title: /题名/, authors: /作者/, year: /年份/, venue: /期刊|刊名/, volume: /卷/, issue: /期号|第 \d+ 期/, pages: /页/, doi: /DOI/,
};

/**
 * 每条的结果按真值分类：
 * 编造的——判“疑似不存在”或“信息有误”算查出，判“已核实”算放过，其余（相近候选、无法核验）算交给人工；
 * 真实且写对的——判“已核实”算对，判“疑似不存在”或“信息有误”算误报，其余算交给人工；
 * 真实但写错的——判“信息有误”且字段比对或问题描述指出了写错的字段算查出，判“已核实”算漏掉，判“疑似不存在”算误报，其余算交给人工。
 */
function outcome(t: Truth, r: Pick<Row, "verdict" | "fields" | "issues">): string {
  const v = r.verdict;
  if (t.label === "fabricated") {
    if (v === "not_found" || v === "mismatch") return "caught";
    if (v === "verified" || v === "retracted" || v === "concern") return "missed";
    return "manual";
  }
  if (t.label === "real_correct") {
    if (v === "verified") return "correct";
    if (v === "not_found" || v === "mismatch") return "false_alarm";
    return "manual";
  }
  if (v === "mismatch") {
    const flagged = r.fields.filter((f) => /:(?:mismatch|partial)$/.test(f)).map((f) => f.split(":")[0]);
    return (t.errors ?? []).some((e) => flagged.includes(e) || r.issues.some((i) => ISSUE_WORDS[e]?.test(i))) ? "caught" : "flagged_other";
  }
  if (v === "verified") return "missed";
  if (v === "not_found") return "false_alarm";
  return "manual";
}

let rows: Row[] = [];
let lists: { id: string; title: string; refs: number; seconds: number }[] = [];
let saved: { ranAt?: string; cn?: boolean } = {};
if (rescore) {
  saved = JSON.parse(readFileSync(out, "utf8")) as { ranAt: string; cn: boolean; lists: typeof lists; rows: Row[] };
  ({ rows, lists } = saved as { lists: typeof lists; rows: Row[] });
  rows = rows.map((r) => {
    const t = truth.get(r.id);
    if (!t) throw new Error(`truth.json 里没有 ${r.id}`);
    return { ...r, label: t.label, outcome: outcome(t, r) };
  });
} else {
  const generated = JSON.parse(readFileSync(join(dir, "generated.json"), "utf8")) as { lists: { id: string; title: string; text: string }[] };
  for (const list of generated.lists) {
    const refs = parseReferenceList(list.text);
    const results: RefResult[] = [];
    const started = Date.now();
    await verifyAll(refs, (r) => results.push(r), { concurrency: 3, openalexBudget: 20, ...(noCn ? { cn: false as const } : {}) });
    lists.push({ id: list.id, title: list.title, refs: refs.length, seconds: (Date.now() - started) / 1000 });
    for (const r of results.sort((a, b) => a.index - b.index)) {
      const id = `${list.id}-${String(r.index).padStart(2, "0")}`;
      const t = truth.get(id);
      if (!t) throw new Error(`truth.json 里没有 ${id}`);
      const row = {
        id, label: t.label, verdict: r.verdict, summary: r.summary, issues: r.issues,
        fields: r.fields.filter((f) => f.status !== "match").map((f) => `${f.field}:${f.status}`), suggestion: r.suggestion,
        matchStatus: r.matchStatus, steps: r.steps.map((s) => `${s.action}${s.ok ? "" : "×"}`).join(" "), raw: r.raw,
      };
      rows.push({ ...row, outcome: outcome(t, row) });
    }
  }
}
for (const r of rows) console.log(`${r.id.padEnd(8)} ${r.label.padEnd(16)} ${r.verdict.padEnd(12)} ${r.outcome.padEnd(13)} ${r.summary.slice(0, 70)}`);

const count = (label: Label) => {
  const of = rows.filter((r) => r.label === label);
  return { total: of.length, ...of.reduce<Record<string, number>>((c, r) => ((c[r.outcome] = (c[r.outcome] ?? 0) + 1), c), {}) };
};
const summary = {
  refs: rows.length,
  fabricated: count("fabricated"),
  realCorrect: count("real_correct"),
  realWithError: count("real_with_error"),
  verdicts: rows.reduce<Record<string, number>>((c, r) => ((c[r.verdict] = (c[r.verdict] ?? 0) + 1), c), {}),
  secondsPerList: lists.map((l) => l.seconds),
};
console.log(JSON.stringify(summary, null, 2));
const ranAt = rescore ? saved.ranAt : new Date().toISOString();
writeFileSync(out, JSON.stringify({ ranAt, cn: rescore ? saved.cn : !noCn, options: { concurrency: 3, openalexBudget: 20 }, lists, summary, rows }, null, 2) + "\n");
console.log(`已写入 ${out}`);
