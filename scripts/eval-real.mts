// 真实世界评测：数据集里的每条参考文献都出自已发表论文，视为真实存在。
// 因此"疑似不存在"一律算误报；"信息有误"只在标注允许时算对（例如原文确有笔误）。
// "相近候选"按两种口径报告（见 real-results.ts）：旧口径算误报、与此前的结果可比；新口径不算误报、单列条数。
// 用法：pnpm eval:real eval/real-world/dev-2026-10-14.json [--ai] [--quiet] [--out=eval/results/xxx.json]
//   --ai     先走 DeepSeek 字段补全（需要 .env.local 里的 DEEPSEEK_API_KEY），再查数据库；只发送规则没解析出题名的期刊 / 会议等条目
//   --openalex=N  OpenAlex 题名检索最多 N 次（默认按条数给足；额度紧时用来封顶，结果文件会记下）
//   --quiet  只打印汇总，不逐条列出被标为有问题的条目
//   --out    明细写到指定文件（默认 eval/results/real-<数据集>-<模式>.json，会覆盖上一次的结果）
//   --no-cn  不做中文期刊联网核查（DeepSeek 搜索接口 + 原文页面），用来和此前的结果对照；默认配置了密钥就做，每条都给额度
//   --lang=zh  只跑中文（或 en）条目，用于回归中文期刊联网核查（中文条目不用 OpenAlex 题名检索，不耗额度）
// 网络需要代理时，可先设置环境变量 NODE_USE_ENV_PROXY=1，让 Node 使用 HTTPS_PROXY。
// 知网走代理很慢、常连不上，评测时把它排除在代理之外：NO_PROXY=localhost,127.0.0.1,::1,.local,.cnki.net,.cnki.com.cn

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { prepareAIReferences } from "../src/lib/ai";
import { chineseJournalView, cnSearchConfigured } from "../src/lib/verify/cnjournal";
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
const langArg = args.find((a) => a.startsWith("--lang="))?.slice("--lang=".length);
if (langArg !== undefined && langArg !== "zh" && langArg !== "en") throw new Error("--lang 只能是 zh 或 en");
const dataset = JSON.parse(readFileSync(file, "utf8")) as { name: string; cases: Case[] };
const name = dataset.name;
const cases = langArg ? dataset.cases.filter((c) => c.label.lang === langArg) : dataset.cases;

