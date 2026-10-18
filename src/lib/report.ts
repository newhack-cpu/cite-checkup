import { agentSummary } from "./agent-stream";
import { VERDICT_META, VERDICT_ORDER } from "./verdict-meta";
import type { ParsedRef, RefResult, Verdict } from "./verify/types";

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
  const lines = ["# 引用体检报告", "", `生成时间：${new Date().toISOString()}`, `状态：${finished ? "核查完成" : "未完成，部分条目仍需重试"}`, `收到结果：${results.size} / ${refs.length}`, `结论统计：${tally || "暂无"}`, "", "核查只覆盖公开数据库可提供的证据；未检索到不等于不存在。请保留人工复核。"];
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
