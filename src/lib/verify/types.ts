// 核验引擎的公共类型。前端和服务端共用，所以这里不能引入任何仅限服务端的模块。

/** 文献类型：优先取 GB/T 7714 的文献类型标识（[J] [M] [C] …），否则按特征推断 */
export type RefKind =
  | "journal"
  | "conference"
  | "book"
  | "thesis"
  | "standard"
  | "patent"
  | "report"
  | "newspaper"
  | "web"
  | "legal"
  | "software"
  | "presentation"
  | "archive"
  | "preprint"
  | "unknown";

/** 从一条参考文献原文里能本地解析出的信息（不调用任何外部服务） */
export interface ParsedRef {
  /** 在列表中的序号，从 1 开始 */
  index: number;
  /** 去掉序号后的原文 */
  raw: string;
  /** 小写的 DOI */
  doi?: string;
  arxivId?: string;
  year?: number;
  /** 启发式猜出的题名，猜不出就留空 */
  titleGuess?: string;
  /** 从原文提取的作者段，用于作者比对与展示 */
  authorsGuess?: string;
  /** 启发式猜出的期刊名（仅期刊类文献） */
  venueGuess?: string;
  kind: RefKind;
  lang: "zh" | "en";
}

export interface Author {
  family: string;
  given?: string;
}

export interface RetractionInfo {
  /** retracted：已撤稿；withdrawn：已撤回；concern：编辑部关注声明 */
  status: "retracted" | "withdrawn" | "concern";
  noticeDoi?: string;
  date?: string;
  /** 数据来源，例如 retraction-watch、publisher、openalex */
  source?: string;
}

/** 各数据源返回的元数据统一成这个结构 */
export interface WorkRecord {
  source: "crossref" | "doi-csl" | "openalex" | "datacite";
  doi?: string;
  title: string;
  subtitle?: string;
  authors: Author[];
  year?: number;
  /** 其他出版年份（在线首发、纸本出版等），引文写其中任何一个都不算错 */
  years?: number[];
  venue?: string;
  venueShort?: string;
  /** 期刊 ISSN，用于查该刊的其他名称 */
  issn?: string[];
  volume?: string;
  issue?: string;
  pages?: string;
  type?: string;
  url?: string;
  retraction?: RetractionInfo;
}

/**
 * 核验结论：
 * - verified：找到同一篇文献，信息一致
 * - mismatch：确认是同一篇，但作者 / 年份 / 期刊 / DOI 等信息有误；或引用的 DOI 未注册、指向别的文献（即使另有相近候选）
 * - near_match：只找到相近的记录，不能确认是同一篇，也没有哪项信息被确认写错，需要人工核对
 * - not_found：有较强证据表明文献不存在（DOI 未注册、DOI 指向别的文献、看得出是期刊 / 会议论文的英文文献在库中查无此文）
 * - retracted：文献存在但已撤稿 / 撤回
 * - concern：期刊发布关注声明，不等于已撤稿
 * - unverifiable：不在开放数据库的覆盖范围内（图书、学位论文、网页、无 DOI 的中文文献等），查不到不代表有问题
 * - error：核验过程出错（网络、限流等）
 */
export const VERDICTS = ["verified", "mismatch", "near_match", "not_found", "retracted", "concern", "unverifiable", "error"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type FieldName = "title" | "authors" | "year" | "venue" | "doi";

export interface FieldCheck {
  field: FieldName;
  status: "match" | "partial" | "mismatch" | "missing";
  /** 引用里的写法（尽力解析，可能为空） */
  cited?: string;
  /** 数据库记录 */
  actual?: string;
}

/** 核查过程中的每一步，前端用来展示"查了哪里、为什么这样判" */
export interface CheckStep {
  action:
    | "doi_lookup"
    | "doi_registry"
    | "doi_csl"
    | "crossref_search"
    | "crossref_journal"
    | "openalex_lookup"
    | "openalex_search"
    | "openalex_source"
    | "agent_search"
    | "agent_note";
  detail: string;
  ok: boolean;
  ms: number;
  /** AI 检索步骤里模型给出的检索理由（只是计划说明，不是结论） */
  reason?: string;
}

/** AI 检索 Agent 的追查记录：模型只决定怎么查，结论仍由规则引擎给出 */
export interface AgentTrace {
  model: string;
  /** 实际执行的检索 / DOI 查询次数 */
  toolCalls: number;
  /** 调用模型的轮数 */
  rounds: number;
  /** 规则复核后：找到并确认了同一篇（confirmed），或仍未确认（unchanged） */
  outcome: "confirmed" | "unchanged";
  /** 追查前的结论，便于对照 */
  before: { verdict: Verdict; summary: string };
  /** 模型写的检索小结，只描述查了什么，不作为结论 */
  note?: string;
  /** 模型消耗的 token 数（模型返回 usage 时才有） */
  tokens?: number;
  ms: number;
}

export interface RefResult {
  index: number;
  raw: string;
  verdict: Verdict;
  /** 0–1，规则匹配参考值，不是经统计校准的正确概率 */
  confidence: number;
  /** 一句话结论 */
  summary: string;
  /** 具体问题列表（会影响结论） */
  issues: string[];
  /** 提示信息（不影响结论，比如在线发表与正式出版相差一年、建议补充 DOI） */
  notes: string[];
  /** 数据库中的匹配记录（如有） */
  match?: WorkRecord;
  /** 候选尚未确认是同一篇时，禁止自动替换原引文。 */
  matchStatus?: "confirmed" | "candidate";
  fields: FieldCheck[];
  /** 根据数据库记录生成的规范写法，只来自检索结果，绝不由模型生成 */
  suggestion?: string;
  steps: CheckStep[];
  parsed: ParsedRef;
  /** 经过 AI 检索 Agent 追查时才有 */
  agent?: AgentTrace;
}

export interface CheckStats {
  total: number;
  counts: Record<Verdict, number>;
  ms: number;
}

/** /api/check 以 NDJSON 流式返回的事件 */
export type CheckEvent =
  | { type: "phase"; phase: "extract" | "verify"; message: string }
  | { type: "notice"; message: string }
  | { type: "meta"; total: number; refs: ParsedRef[] }
  | { type: "result"; result: RefResult }
  | { type: "done"; stats: CheckStats }
  | { type: "fatal"; message: string };
