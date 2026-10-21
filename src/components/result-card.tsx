"use client";

import { useState, type CSSProperties } from "react";
import { agentSummary } from "@/lib/agent-stream";
import { inkDrop } from "@/lib/motion";
import { FIELD_LABEL, STEP_SOURCE, VERDICT_META } from "@/lib/verdict-meta";
import type { AgentTrace, CheckStep, FieldCheck, ParsedRef, RefResult } from "@/lib/verify/types";
import { IconCheck, IconChevron, IconCopy, IconSpark } from "./icons";
import { PendingStamp, Stamp } from "./seal";

const FIELD_MARK: Record<FieldCheck["status"], { sign: string; text: string; color: string }> = {
  match: { sign: "✓", text: "一致", color: "var(--color-jade)" },
  partial: { sign: "≈", text: "部分一致", color: "var(--color-amber)" },
  mismatch: { sign: "✗", text: "不符", color: "var(--color-seal)" },
  missing: { sign: "—", text: "未提供", color: "var(--color-ink-faint)" },
};

function DoiLink({ doi }: { doi: string }) {
  return (
    <a
      href={`https://doi.org/${doi}`}
      target="_blank"
      rel="noreferrer"
      className="break-all font-mono text-[12.5px] text-ink-soft underline decoration-rule decoration-1 underline-offset-4 hover:text-seal hover:decoration-seal"
    >
      {doi}
    </a>
  );
}

function FieldValue({ field, value }: { field: FieldCheck["field"]; value?: string }) {
  if (!value) return <span className="text-ink-faint">—</span>;
  return field === "doi" ? <DoiLink doi={value} /> : <>{value}</>;
}

