// 对照实验：同一批构造引文（eval/compare/compare-2026-10-18.json，见 scripts/build-compare-set.mts），
// 比较本系统的三档做法和“直接问 AI”。
//   rules-crossref  本系统，只用 Crossref 和 DOI 注册查询（消融：去掉 OpenAlex 兜底）
//   rules           本系统标准核验
//   rules-cn        标准核验 + 中文期刊联网核查（10-20 加入标准核验后补跑中文条目，需要 DEEPSEEK_API_KEY）
//   agent           标准核验后，对“无法核验 / 相近候选”的条目再点“AI 继续查”
//   ai-flash / ai-pro                 直接问 DeepSeek（深度思考，不联网），模型自己下结论
//   ai-flash-search / ai-pro-search   DeepSeek 深度思考 + 联网搜索工具（最多 3 次），模型自己下结论
// 用法（需要代理时先设 NODE_USE_ENV_PROXY=1）：
//   pnpm exec tsx scripts/eval-compare.mts --systems=rules-crossref,rules,agent [--limit=N] [--concurrency=K] [--ids=C01,F-I02]
//   pnpm exec tsx scripts/eval-compare.mts --score      汇总，核对 DOI，写 summary.json / summary.md
// 每个系统逐条写入 eval/results/compare-2026-10-18/<system>.json，已完成的条目不重复跑（--force 重跑）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { runAgent } from "../src/lib/agent";
import { agentEligible } from "../src/lib/agent-stream";
import { deepseekConfiguration } from "../src/lib/ai";
import { parseReference } from "../src/lib/verify/extract";
import { dice } from "../src/lib/verify/normalize";
import { crossrefByDoi } from "../src/lib/verify/sources/crossref";
import { deepseekSearch } from "../src/lib/verify/sources/cnweb";
import { defaultCnBudget } from "../src/lib/verify/cnjournal";
import { doiCsl, doiRegistry } from "../src/lib/verify/sources/doi";
import type { RefResult } from "../src/lib/verify/types";
import { verifyReference } from "../src/lib/verify/verify";

try {
  process.loadEnvFile(".env.local");
} catch {
  // AI 基线和 Agent 需要 DEEPSEEK_API_KEY
}

const DATA = "eval/compare/compare-2026-10-18.json";
const OUT_DIR = "eval/results/compare-2026-10-18";
const args = process.argv.slice(2);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const force = args.includes("--force");
// --tag=run2：同一做法再跑一遍，结果另存为 <system>-run2.json，用来看两次结论是否一致
const tag = option("tag");

type Truth = "correct" | "error" | "fabricated";
type Field = "year" | "author" | "venue" | "doi" | "title";
interface Item {
  id: string; raw: string; lang: "en" | "zh"; truth: Truth; kind: string; field?: Field; doiInRaw?: boolean;
  record?: { doi?: string; title: string; firstAuthor?: string; year?: number; venue?: string };
  change?: { from: string; to: string; note?: string };
}
/** 统一口径：ok 认为真实且正确；error 认为存在但有错；fake 认为不存在；unsure 无法判断 / 只有相近候选 / 未完成 */
type Canon = "ok" | "error" | "fake" | "unsure";
interface Output {
  id: string; verdict: string; canon: Canon; matchStatus?: string;
  fields?: Field[]; corrected?: string; doi?: string; summary?: string;
  ms: number; tokens?: number; searches?: number; error?: string; answer?: unknown;
}

const data = JSON.parse(readFileSync(DATA, "utf8")) as { items: Item[] };
const ids = option("ids")?.split(",");
const limit = Number(option("limit") ?? Infinity);
const items = data.items.filter((it) => !ids || ids.includes(it.id)).slice(0, limit);
mkdirSync(OUT_DIR, { recursive: true });

