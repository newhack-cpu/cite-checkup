// 真实论文评测的计数口径。数据集里的每条文献都视为真实存在，所以系统标成"有问题"的先算误报，再逐条复核。
// 2026-10-16 夜起结论多了"相近候选"（near_match，只找到相近记录、没有确认是同一篇），误报同时按两种口径报告：
//   旧口径：信息有误、相近候选、疑似不存在都算误报，与此前的结果文件同一口径，可以直接比较；
//   新口径：相近候选不算误报（它没有断言引文哪里写错），单独统计条数。
// 此前的结果文件里没有 near_match："只找到相近候选"记为 mismatch，summary 里写着"相近"。
import type { Verdict } from "../src/lib/verify/types";

export type Caliber = "old" | "new";

export interface Outcome {
  verdict: Verdict;
  /** 数据集标注：源论文本身确有笔误时，"信息有误"算对 */
  acceptMismatch?: boolean;
}

export function isFalseAlarm(r: Outcome, caliber: Caliber): boolean {
  if (r.verdict === "not_found") return true;
  if (r.acceptMismatch) return false;
  return r.verdict === "mismatch" || (caliber === "old" && r.verdict === "near_match");
}

/**
 * 与界面的 agentEligible 一致：无法核验、相近候选，以及 DOI 写错但另有相近候选的条目可以交给 Agent。
 * 10-16 夜以前的结果文件不记录 matchStatus，只能靠 summary 里的"相近"识别候选。
 */
export function agentEligibleRow(r: { verdict: Verdict; summary: string; matchStatus?: string }): boolean {
  if (r.verdict === "unverifiable" || r.verdict === "near_match") return true;
  return r.verdict === "mismatch" && (r.matchStatus ? r.matchStatus === "candidate" : r.summary.includes("相近"));
}