/** 比对表：卡片够宽时四列并排，窄的时候"引用 / 数据库"上下排（按卡片宽度而不是屏幕宽度切换） */
function FieldTable({ fields, aiFields = [] }: { fields: FieldCheck[]; aiFields?: FieldCheck["field"][] }) {
  const row = "grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 @lg:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_5rem]";
  return (
    <div className="@container rounded-xl border border-hair bg-paper/50 px-4 py-1 text-[13.5px]">
      <div className={`${row} hidden border-b border-hair py-2 text-[12px] text-ink-faint @lg:grid`}>
        <span>字段</span>
        <span>引用中的写法</span>
        <span>数据库记录</span>
        <span className="text-right">比对</span>
      </div>
      {fields.map((f) => {
        const mark = FIELD_MARK[f.status];
        return (
          <div key={f.field} className={`${row} gap-y-1 border-b border-hair py-2.5 leading-6 last:border-0`}>
            <span className="col-start-1 row-start-1 text-ink-soft">{FIELD_LABEL[f.field]}</span>
            <span className="col-start-2 row-start-1 min-w-0 break-words text-ink-soft">
              <span className="mr-1.5 text-[11.5px] text-ink-faint @lg:hidden">引用</span>
              <FieldValue field={f.field} value={f.cited} />
              {aiFields.includes(f.field) && f.cited && (
                <span
                  className="ml-1.5 whitespace-nowrap rounded border border-ink/20 px-1 text-[11px] text-ink-faint"
                  title="规则没解析出这一项，由 DeepSeek 从引文原文中逐字摘出，已核对确是原文片段"
                >
                  AI 摘出
                </span>
              )}
            </span>
            <span className="col-start-2 row-start-2 min-w-0 break-words text-ink @lg:col-start-3 @lg:row-start-1">
              <span className="mr-1.5 text-[11.5px] text-ink-faint @lg:hidden">数据库</span>
              <FieldValue field={f.field} value={f.actual} />
            </span>
            <span className="col-start-3 row-start-1 whitespace-nowrap text-right @lg:col-start-4" style={{ color: mark.color }}>
              <span className="mr-1 font-mono">{mark.sign}</span>
              {mark.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Suggestion({ text, candidate = false }: { text: string; candidate?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative rounded-xl border border-dashed border-ink/20 bg-paper/50 px-4 py-3 pr-24">
      <p className="mb-1 text-[12px] text-ink-faint">{candidate ? "相近候选的写法 · 确认同一篇后再使用" : "按数据库记录生成的规范写法"}</p>
      <p className="break-words font-serif text-[14.5px] leading-7 text-ink">{text}</p>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            setFailed(true);
          }
        }}
        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-rule bg-card px-2.5 py-1 text-[12px] text-ink-soft transition hover:border-seal/50 hover:text-seal focus-visible:outline-2 focus-visible:outline-seal"
      >
        {copied ? <IconCheck className="text-jade" /> : <IconCopy />}
        {copied ? "已复制" : "复制"}
      </button>
      {failed && <p role="alert" className="mt-2 text-xs text-seal">复制未获允许，请手动选择文字复制。</p>}
    </div>
  );
}

function Steps({ steps }: { steps: RefResult["steps"] }) {
  return (
    <ol className="relative ml-1.5 space-y-2 border-l border-rule pl-5">
      {steps.map((s, i) => {
        const ai = s.action === "agent_search" || s.action === "agent_note";
        return (
          <li key={i} className="relative text-[13px] leading-6 text-ink-soft">
            <span
              aria-hidden
              className="absolute -left-[25px] top-[9px] size-[9px] rounded-full border-2"
              style={{ borderColor: s.ok ? (ai ? "var(--color-seal)" : "var(--color-jade)") : "var(--color-ink-faint)", background: "var(--color-card)" }}
            />
            <span className={`mr-2 inline-block min-w-[4.5rem] font-mono text-[11.5px] ${ai ? "text-seal" : "text-ink-faint"}`}>{STEP_SOURCE[s.action]}</span>
            {s.reason && <span className="mr-1.5 font-kai text-[14px] text-ink-faint">「{s.reason}」</span>}
            {s.detail}
            {s.action !== "agent_note" && <span className="ml-2 font-mono text-[11.5px] text-ink-faint tabular">{s.ms ? `${s.ms}ms` : "缓存"}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export interface AgentRunState {
  status: "running" | "failed";
  steps: CheckStep[];
  error?: string;
}

/** AI 检索：运行中实时显示每一步；结束后结论卡片换成规则复核的新结果 */
function AgentPanel({ state, onRun }: { state?: AgentRunState; onRun?: () => void }) {
  if (!state) return null;
  if (state.status === "failed") {
    return (
      <div role="alert" className="enter mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-seal/25 bg-seal/5 px-4 py-2.5 text-[13.5px] text-seal">
        <span>AI 检索未完成：{state.error ?? "请稍后重试"}</span>
        {onRun && (
          <button type="button" onClick={onRun} className="underline decoration-dotted underline-offset-4 hover:text-seal-deep">
            重试
          </button>
        )}
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" className="enter mt-3 rounded-xl border border-seal/20 bg-seal/[0.035] px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-seal">
        <IconSpark className="text-[14px]" />
        AI 检索中 · 模型规划检索，结论由规则复核
      </p>
      {state.steps.length > 0 && <Steps steps={state.steps} />}
      <p className="mt-2 font-kai text-[14.5px] text-ink-faint">
        {state.steps.length ? "正在规划下一步" : "正在读取核查记录、规划检索"}
        <span className="animate-blink">▍</span>
      </p>
    </div>
  );
}

function AgentOutcome({ agent }: { agent: AgentTrace }) {
  const confirmed = agent.outcome === "confirmed";
  const text = agentSummary(agent);
  return (
    <p className="mt-2 flex items-start gap-2 text-[13px] leading-6" style={{ color: confirmed ? "var(--color-jade)" : "var(--color-ink-faint)" }}>
      <span aria-hidden className="mt-[3px] shrink-0 rounded border border-current px-1 font-mono text-[10.5px] leading-4">AI</span>
      <span>
        {text}
        {confirmed && <span className="text-ink-faint">（追查前：{agent.before.summary}）</span>}
      </span>
    </p>
  );
}

export function ResultCard({
  refItem,
  result,
  stopped = false,
  agent,
  order = 0,
}: {
  refItem: ParsedRef;
  result?: RefResult;
  stopped?: boolean;
  /** onRun 只在该条可以交给 AI 检索时提供 */
  agent?: { state?: AgentRunState; onRun?: () => void };
  /** 列表里的位置，用来错开入场 */
  order?: number;
}) {
  const verdict = result?.verdict;
  // 相近候选也默认展开：要对照比对表才能判断是不是同一篇
  const problem = verdict === "mismatch" || verdict === "near_match" || verdict === "not_found" || verdict === "retracted" || verdict === "concern";
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? problem;
  const meta = verdict ? VERDICT_META[verdict] : undefined;

  return (
    <article
      className="card enter relative overflow-hidden transition-shadow duration-500 hover:shadow-[0_1px_0_rgb(255_255_255/0.85)_inset,0_22px_44px_-26px_rgb(40_28_14/0.38)]"
      style={{ "--d": `${Math.min(order, 12) * 35}ms` } as CSSProperties}
      aria-busy={!result && !stopped}
    >
      {/* 左侧结论色条：出结论时由浅变成结论色 */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 transition-colors duration-700" style={{ background: meta?.color ?? "var(--color-hair)" }} />

      <div className="grid gap-x-5 gap-y-2.5 p-4 pl-5 sm:grid-cols-[6.25rem_minmax(0,1fr)] sm:p-5 sm:pl-6">
        <div className="flex items-center gap-2.5 sm:flex-col sm:items-start sm:gap-2 sm:pt-0.5">
          <span className="font-mono text-[12px] text-ink-faint tabular">{String(refItem.index).padStart(2, "0")}</span>
          {verdict ? <Stamp verdict={verdict} /> : stopped ? <Stamp verdict="error" /> : <PendingStamp />}
        </div>

        <div className="min-w-0">
          <p className="break-words font-serif text-[15px] leading-7 text-ink">{refItem.raw}</p>

          {result ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p data-summary className="text-[14px] font-semibold leading-6" style={{ color: meta?.color }}>
                {result.summary}
              </p>
              {result.match?.source === "web" && result.match.url && /^https?:\/\//i.test(result.match.url) && (
                <a
                  href={result.match.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="AI 检索在中文学术网站找到的论文页，可打开核对作者、刊名和年期"
                  className="inline-flex min-h-7 items-center text-[12.5px] text-ink-faint underline decoration-dotted underline-offset-4 hover:text-seal"
                >
                  打开{result.match.site ?? "来源"}页面
                </a>
              )}
              <span className="ml-auto flex items-center gap-1">
                {agent?.onRun && !agent.state && (
                  <button
                    type="button"
                    onClick={agent.onRun}
                    onPointerDown={(e) => inkDrop(e, "rgb(184 50 42 / 0.2)")}
                    title="由 DeepSeek 规划检索策略并调用数据库工具，找到的候选仍由规则逐字段比对"
                    className="ink inline-flex h-8 items-center gap-1.5 rounded-full border border-seal/40 px-3 text-[13px] text-seal transition hover:border-seal hover:bg-seal/5 focus-visible:outline-2 focus-visible:outline-seal"
                  >
                    <IconSpark className="text-[14px]" />
                    AI 继续查
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(!expanded)}
                  aria-expanded={expanded}
                  className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] text-ink-soft transition hover:bg-paper-deep/80 hover:text-ink focus-visible:outline-2 focus-visible:outline-seal"
                >
                  {expanded ? "收起" : "详情"}
                  <IconChevron className={`text-[14px] transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
                </button>
              </span>
            </div>
          ) : (
            <p className="mt-2 text-[13.5px] text-ink-faint">
              {stopped ? "本条尚未完成核查，请重新提交；不能据此判断文献是否存在。" : <>正在查询 DOI 注册、比对元数据、检查撤稿记录<span className="animate-blink">▍</span></>}
            </p>
          )}

          {result?.agent && !agent?.state && <AgentOutcome agent={result.agent} />}
          <AgentPanel state={agent?.state} onRun={agent?.onRun} />

          {result && (
            // 收起时内容仍在页面里（为了平滑展开），用 inert 让读屏和键盘跳过
            <div className="collapsible" data-open={expanded} inert={!expanded}>
              <div>
                <div className="mt-4 space-y-4 border-t border-hair pt-4">
                  {result.issues.length > 0 && (
                    <ul className="space-y-1.5">
                      {result.issues.map((issue, i) => (
                        <li key={i} className="flex gap-2.5 text-[14px] leading-6 text-seal">
                          <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-seal" />
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {result.notes.length > 0 && (
                    <ul className="space-y-1">
                      {result.notes.map((note, i) => (
                        <li key={i} className="text-[13px] leading-6 text-ink-faint">
                          注：{note}
                        </li>
                      ))}
                    </ul>
                  )}
                  {result.fields.length > 0 && <FieldTable fields={result.fields} aiFields={result.parsed.aiFields} />}
                  {result.suggestion && <Suggestion text={result.suggestion} candidate={result.matchStatus === "candidate"} />}
                  {result.steps.length > 0 && (
                    <div>
                      <p className="mb-2 text-[12.5px] text-ink-faint">
                        核查过程 · 共 {result.steps.length} 步
                        {result.confidence > 0 && (
                          <span title="基于匹配规则的参考指标，并非经过统计校准的正确概率" className="ml-2 font-mono tabular">
                            · 匹配参考值 {Math.round(result.confidence * 100)}%
                          </span>
                        )}
                      </p>
                      <Steps steps={result.steps} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {!result && !stopped && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="h-full w-1/3 animate-scan bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        </div>
      )}
    </article>
  );
}
