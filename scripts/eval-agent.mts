// AI 检索 Agent 评测：从一次 eval:real 的结果里取出"无法核验 / 只有相近候选"的条目，逐条交给 Agent，
// 统计有多少条被规则确认找到、调用了几次工具、花了多少 token。数据集里的文献都视为真实存在。
// 用法：pnpm eval:agent eval/real-world/dev-2026-10-14.json eval/results/real-dev-2026-10-15-rules.json
//         [--openalex=20] [--limit=N] [--out=eval/results/xxx.json]
//   --openalex  本次评测最多发起几次 OpenAlex 题名检索（无 key 时每天额度很少），默认 20
//   --limit     只跑前 N 条，用于试跑
//   --lang=zh   只跑中文（或 en）条目：OpenAlex 额度按条目顺序共用，混跑时排在后面的中文条目会分不到（10-15 两轮 52 条中文里 47 条如此）
// 需要 .env.local 里的 DEEPSEEK_API_KEY；网络需要代理时先设置 NODE_USE_ENV_PROXY=1。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runAgent } from "../src/lib/agent";
import type { RefResult, Verdict } from "../src/lib/verify/types";
import { agentEligibleRow } from "./real-results";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 时 Agent 会报未配置
}

interface Case { id: string; raw: string; label: { lang: "zh" | "en"; kind?: string; acceptMismatch?: boolean } }
interface Earlier { id: string; verdict: Verdict; summary: string; matchStatus?: string }

const args = process.argv.slice(2);
const [datasetFile, rulesFile] = args.filter((a) => !a.startsWith("--"));
if (!datasetFile || !rulesFile) throw new Error("用法：pnpm eval:agent <数据集.json> <eval:real 结果.json>");
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const pool = { left: Number(option("openalex") ?? 20) };
const limit = Number(option("limit") ?? Infinity);

const { name, cases } = JSON.parse(readFileSync(datasetFile, "utf8")) as { name: string; cases: Case[] };
const earlier = JSON.parse(readFileSync(rulesFile, "utf8")) as { results: Earlier[] };
// 与界面一致：无法核验、相近候选，以及 DOI 写错但另有相近候选的条目才交给 Agent（兼容 10-16 夜以前的结果文件）
const lang = option("lang");
if (lang !== undefined && lang !== "zh" && lang !== "en") throw new Error("--lang 只能是 zh 或 en");
const eligible = earlier.results.filter(agentEligibleRow)
  .filter((row) => !lang || cases.find((c) => c.id === row.id)?.label.lang === lang)
  .slice(0, limit);
const openalexStart = pool.left;

interface Row {
  id: string;
  lang: string;
  kind?: string;
  before: Verdict;
  after: Verdict | "failed";
  matchStatus?: string;
  summary?: string;
  outcome?: string;
  toolCalls: number;
  rounds: number;
  tokens: number;
  ms: number;
  steps: { reason?: string; detail: string; ok: boolean }[];
  note?: string;
  match?: { doi?: string; title: string; year?: number; source: string; site?: string; url?: string };
  /** 只找到相近候选时的那条记录（便于人工核对） */
  candidate?: { title: string; year?: number; venue?: string; source: string; site?: string; url?: string };
  issues: string[];
  error?: string;
}