const AI_BATCH = 40;
let aiFallbackBatches = 0;
const aiStats = { sent: 0, supplemented: 0, rejected: 0 };
let refs: ParsedRef[] = cases.map((c, i) => parseReference(c.raw, i + 1));
if (useAI) {
  const prepared: ParsedRef[] = [];
  for (let start = 0; start < cases.length; start += AI_BATCH) {
    const chunk = cases.slice(start, start + AI_BATCH);
    try {
      const { refs: got, sent, supplemented, rejected } = await prepareAIReferences(chunk.map((c, i) => `[${i + 1}] ${c.raw}`).join("\n"));
      for (const r of got) prepared.push({ ...r, index: start + r.index });
      aiStats.sent += sent;
      aiStats.supplemented += supplemented;
      aiStats.rejected += rejected;
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
const openalexArg = args.find((a) => a.startsWith("--openalex="));
const openalexBudget = openalexArg ? Number(openalexArg.slice("--openalex=".length)) : cases.length;
if (!Number.isInteger(openalexBudget) || openalexBudget < 0) throw new Error("--openalex= 需要非负整数");
// 中文期刊联网核查：评测时每条都给额度（线上每次请求默认 30 条），不设整体时限
const cnEnabled = !args.includes("--no-cn") && cnSearchConfigured();
await verifyAll(refs, (r) => results.push(r), { concurrency: 3, openalexBudget, cn: cnEnabled ? { left: cases.length } : false });
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
if (useAI) console.log(`AI 发送 ${aiStats.sent} 条，补上字段 ${aiStats.supplemented} 条，逐条校验退回 ${aiStats.rejected} 条；整批失败退回规则 ${aiFallbackBatches} 批`);
console.log("误报旧口径：信息有误、相近候选、疑似不存在都算（与此前的结果可比）；新口径：相近候选不算误报，见“相近”一列。");
console.log("".padEnd(26) + VERDICTS.map((v) => LABEL[v].padStart(6 - (LABEL[v].length - 2))).join(""));
row("合计", results);
row("英文", results.filter((r) => cases[r.index - 1].label.lang === "en"));
row("中文", results.filter((r) => cases[r.index - 1].label.lang === "zh"));
const kinds = [...new Set(cases.map((c) => c.label.kind).filter((k): k is string => !!k))];
if (kinds.length > 1) for (const k of kinds) row(`类型 ${k}`, results.filter((r) => cases[r.index - 1].label.kind === k));
// 中文期刊论文：解析为期刊论文、题名（或方括号里的中文原文题名）是中文的条目，正是联网核查的对象
const zhJournal = (r: RefResult) => cases[r.index - 1].label.lang === "zh" && !!chineseJournalView(r.parsed);
row("中文期刊论文", results.filter(zhJournal));
const zhj = results.filter(zhJournal);
const share = (k: number) => (zhj.length ? `${k} 条（${((k / zhj.length) * 100).toFixed(0)}%）` : "-");
const bySite = Object.entries(zhj.filter((r) => r.verdict === "verified").reduce<Record<string, number>>((m, r) => ((m[r.match?.site ?? r.match?.source ?? "?"] = (m[r.match?.site ?? r.match?.source ?? "?"] ?? 0) + 1), m), {}));
console.log(`中文期刊论文 ${zhj.length} 条：待人工（无法核验）${share(zhj.filter((r) => r.verdict === "unverifiable").length)}，相近候选 ${share(zhj.filter((r) => r.verdict === "near_match").length)}，已核实 ${share(zhj.filter((r) => r.verdict === "verified").length)}（${bySite.map(([k, v]) => `${k} ${v}`).join("、") || "无"}），信息有误 ${share(zhj.filter((r) => r.verdict === "mismatch").length)}`);
console.log(`中文期刊联网核查：${cnEnabled ? `已开启，实际查了 ${results.filter((r) => r.steps.some((st) => st.action === "cn_search")).length} 条` : "未开启"}`);

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
      lang: langArg,
      mode: useAI ? "ai" : "rules",
      total: cases.length,
      seconds,
      aiFallbackBatches: useAI ? aiFallbackBatches : undefined,
      ai: useAI ? aiStats : undefined,
      openalexBudget: openalexArg ? openalexBudget : undefined,
      cnSearch: cnEnabled,
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
        aiFields: r.parsed.aiFields,
        zhJournal: zhJournal(r) || undefined,
        cnSearched: r.steps.some((st) => st.action === "cn_search") || undefined,
        // 中文期刊联网核查的每一步，逐条复核时对照（✗ 表示这一步没取到）
        cnSteps: r.steps.some((st) => st.action.startsWith("cn_")) ? r.steps.filter((st) => st.action.startsWith("cn_")).map((st) => `${st.ok ? "" : "✗ "}${st.detail}`) : undefined,
        notes: r.notes.length ? r.notes : undefined,
        match: r.match ? {
          doi: r.match.doi, title: r.match.title, year: r.match.year, source: r.match.source, site: r.match.site, url: r.match.url,
          // 中文网页记录逐条复核时要看作者和卷期页
          ...(r.match.source === "web" ? { authors: r.match.authors.map((a) => a.family + (a.given ?? "")).join("、"), venue: r.match.venue, volume: r.match.volume, issue: r.match.issue, pages: r.match.pages } : {}),
        } : undefined,
      })),
    },
    null,
    1,
  ),
);
console.log(`\n明细已写入 ${out}`);