const fileOf = (system: string, run = tag) => `${OUT_DIR}/${system}${run ? `-${run}` : ""}.json`;
function load(system: string, run = tag): Record<string, Output> {
  return existsSync(fileOf(system, run)) ? (JSON.parse(readFileSync(fileOf(system, run), "utf8")) as { outputs: Record<string, Output> }).outputs : {};
}
function save(system: string, outputs: Record<string, Output>, meta: Record<string, unknown>) {
  // 先写临时文件再改名；Windows 上别的进程正在读时会写失败，稍后重试（10-18 汇总时撞上过一次）
  const text = JSON.stringify({ system, dataset: DATA, updatedAt: new Date().toISOString(), ...meta, outputs }, null, 1);
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(`${fileOf(system)}.tmp`, text);
      renameSync(`${fileOf(system)}.tmp`, fileOf(system));
      return;
    } catch (error) {
      if (attempt >= 5) throw error;
      const until = Date.now() + 200 * (attempt + 1);
      while (Date.now() < until) { /* 等文件释放 */ }
    }
  }
}

async function pool<T>(list: T[], concurrency: number, work: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) await work(list[next++]);
  }));
}

// ---------- 本系统 ----------

const FIELD_WORDS: [RegExp, Field][] = [[/年份/, "year"], [/作者/, "author"], [/期刊|刊名/, "venue"], [/DOI/, "doi"], [/题名/, "title"]];
function ours(r: RefResult, ms: number): Output {
  const canon: Canon = r.verdict === "verified" || r.verdict === "retracted" || r.verdict === "concern" ? "ok"
    : r.verdict === "mismatch" ? "error" : r.verdict === "not_found" ? "fake" : "unsure";
  const fields = [...new Set(r.issues.flatMap((issue) => FIELD_WORDS.filter(([re]) => re.test(issue)).map(([, f]) => f)))];
  const confirmed = r.matchStatus === "confirmed";
  return {
    id: "", verdict: r.verdict, canon, matchStatus: r.matchStatus, fields, summary: r.summary, ms,
    corrected: confirmed ? r.suggestion : undefined, doi: confirmed ? r.match?.doi : undefined,
    searches: r.agent?.toolCalls,
    tokens: r.agent?.tokens,
  };
}

async function runRules(system: "rules-crossref" | "rules" | "rules-cn") {
  const outputs = force ? {} : load(system);
  const todo = items.filter((it) => !outputs[it.id]);
  // 与界面相同的单条核验；OpenAlex 题名检索额度：去掉 OpenAlex 的消融为 0，标准核验按条数给足
  // rules-cn 的联网核查额度也按条数给足，没有整体时限
  const cn = system === "rules-cn" ? defaultCnBudget() : undefined;
  if (system === "rules-cn" && !cn) throw new Error("rules-cn 需要 DEEPSEEK_API_KEY");
  if (cn) cn.left = Math.max(cn.left, todo.length);
  const ctx = { openalexBudget: { left: system === "rules-crossref" ? 0 : todo.length }, cn };
  await pool(todo, 3, async (it) => {
    const t = Date.now();
    const r = await verifyReference(parseReference(it.raw, 1), ctx);
    outputs[it.id] = { ...ours(r, Date.now() - t), id: it.id };
    save(system, outputs, { openalexLeft: ctx.openalexBudget.left });
  });
  console.log(`${system}：完成 ${Object.keys(outputs).length} 条`);
}

async function runAgentSystem() {
  const base = load("rules");
  const outputs = force ? {} : load("agent");
  const openalexPool = { left: Number(option("agent-openalex") ?? 30) };
  await pool(items.filter((it) => !outputs[it.id] && base[it.id]), Number(option("concurrency") ?? 2), async (it) => {
    const before = base[it.id];
    if (!agentEligible({ verdict: before.verdict as RefResult["verdict"], matchStatus: before.matchStatus as RefResult["matchStatus"] })) {
      outputs[it.id] = { ...before, searches: 0 };
    } else {
      const t = Date.now();
      try {
        const r = await runAgent(it.raw, 1, { openalexPool });
        outputs[it.id] = { ...ours(r, Date.now() - t), id: it.id };
      } catch (error) {
        outputs[it.id] = { ...before, error: (error as Error).message };
      }
    }
    save("agent", outputs, { agentOpenalexLeft: openalexPool.left });
    process.stdout.write(`agent ${it.id} ${before.verdict} → ${outputs[it.id].verdict}\n`);
  });
}

