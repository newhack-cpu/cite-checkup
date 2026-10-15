"use client";

import { useState } from "react";
import { FIELD_LABEL, STEP_SOURCE, VERDICT_META } from "@/lib/verdict-meta";
import type { FieldCheck, ParsedRef, RefResult } from "@/lib/verify/types";
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
function FieldTable({ fields }: { fields: FieldCheck[] }) {
  const row = "grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 @lg:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_5rem]";
  return (
    <div className="@container text-[13.5px]">
      <div className={`${row} hidden border-b border-ink/15 pb-2 text-[12px] tracking-[0.2em] text-ink-faint @lg:grid`}>
        <span>字段</span>
        <span>引用中的写法</span>
        <span>数据库记录</span>
        <span className="text-right">比对</span>
      </div>
      {fields.map((f) => {
        const mark = FIELD_MARK[f.status];
        return (
          <div key={f.field} className={`${row} gap-y-1 border-b border-dashed border-rule py-2.5 leading-6 last:border-0`}>
            <span className="col-start-1 row-start-1 text-ink-soft">{FIELD_LABEL[f.field]}</span>
            <span className="col-start-2 row-start-1 min-w-0 break-words text-ink-soft">
              <span className="mr-1.5 text-[11.5px] text-ink-faint @lg:hidden">引用</span>
              <FieldValue field={f.field} value={f.cited} />
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
    <div className="relative rounded-sm border border-dashed border-ink/25 bg-paper/50 px-4 py-3 pr-20">
      <p className="mb-1 text-[12px] tracking-[0.2em] text-ink-faint">{candidate ? "相近候选的写法 · 确认同一篇后再使用" : "按数据库记录生成的规范写法"}</p>
      <p className="break-words font-serif text-[14px] leading-6 text-ink">{text}</p>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch { setFailed(true); }
        }}
        className="absolute right-3 top-3 rounded-sm border border-ink/20 px-2.5 py-1 text-[12px] text-ink-soft transition hover:border-seal hover:text-seal focus-visible:outline-2 focus-visible:outline-seal"
      >
        {copied ? "已复制" : "复制"}
      </button>
      {failed && <p role="alert" className="mt-2 text-xs text-seal">复制未获允许，请手动选择文字复制。</p>}
    </div>
  );
}

function Steps({ steps }: { steps: RefResult["steps"] }) {
  return (
    <ol className="relative ml-1.5 space-y-2 border-l border-dashed border-ink/20 pl-5">
      {steps.map((s, i) => (
        <li key={i} className="relative text-[13px] leading-6 text-ink-soft">
          <span
            aria-hidden
            className="absolute -left-[25px] top-[9px] size-[9px] rounded-full border-2"
            style={{ borderColor: s.ok ? "var(--color-jade)" : "var(--color-ink-faint)", background: "var(--color-card)" }}
          />
          <span className="mr-2 inline-block min-w-[4.5rem] font-mono text-[11.5px] uppercase tracking-wider text-ink-faint">
            {STEP_SOURCE[s.action]}
          </span>
          {s.detail}
          <span className="ml-2 font-mono text-[11.5px] text-ink-faint tabular">{s.ms ? `${s.ms}ms` : "缓存"}</span>
        </li>
      ))}
    </ol>
  );
}

export function ResultCard({ refItem, result, stopped = false }: { refItem: ParsedRef; result?: RefResult; stopped?: boolean }) {
  const verdict = result?.verdict;
  const problem = verdict === "mismatch" || verdict === "not_found" || verdict === "retracted" || verdict === "concern";
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? problem;
  const meta = verdict ? VERDICT_META[verdict] : undefined;

  return (
    <article
      className="sheet relative grid animate-rise grid-cols-[3rem_1fr] overflow-hidden rounded-sm border border-rule/80 sm:grid-cols-[3.5rem_1fr]"
      aria-busy={!result && !stopped}
    >
      {/* 左侧页边：序号 + 结论色条 */}
      <div className="relative border-r border-dashed border-rule pt-5 text-center">
        <span className="font-serif text-xl font-bold text-ink-faint tabular sm:text-2xl">{String(refItem.index).padStart(2, "0")}</span>
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] transition-colors duration-500"
          style={{ background: meta?.color ?? "transparent" }}
        />
      </div>

      <div className="relative min-w-0 p-4 sm:p-5">
        {/* 印章右浮动，窄屏时正文绕排，不会被挤成一条窄列 */}
        <div className="float-right mb-1 ml-3 pt-1">{verdict ? <Stamp verdict={verdict} /> : stopped ? <Stamp verdict="error" /> : <PendingStamp />}</div>
        <p className="break-words font-serif text-[14.5px] leading-7 text-ink-soft">{refItem.raw}</p>

        {result ? (
          <div className="clear-right mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="font-serif text-[15px] font-bold" style={{ color: meta?.color }}>
              {result.summary}
            </p>
            {result.confidence > 0 && (
              <span title="基于匹配规则的参考指标，并非经过统计校准的正确概率" className="font-mono text-[11.5px] text-ink-faint tabular">匹配参考值 {Math.round(result.confidence * 100)}%</span>
            )}
            <button
              type="button"
              onClick={() => setOpen(!expanded)}
              aria-expanded={expanded}
              className="ml-auto text-[13px] text-ink-faint underline decoration-dotted underline-offset-4 hover:text-seal"
            >
              {expanded ? "收起" : "展开详情"}
            </button>
          </div>
        ) : (
          <p className="clear-right mt-3 text-[14px] text-ink-faint">
            {stopped ? "本条尚未完成核查，请重新提交；不能据此判断文献是否存在。" : <>正在查询 DOI 注册、比对元数据、检查撤稿记录<span className="animate-blink">▍</span></>}
          </p>
        )}

        {result && expanded && (
          <div className="mt-4 space-y-5 border-t border-dashed border-rule pt-4">
            {result.issues.length > 0 && (
              <ul className="space-y-2">
                {result.issues.map((issue, i) => (
                  <li key={i} className="flex gap-2 font-kai text-[16.5px] leading-7 text-seal">
                    <span aria-hidden className="select-none">✎</span>
                    <span className="squiggle">{issue}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.notes.length > 0 && (
              <ul className="space-y-1">
                {result.notes.map((note, i) => (
                  <li key={i} className="font-kai text-[15px] leading-7 text-ink-faint">
                    注：{note}
                  </li>
                ))}
              </ul>
            )}
            {result.fields.length > 0 && <FieldTable fields={result.fields} />}
            {result.suggestion && <Suggestion text={result.suggestion} candidate={result.matchStatus === "candidate"} />}
            {result.steps.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] tracking-[0.2em] text-ink-faint">核查过程 · 共 {result.steps.length} 步</p>
                <Steps steps={result.steps} />
              </div>
            )}
          </div>
        )}
      </div>

      {!result && !stopped && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="h-full w-1/3 animate-scan bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        </div>
      )}
    </article>
  );
}
