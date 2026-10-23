import { agentSummary } from "./agent-stream";
import { VERDICT_META, VERDICT_ORDER } from "./verdict-meta";
import { formatApa, formatGbt } from "./verify/format";
import type { ParsedRef, RefResult, Verdict } from "./verify/types";
import { localTime } from "./report-html";

export type CitationStyle = "gbt" | "apa";

/** 规范参考文献里的一条：rewritten 为 true 时 text 是按数据库记录重写的，否则是原文；note 是要附在末尾的提醒 */
export interface StandardEntry {
  index: number;
  text: string;
  rewritten: boolean;
  note?: string;
  /** 没查完时没有 */
  verdict?: Verdict;
}

const LEADING_NUMBER = /^\s*(?:\[\d+\]|\d+[.、)])\s*/;
const REWRITABLE: Verdict[] = ["verified", "mismatch", "retracted", "concern"];

/**
 * 整份参考文献按一种格式重排：确认是同一篇、而且服务端给过规范写法的条目（建议写法缺作者等信息时服务端不给），
 * 按所选格式用数据库记录重写；相近候选、查不到、待人工、没查完的保留原文并注明原因，不替用户猜。
 * GB/T 7714 用顺序编码，保持原来的顺序和序号；APA 按第一作者排序、不编号。
 */
export function standardEntries(refs: ParsedRef[], results: Map<number, RefResult>, style: CitationStyle): StandardEntry[] {
  const entries = refs.map((ref): StandardEntry => {
    const r = results.get(ref.index);
    const keep = (note?: string): StandardEntry => ({ index: ref.index, text: ref.raw.replace(LEADING_NUMBER, "").trim(), rewritten: false, note, verdict: r?.verdict });
    if (!r || r.verdict === "error") return keep("未完成核查");
    if (r.match && r.suggestion && r.matchStatus === "confirmed" && REWRITABLE.includes(r.verdict)) {
      const note = r.verdict === "retracted" ? "已撤稿 / 撤回，建议删除或替换" : r.verdict === "concern" ? "期刊发布关注声明，请审慎核查" : undefined;
      return { index: ref.index, text: style === "gbt" ? formatGbt(r.match) : formatApa(r.match), rewritten: true, note, verdict: r.verdict };
    }
    switch (r.verdict) {
      case "verified": return keep("已核实，数据库记录不全，保留原文");
      case "near_match": return keep("仅找到相近候选，请人工确认是否同一篇");
      case "mismatch": return keep(r.matchStatus === "candidate" ? "DOI 有误，仅找到相近候选，请人工确认是否同一篇" : "信息有误，请核对");
      case "not_found": return keep("疑似不存在，请核实或删除");
      default: return keep("请人工核查");
    }
  });
  if (style === "apa") {
    const collator = new Intl.Collator("zh-Hans-CN-u-co-pinyin", { sensitivity: "base", numeric: true });
    entries.sort((a, b) => collator.compare(a.text, b.text));
  }
  return entries;
}

export function buildStandardList(refs: ParsedRef[], results: Map<number, RefResult>, style: CitationStyle): string {
  return standardEntries(refs, results, style)
    .map((e) => `${style === "gbt" ? `[${e.index}] ` : ""}${e.text}${e.note ? ` 【${e.note}】` : ""}`)
    .join("\n");
}

export function buildFixedList(refs: ParsedRef[], results: Map<number, RefResult>): string {
  return refs.map(ref => {
    const r = results.get(ref.index);
    const n = `[${ref.index}] `;
    if (!r || r.verdict === "error") return n + ref.raw + " 【未完成核查】";
    switch (r.verdict) {
      case "near_match": return n + ref.raw + " 【仅找到相近候选，请人工确认是否同一篇】";
      // DOI 写错、另有相近候选时同样不能用候选替换原文
      case "mismatch": return r.matchStatus === "candidate"
        ? n + ref.raw + " 【DOI 有误，仅找到相近候选，请人工确认是否同一篇】"
        : n + (r.suggestion ?? ref.raw) + (r.suggestion ? "" : " 【信息有误，请核对】");
      case "retracted": return n + (r.suggestion ?? ref.raw) + " 【已撤稿 / 撤回，建议删除或替换】";
      case "concern": return n + (r.suggestion ?? ref.raw) + " 【期刊发布关注声明，请审慎核查】";
      case "not_found": return n + ref.raw + " 【疑似不存在，请核实或删除】";
      case "unverifiable": return n + ref.raw + " 【请人工核查】";
      default: return n + ref.raw;
    }
  }).join("\n");
}

// Escape user and upstream text before putting it into a Markdown document.
const safe = (s: string) => s.replace(/\r?\n/g, " ").replace(/[\\`*_{}[\]<>#|]/g, "\\$&");
export function buildReportMarkdown(refs: ParsedRef[], results: Map<number, RefResult>, complete: boolean): string {
  const finished = complete && results.size === refs.length && [...results.values()].every(r => r.verdict !== "error");
  const counts = new Map<Verdict, number>();
  for (const r of results.values()) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
  const tally = VERDICT_ORDER.filter(v => counts.get(v)).map(v => `${VERDICT_META[v].label} ${counts.get(v)}`).join("，");
  const lines = ["# 引用体检报告", "", `生成时间：${localTime()}`, `状态：${finished ? "核查完成" : "未完成，部分条目仍需重试"}`, `收到结果：${results.size} / ${refs.length}`, `结论统计：${tally || "暂无"}`, "", "核查只覆盖公开数据库可提供的证据；未检索到不等于不存在。请保留人工复核。"];
  if (counts.get("near_match")) lines.push("相近候选只是找到了相近的记录、未能确认是同一篇，不算信息有误，请逐条人工核对。");
  lines.push("");
  for (const ref of refs) {
    const r = results.get(ref.index);
    const label = r ? VERDICT_META[r.verdict].label : "";
    const verdict = !r ? "未完成核查" : r.summary.startsWith(label) ? safe(r.summary) : `【${label}】${safe(r.summary)}`;
    lines.push(`## 文献 ${ref.index}`, "", `原文：${safe(ref.raw)}`, "", `结论：${verdict}`);
    if (r) {
      for (const issue of r.issues) lines.push(`- 问题：${safe(issue)}`);
      for (const note of r.notes) lines.push(`- 提示：${safe(note)}`);
      if (r.agent) lines.push(`- AI 检索：${safe(agentSummary(r.agent))}（追查前：${safe(r.agent.before.summary)}；结论由规则复核给出）`);
      if (r.match?.doi) lines.push(`- 数据库 DOI：${safe(r.match.doi)}`);
      if (r.match?.source === "web" && r.match.url) lines.push(`- 来源页面（${safe(r.match.site ?? "中文学术网站")}）：${safe(r.match.url)}`);
      if (r.suggestion) lines.push("", `${r.matchStatus === "candidate" ? "相近候选写法（待确认，不能直接替换）" : "数据库规范写法"}：${safe(r.suggestion)}`);
      if (r.steps.length) lines.push("", "核查证据：", ...r.steps.map(s => `- ${s.reason ? `（AI 检索理由：${safe(s.reason)}）` : ""}${safe(s.detail)}`));
    }
    lines.push("");
  }
  return lines.join("\n");
}