// ---------- 直接问 AI ----------

const SYSTEM_PROMPT = `你是严谨的学术文献核查助手。用户会给出一条参考文献，请判断：
1. 这篇文献是否真实存在；
2. 如果存在，作者、年份、题名、期刊、DOI 等著录信息是否有错。
只依据你掌握的知识{{SEARCH}}判断；没有把握时选择 uncertain，不要猜。
最后只输出一个 JSON 对象，格式如下：
{"verdict": "correct | has_error | fabricated | uncertain", "wrong_fields": ["author", "year", "title", "venue", "doi"], "corrected": "如果有错，给出改正后的完整引文；否则留空字符串", "doi": "这篇文献的正确 DOI，不知道就留空字符串", "reason": "一句话理由"}
其中 correct 表示真实存在且著录信息正确；has_error 表示真实存在但有错（在 wrong_fields 里列出错的字段）；fabricated 表示这篇文献不存在（编造或拼接）；uncertain 表示无法判断。`;

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "联网搜索网页，返回最多 5 条结果的标题、网址和摘要。学术数据库、出版社、知网等页面都可能出现在结果里。",
    parameters: { type: "object", properties: { query: { type: "string", description: "搜索词" } }, required: ["query"] },
  },
};
const MAX_SEARCHES = 3;

interface ChatMessage { role: string; content: string | null; reasoning_content?: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }

async function chat(body: Record<string, unknown>): Promise<{ message: ChatMessage; tokens: number }> {
  const { apiKey, endpoint } = deepseekConfiguration();
  if (!apiKey || !endpoint) throw new Error("DeepSeek 未配置");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(240_000),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
    const json = await res.json() as { choices: { message: ChatMessage }[]; usage?: { total_tokens?: number } };
    return { message: json.choices[0].message, tokens: json.usage?.total_tokens ?? 0 };
  }
}

function parseAnswer(content: string | null): { verdict?: string; wrong_fields?: string[]; corrected?: string; doi?: string; reason?: string } | undefined {
  if (!content) return undefined;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const AI_CANON: Record<string, Canon> = { correct: "ok", has_error: "error", fabricated: "fake", uncertain: "unsure" };
const AI_FIELDS: Record<string, Field> = { author: "author", authors: "author", year: "year", title: "title", venue: "venue", journal: "venue", doi: "doi" };

async function webSearch(query: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const hits = await deepseekSearch(query.slice(0, 128), 5);
      return hits.map((h) => ({ title: h.title, url: h.url, snippet: (h.snippet || h.summary).replace(/\s+/g, " ").slice(0, 400), date: h.date }));
    } catch (error) {
      if (attempt >= 3) return { error: (error as Error).message };
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function askAI(it: Item, model: string, search: boolean): Promise<Output> {
  const t = Date.now();
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT.replace("{{SEARCH}}", search ? "和 web_search 搜索到的结果" : "") },
    { role: "user", content: `请核查这条参考文献：\n${it.raw}` },
  ];
  let tokens = 0;
  let searches = 0;
  let answer: ReturnType<typeof parseAnswer>;
  for (let round = 0; round < MAX_SEARCHES + 2; round++) {
    const body: Record<string, unknown> = { model, messages, thinking: { type: "enabled" }, reasoning_effort: "high", max_tokens: 16000 };
    if (search) body.tools = [SEARCH_TOOL];
    else body.response_format = { type: "json_object" };
    const { message, tokens: used } = await chat(body);
    tokens += used;
    messages.push({ role: "assistant", content: message.content ?? "", reasoning_content: message.reasoning_content, tool_calls: message.tool_calls });
    if (search && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        let content: unknown;
        if (searches >= MAX_SEARCHES) content = { error: "搜索次数已用完，请直接输出 JSON 结论" };
        else {
          searches++;
          let query = "";
          try { query = String(JSON.parse(call.function.arguments).query ?? ""); } catch { /* 参数不是 JSON */ }
          content = query ? await webSearch(query) : { error: "缺少 query" };
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(content) });
      }
      continue;
    }
    answer = parseAnswer(message.content);
    break;
  }
  const verdict = answer?.verdict ?? "no_answer";
  return {
    id: it.id, verdict, canon: AI_CANON[verdict] ?? "unsure",
    fields: [...new Set((answer?.wrong_fields ?? []).map((f) => AI_FIELDS[String(f).toLowerCase()]).filter(Boolean))],
    corrected: answer?.corrected || undefined, doi: answer?.doi ? String(answer.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim() : undefined,
    summary: answer?.reason, ms: Date.now() - t, tokens, searches, answer,
  };
}

