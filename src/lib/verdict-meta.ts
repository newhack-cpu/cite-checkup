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
  mismatch: { stamp: "有误", label: "信息有误", hint: "确认是同一篇，但作者、年份、期刊或 DOI 写错了；或引用的 DOI 未注册、指向别的文献", color: "var(--color-amber)" },
  near_match: { stamp: "相近候选", label: "相近候选", hint: "找到相近的记录，但不能确认是同一篇；不算信息有误，请人工核对", color: "var(--color-iris)" },
  not_found: { stamp: "查无此文", label: "疑似不存在", hint: "DOI 未注册、DOI 指向别的文献，或开放数据库中查无此文", color: "var(--color-seal)" },
  retracted: { stamp: "已撤稿", label: "撤稿 / 撤回", hint: "文献已被撤稿或撤回，请查阅原始声明", color: "var(--color-oxblood)" },
  concern: { stamp: "关注声明", label: "关注声明", hint: "期刊发布了关注声明，尚不等于已撤稿，请审慎核查", color: "var(--color-amber)" },
  unverifiable: { stamp: "待人工", label: "无法核验", hint: "图书、学位论文、网页等不在开放数据库覆盖范围内，或开放数据库和联网检索都没能核对到的中文文献", color: "var(--color-slate)" },
  error: { stamp: "未完成", label: "出错", hint: "数据源暂时不可用，可稍后重试", color: "var(--color-ink-faint)" },
};

export const VERDICT_ORDER: Verdict[] = ["not_found", "retracted", "concern", "mismatch", "verified", "near_match", "unverifiable", "error"];

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
  doi_chndoi: "中国 DOI",
  crossref_search: "Crossref",
  crossref_journal: "Crossref",
  openalex_lookup: "OpenAlex",
  openalex_search: "OpenAlex",
  openalex_source: "OpenAlex",
  cn_search: "DeepSeek 搜索",
  cn_page: "原文页面",
  cn_crossref: "Crossref",
  agent_search: "AI 检索",
  agent_note: "AI 小结",
};

/**
 * 引用健康度 = (已核实 + 0.5 × 信息有误) ÷ (已出结论且可核验的条数)。
 * 相近候选、无法核验、出错的条目不计入分母，因为没有确认是同一篇，说明不了引用本身的好坏；关注声明也不计入。
 */
export function healthScore(counts: Partial<Record<Verdict, number>>): number | undefined {
  const judged = (counts.verified ?? 0) + (counts.mismatch ?? 0) + (counts.not_found ?? 0) + (counts.retracted ?? 0);
  if (!judged) return undefined;
  return Math.round((100 * ((counts.verified ?? 0) + 0.5 * (counts.mismatch ?? 0))) / judged);
}
