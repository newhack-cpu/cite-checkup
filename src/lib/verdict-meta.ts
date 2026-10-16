import type { CheckStep, FieldName, Verdict } from "@/lib/verify/types";

export interface VerdictMeta {
  /** 印章上的字 */
  stamp: string;
  /** 筛选标签和图例上的名称 */
  label: string;
  /** 图例里的解释 */
  hint: string;
  /** 主色（CSS 颜色值） */
  color: string;
}

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  verified: { stamp: "已核实", label: "已核实", hint: "文献存在，作者、年份、期刊、DOI 与数据库一致", color: "var(--color-jade)" },
  mismatch: { stamp: "有误", label: "信息有误", hint: "文献存在，但作者、年份、期刊或 DOI 写错了", color: "var(--color-amber)" },
  not_found: { stamp: "查无此文", label: "疑似不存在", hint: "DOI 未注册、DOI 指向别的文献，或开放数据库中查无此文", color: "var(--color-seal)" },
  retracted: { stamp: "已撤稿", label: "撤稿 / 撤回", hint: "文献已被撤稿或撤回，请查阅原始声明", color: "var(--color-oxblood)" },
  concern: { stamp: "关注声明", label: "关注声明", hint: "期刊发布了关注声明，尚不等于已撤稿，请审慎核查", color: "var(--color-amber)" },
  unverifiable: { stamp: "待人工", label: "无法核验", hint: "图书、学位论文、网页、无 DOI 的中文文献等，不在开放数据库覆盖范围内", color: "var(--color-slate)" },
  error: { stamp: "未完成", label: "出错", hint: "数据源暂时不可用，可稍后重试", color: "var(--color-ink-faint)" },
};

export const VERDICT_ORDER: Verdict[] = ["not_found", "retracted", "concern", "mismatch", "verified", "unverifiable", "error"];

export const FIELD_LABEL: Record<FieldName, string> = {
  title: "题名",
  authors: "作者",
  year: "年份",
  venue: "期刊 / 会议",
  doi: "DOI",
};

export const STEP_SOURCE: Record<CheckStep["action"], string> = {
  doi_lookup: "Crossref",
  doi_registry: "doi.org",
  doi_csl: "doi.org",
  crossref_search: "Crossref",
  crossref_journal: "Crossref",
  openalex_lookup: "OpenAlex",
  openalex_search: "OpenAlex",
  openalex_source: "OpenAlex",
  agent_search: "AI 检索",
  agent_note: "AI 小结",
};

/**
 * 引用健康度 = (已核实 + 0.5 × 信息有误) ÷ (已出结论且可核验的条数)。
 * 无法核验、出错的条目不计入分母，因为它们说明不了引用本身的好坏。
 */
export function healthScore(counts: Partial<Record<Verdict, number>>): number | undefined {
  const judged = (counts.verified ?? 0) + (counts.mismatch ?? 0) + (counts.not_found ?? 0) + (counts.retracted ?? 0);
  if (!judged) return undefined;
  return Math.round((100 * ((counts.verified ?? 0) + 0.5 * (counts.mismatch ?? 0))) / judged);
}