async function runAI(system: string, model: string, search: boolean) {
  const outputs = force ? {} : load(system);
  const todo = items.filter((it) => !outputs[it.id] || outputs[it.id].error);
  await pool(todo, Number(option("concurrency") ?? 6), async (it) => {
    try {
      outputs[it.id] = await askAI(it, model, search);
    } catch (error) {
      outputs[it.id] = { id: it.id, verdict: "failed", canon: "unsure", ms: 0, error: (error as Error).message };
    }
    save(system, outputs, { model, search, maxSearches: search ? MAX_SEARCHES : 0, thinking: "enabled/high" });
    process.stdout.write(`${system} ${it.id} ${it.truth} → ${outputs[it.id].verdict}${outputs[it.id].error ? `（${outputs[it.id].error}）` : ""}\n`);
  });
}

// ---------- 汇总 ----------

const SYSTEMS = ["rules-crossref", "rules", "rules-cn", "agent", "ai-flash", "ai-pro", "ai-flash-search", "ai-pro-search"];
const LABEL: Record<string, string> = {
  "rules-crossref": "本系统：只用 Crossref", rules: "本系统：规则核验", "rules-cn": "本系统：规则核验 + 中文期刊联网核查", agent: "本系统：规则 + AI 继续查",
  "ai-flash": "直接问 AI（flash，不联网）", "ai-pro": "直接问 AI（pro，不联网）",
  "ai-flash-search": "AI + 联网搜索（flash）", "ai-pro-search": "AI + 联网搜索（pro）",
};

const doiCache = new Map<string, { exists?: boolean; title?: string }>();
async function doiInfo(doi: string) {
  const key = doi.toLowerCase();
  if (!doiCache.has(key)) {
    const { record } = await crossrefByDoi(key);
    if (record) doiCache.set(key, { exists: true, title: record.title });
    else {
      // DataCite 等注册的 DOI（如 arXiv）Crossref 查不到，按 doi.org 内容协商取题名
      const reg = await doiRegistry(key);
      const csl = reg.exists ? (await doiCsl(key)).record : undefined;
      doiCache.set(key, { exists: reg.exists, title: csl?.title });
    }
  }
  return doiCache.get(key)!;
}

/** 改错的那一项，给出的改正写法是否改回了正确值 */
function fixedField(it: Item, text: string | undefined): boolean | undefined {
  if (!text || !it.field || !it.change || !it.record) return undefined;
  const t = text.toLowerCase();
  const has = (s?: string) => !!s && t.includes(s.toLowerCase());
  switch (it.field) {
    case "year": return new RegExp(`\\b${it.change.from}\\b`).test(text) && !new RegExp(`\\b${it.change.to}\\b`).test(text);
    case "author": return has(it.change.from) && !has(it.change.to);
    case "venue": return !has(it.change.to) && (has(it.record.venue) || has(it.change.from));
    case "doi": return has(it.change.from) && !has(it.change.to);
    default: return undefined;
  }
}

