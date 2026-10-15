import type { ClaimResult, ClaimVerdict } from "./claims/types";

export const CLAIM_LABELS: Record<ClaimVerdict, string> = {
  supported: "证据支持",
  partially_supported: "部分支持",
  contradicted: "与证据矛盾",
  insufficient_evidence: "证据不足",
};

const safe = (value: string) => value.replace(/\r?\n/g, " ").replace(/[\\`*_{}[\]<>#|]/g, "\\$&");

export function buildClaimReport(result: ClaimResult): string {
  const lines = ["# 正文论断核查报告", "", `生成时间：${new Date().toISOString()}`, "",
    `核查状态：${result.status === "complete" ? "已完成" : "未完成"}`,
    `论断：${safe(result.claim)}`,
    `判断：${result.status === "complete" && result.verdict ? CLAIM_LABELS[result.verdict] : "本次未形成判断"}`,
    `说明：${safe(result.explanation)}`, "",
    `来源：${safe(result.source?.label ?? "未取得证据")}`,
    `证据范围：${result.source?.scope === "abstract" ? "数据库摘要，未核查全文" : result.source ? "用户提供的文本，未独立认证来源" : "无"}`,
  ];
  if (result.source?.doi) lines.push(`DOI：${safe(result.source.doi)}`);
  if (result.source?.title) lines.push(`文献题名：${safe(result.source.title)}`);
  lines.push(`检索覆盖：${result.coverage.retrievedChunks} / ${result.coverage.totalChunks} 个片段，${result.coverage.retrievedChars} 字符`, "");
  for (const warning of result.warnings) lines.push(`- 边界提示：${safe(warning)}`);
  lines.push("", "## 判断引用的原文", "");
  if (!result.citations.length) lines.push("无有效原文引句。证据不足或未完成均不代表论断错误。");
  for (const citation of result.citations) lines.push(`- [${safe(citation.chunkId)}] ${safe(citation.quote)}（文本位置 ${citation.start + 1}–${citation.end}）`);
  lines.push("", "## 召回证据", "");
  for (const chunk of result.chunks) lines.push(`### ${safe(chunk.id)} · 文本位置 ${chunk.start + 1}–${chunk.end}`, "", safe(chunk.text), "");
  lines.push("模型判断只针对本次提供和召回的证据，不替代对原始全文、研究方法与撤稿状态的人工复核。", "");
  return lines.join("\n");
}