const rows: Row[] = [];
const started = Date.now();
let next = 0;
async function worker() {
  while (next < eligible.length) {
    const item = eligible[next++];
    const c = cases.find((x) => x.id === item.id)!;
    const t = Date.now();
    try {
      const r: RefResult = await runAgent(c.raw, 1, { openalexPool: pool });
      rows.push({
        id: c.id, lang: c.label.lang, kind: c.label.kind, before: item.verdict, after: r.verdict, matchStatus: r.matchStatus, summary: r.summary,
        outcome: r.agent?.outcome, toolCalls: r.agent?.toolCalls ?? 0, rounds: r.agent?.rounds ?? 0, tokens: r.agent?.tokens ?? 0,
        ms: Date.now() - t, note: r.agent?.note, issues: r.issues,
        steps: r.steps.filter((s) => s.action === "agent_search").map((s) => ({ reason: s.reason, detail: s.detail, ok: s.ok })),
        match: r.matchStatus === "confirmed" && r.match
          ? { doi: r.match.doi, title: r.match.title, year: r.match.year, source: r.match.source, site: r.match.site, url: r.match.url } : undefined,
        candidate: r.matchStatus === "candidate" && r.match
          ? { title: r.match.title, year: r.match.year, venue: r.match.venue, source: r.match.source, site: r.match.site, url: r.match.url } : undefined,
      });
      process.stdout.write(`${c.id} ${item.verdict} → ${r.verdict}${r.agent?.outcome === "confirmed" ? "（确认）" : ""} ${r.agent?.toolCalls ?? 0} 次 ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
    } catch (error) {
      rows.push({ id: c.id, lang: c.label.lang, kind: c.label.kind, before: item.verdict, after: "failed", toolCalls: 0, rounds: 0, tokens: 0, ms: Date.now() - t, steps: [], issues: [], error: (error as Error).message });
      process.stdout.write(`${c.id} 失败：${(error as Error).message}\n`);
    }
  }
}
await Promise.all([worker(), worker()]);
rows.sort((a, b) => a.id.localeCompare(b.id));

const confirmed = rows.filter((r) => r.outcome === "confirmed");
const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
const summary = {
  eligible: eligible.length,
  confirmed: confirmed.length,
  confirmedVerdicts: Object.fromEntries([...new Set(confirmed.map((r) => r.after))].map((v) => [v, confirmed.filter((r) => r.after === v).length])),
  unchanged: rows.filter((r) => r.outcome === "unchanged").length,
  failed: rows.filter((r) => r.after === "failed").length,
  // 数据集里的文献都真实存在：Agent 不能制造"查无此文"，确认后的"信息有误"需要逐条看是否真的写错
  becameNotFound: rows.filter((r) => r.after === "not_found").length,
  // 只找到相近候选（如知网、万方没有作者的同题名文章）：给了可核对的链接，但没有确认
  becameNearMatch: rows.filter((r) => r.after === "near_match" && r.before !== "near_match").length,
  // 中文期刊联网检索（知网、万方、维普）给出的候选被规则确认 / 列为相近候选的条数
  webConfirmed: confirmed.filter((r) => r.match?.source === "web").length,
  // 在知网、万方、维普找到题名、（刊名、）年份都一致的文章，只差作者核对不了
  webConsistent: rows.filter((r) => r.after === "near_match" && r.candidate?.source === "web" && /一致的文章/.test(r.summary ?? "")).length,
  avgToolCalls: rows.length ? +(sum((r) => r.toolCalls) / rows.length).toFixed(2) : 0,
  avgTokens: rows.length ? Math.round(sum((r) => r.tokens) / rows.length) : 0,
  avgSeconds: rows.length ? +(sum((r) => r.ms) / rows.length / 1000).toFixed(1) : 0,
  totalTokens: sum((r) => r.tokens),
  openalexSearchesUsed: openalexStart - pool.left,
  byLanguage: Object.fromEntries(["en", "zh"].map((lang) => [lang, {
    eligible: rows.filter((r) => r.lang === lang).length,
    confirmed: confirmed.filter((r) => r.lang === lang).length,
    becameNearMatch: rows.filter((r) => r.lang === lang && r.after === "near_match" && r.before !== "near_match").length,
  }])),
};

console.log(`\n数据集 ${name}：可交给 Agent 的 ${summary.eligible} 条，规则确认找到 ${summary.confirmed} 条，结论不变 ${summary.unchanged} 条，失败 ${summary.failed} 条`);
console.log(`确认后的结论：${JSON.stringify(summary.confirmedVerdicts)}（其中来自知网、万方、维普 ${summary.webConfirmed} 条）；变成相近候选 ${summary.becameNearMatch} 条（其中题名、年份等一致、只缺作者 ${summary.webConsistent} 条）；变成"疑似不存在"：${summary.becameNotFound} 条`);
console.log(`平均每条 ${summary.avgToolCalls} 次工具调用、${summary.avgTokens} token、${summary.avgSeconds} 秒；OpenAlex 用了 ${summary.openalexSearchesUsed} 次；总用时 ${((Date.now() - started) / 1000).toFixed(0)} 秒`);

const out = option("out") || join("eval", "results", `agent-${basename(datasetFile, ".json")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), dataset: name, rulesFile, lang, summary, rows }, null, 1));
console.log(`明细已写入 ${out}`);