async function score() {
  const rows: Record<string, unknown>[] = [];
  const table: string[] = [];
  const perItem: Record<string, Record<string, string>> = {};
  for (const system of SYSTEMS) {
    if (!existsSync(fileOf(system))) continue;
    const outputs = load(system);
    const got = data.items.filter((it) => outputs[it.id]);
    const of = (truth: Truth, lang?: "en" | "zh") => got.filter((it) => it.truth === truth && (!lang || it.lang === lang));
    const count = (list: Item[], canon: Canon) => list.filter((it) => outputs[it.id].canon === canon).length;
    const summary: Record<string, unknown> = { system, label: LABEL[system], items: got.length };
    for (const lang of ["en", "zh"] as const) {
      const c = of("correct", lang), e = of("error", lang), f = of("fabricated", lang);
      summary[lang] = {
        correct: { n: c.length, ok: count(c, "ok"), error: count(c, "error"), fake: count(c, "fake"), unsure: count(c, "unsure") },
        error: { n: e.length, ok: count(e, "ok"), error: count(e, "error"), fake: count(e, "fake"), unsure: count(e, "unsure"),
          rightField: e.filter((it) => outputs[it.id].canon === "error" && outputs[it.id].fields?.includes(it.field!)).length },
        fabricated: { n: f.length, ok: count(f, "ok"), error: count(f, "error"), fake: count(f, "fake"), unsure: count(f, "unsure") },
      };
    }
    // 给出的 DOI：存在且指向同一篇 / 指向别的文献 / 不存在
    // 编造的条目本来就没有 DOI，给了就是错的：单独计数
    // 编造条目：拼接类给出题名所属真实论文的 DOI（按题名找到的那篇）不算编 DOI；其余（虚构题名配了 DOI、DOI 不存在）算错配
    const doiStats = { given: 0, right: 0, otherWork: 0, unregistered: 0, unknown: 0, onFabricated: 0, onFabricatedUnregistered: 0, onFabricatedTitleOwner: 0, onFabricatedWrong: 0 };
    for (const it of got) {
      const doi = outputs[it.id].doi;
      if (!doi || !/^10\.\d{4,9}\//.test(doi)) continue;
      const info = await doiInfo(doi);
      if (it.truth === "fabricated") {
        doiStats.onFabricated++;
        if (info.exists === false) doiStats.onFabricatedUnregistered++;
        const cited = it.change?.to ?? parseReference(it.raw, 1).titleGuess;
        if (info.exists && info.title && cited && dice(info.title, cited) >= 0.7) doiStats.onFabricatedTitleOwner++;
        else doiStats.onFabricatedWrong++;
        continue;
      }
      doiStats.given++;
      const expected = it.record?.title ?? parseReference(it.raw, 1).titleGuess;
      if (info.exists === false) doiStats.unregistered++;
      else if (info.exists === undefined || !info.title || !expected) doiStats.unknown++;
      else if (dice(info.title, expected) >= 0.7) doiStats.right++;
      else doiStats.otherWork++;
    }
    summary.doi = doiStats;
    const errors = of("error");
    const fixes = errors.map((it) => fixedField(it, [outputs[it.id].corrected, outputs[it.id].doi].filter(Boolean).join(" ")));
    summary.fixes = { offered: fixes.filter((x) => x !== undefined).length, right: fixes.filter((x) => x === true).length };
    const ms = got.map((it) => outputs[it.id].ms).filter((x) => x > 0);
    summary.avgSeconds = ms.length ? +(ms.reduce((a, b) => a + b, 0) / ms.length / 1000).toFixed(1) : 0;
    summary.avgTokens = Math.round(got.reduce((a, it) => a + (outputs[it.id].tokens ?? 0), 0) / Math.max(1, got.length));
    summary.failed = got.filter((it) => outputs[it.id].error).length;
    // 再跑一遍的结论是否一致（只比两次都有结果的条目）
    if (existsSync(fileOf(system, "run2"))) {
      const again = load(system, "run2");
      const both = got.filter((it) => again[it.id]);
      const same = both.filter((it) => again[it.id].canon === outputs[it.id].canon).length;
      summary.repeat = { compared: both.length, sameConclusion: same, changed: both.filter((it) => again[it.id].canon !== outputs[it.id].canon).map((it) => `${it.id} ${outputs[it.id].verdict}→${again[it.id].verdict}`) };
    }
    rows.push(summary);
    for (const it of got) (perItem[it.id] ??= {})[system] = outputs[it.id].verdict;

    const en = summary.en as Record<string, Record<string, number>>;
    const zh = summary.zh as Record<string, Record<string, number>>;
    const frac = (n: number, d: number) => (d ? `${n}/${d}（${Math.round(n / d * 100)}%）` : "—");
    // 说“没问题”的条目里，真的没问题的比例（英文；中文真实条目没有逐字段真值，不计）
    const saidOk = en.correct.ok + en.error.ok + en.fabricated.ok;
    summary.metrics = {
      okPrecision: saidOk ? +(en.correct.ok / saidOk).toFixed(3) : null,
      fabricatedAsOk: en.fabricated.ok + zh.fabricated.ok, fabricatedN: en.fabricated.n + zh.fabricated.n,
      errorAsOk: en.error.ok, errorN: en.error.n,
      realAsFake: en.correct.fake + zh.correct.fake, realN: en.correct.n + zh.correct.n,
      realAnswered: en.correct.ok + en.correct.error, realEnN: en.correct.n,
    };
    table.push([
      LABEL[system],
      frac(en.correct.ok, saidOk),
      `**${frac(en.fabricated.ok + zh.fabricated.ok, en.fabricated.n + zh.fabricated.n)}**`,
      `**${frac(en.error.ok, en.error.n)}**`,
      frac(en.correct.fake + zh.correct.fake, en.correct.n + zh.correct.n),
      frac(en.error.rightField, en.error.n),
      frac((summary.fixes as { right: number }).right, (summary.fixes as { offered: number }).offered),
      `${frac(doiStats.right, doiStats.given)}；编造条目配错 DOI ${doiStats.onFabricatedWrong} 条`,
      frac(en.correct.ok + en.correct.error, en.correct.n),
      `${summary.avgSeconds}s`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    console.log(system, JSON.stringify(summary));
  }
  const md = [
    "| 做法 | 说“没问题”时确实没问题（英文） | 编造被说成真实 | 改错被说成正确 | 真实被说成编造 | 改错：定位到改错的字段 | 给出的修正改对了 | 给出的 DOI 指向正确论文 | 真实英文条目有明确结论 | 平均用时 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...table,
  ].join("\n");
  writeFileSync(`${OUT_DIR}/summary.json`, JSON.stringify({ scoredAt: new Date().toISOString(), dataset: DATA, systems: rows, perItem }, null, 1));
  writeFileSync(`${OUT_DIR}/summary.md`, `${md}\n`);
  console.log(md);
}

if (args.includes("--score")) {
  await score();
} else {
  const systems = (option("systems") ?? "").split(",").filter(Boolean);
  for (const system of systems) {
    if (system === "rules-crossref" || system === "rules" || system === "rules-cn") await runRules(system);
    else if (system === "agent") await runAgentSystem();
    else if (system === "ai-flash") await runAI(system, "deepseek-flash", false);
    else if (system === "ai-pro") await runAI(system, "deepseek-v4-pro", false);
    else if (system === "ai-flash-search") await runAI(system, "deepseek-flash", true);
    else if (system === "ai-pro-search") await runAI(system, "deepseek-v4-pro", true);
    else throw new Error(`未知系统 ${system}`);
  }
}
