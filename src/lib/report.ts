import type { ParsedRef, RefResult } from "./verify/types";

export function buildFixedList(refs: ParsedRef[], results: Map<number, RefResult>): string {
  return refs.map(ref => {
    const r = results.get(ref.index);
    const n = `[${ref.index}] `;
    if (!r || r.verdict === "error") return n + ref.raw + " 【未完成核查】";
    switch (r.verdict) {
      case "mismatch": return r.matchStatus === "candidate"
        ? n + ref.raw + " 【仅找到相近候选，请人工确认是否同一篇】"
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
  const lines = ["# 引用体检报告", "", `生成时间：${new Date().toISOString()}`, `状态：${finished ? "核查完成" : "未完成，部分条目仍需重试"}`, `收到结果：${results.size} / ${refs.length}`, "", "核查只覆盖公开数据库可提供的证据；未检索到不等于不存在。请保留人工复核。", ""];
  for (const ref of refs) {
    const r = results.get(ref.index);
    lines.push(`## 文献 ${ref.index}`, "", `原文：${safe(ref.raw)}`, "", `结论：${r ? safe(r.summary) : "未完成核查"}`);
    if (r) {
      for (const issue of r.issues) lines.push(`- 问题：${safe(issue)}`);
      for (const note of r.notes) lines.push(`- 提示：${safe(note)}`);
      if (r.match?.doi) lines.push(`- 数据库 DOI：${safe(r.match.doi)}`);
      if (r.suggestion) lines.push("", `${r.matchStatus === "candidate" ? "相近候选写法（待确认，不能直接替换）" : "数据库规范写法"}：${safe(r.suggestion)}`);
      if (r.steps.length) lines.push("", "核查证据：", ...r.steps.map(s => `- ${safe(s.detail)}`));
    }
    lines.push("");
  }
  return lines.join("\n");
}
