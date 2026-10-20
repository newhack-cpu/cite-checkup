"use client";

import { useState } from "react";
import { healthScore, VERDICT_META, VERDICT_ORDER } from "@/lib/verdict-meta";
import { buildFixedList, buildReportMarkdown } from "@/lib/report";
import { localDate, reportHtml, saveFile } from "@/lib/report-html";
import type { ParsedRef, RefResult, Verdict } from "@/lib/verify/types";
import { Stamp } from "./seal";

export type Filter = "all" | Verdict;

export function ReportSummary({
  refs,
  results,
  running,
  complete,
  elapsedMs,
  filter,
  onFilter,
}: {
  refs: ParsedRef[];
  results: Map<number, RefResult>;
  running: boolean;
  complete: boolean;
  elapsedMs: number;
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const counts: Partial<Record<Verdict, number>> = {};
  for (const r of results.values()) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  const done = results.size;
  const total = refs.length;
  const finished = complete && done === total && !counts.error;
  const score = finished ? healthScore(counts) : undefined;
  const scoreColor =
    score === undefined ? "var(--color-ink-faint)" : score >= 85 ? "var(--color-jade)" : score >= 60 ? "var(--color-amber)" : "var(--color-seal)";
  const flagged = (counts.not_found ?? 0) + (counts.retracted ?? 0) + (counts.concern ?? 0) + (counts.mismatch ?? 0);
  // 相近候选没有确认哪里写错，不算"需要处理"，单独提示人工核对
  const near = counts.near_match ?? 0;

  // 默认给可直接打开、打印的网页；需要纯文本的另给 Markdown
  function download(format: "html" | "md") {
    const markdown = buildReportMarkdown(refs, results, complete);
    const name = `引用体检报告-${localDate()}`;
    if (format === "md") saveFile(markdown, "text/markdown;charset=utf-8", `${name}.md`);
    else saveFile(reportHtml(markdown, "引用体检报告"), "text/html;charset=utf-8", `${name}.html`);
  }

  return (
    <section data-tour="summary" className="sheet animate-rise rounded-sm border border-rule/80 p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[12px] tracking-[0.4em] text-ink-faint">体 检 报 告</p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-serif text-[15px] font-bold text-ink-soft">已核验条目健康度</span>
            <span className="font-serif text-6xl font-black leading-none tabular transition-colors" style={{ color: scoreColor }}>
              {score ?? "—"}
            </span>
            <span className="font-serif text-lg text-ink-faint">/ 100</span>
          </div>
          <p className="mt-3 text-[13.5px] text-ink-soft">
            {running ? "正在核查" : finished ? "已完成" : "核查未完成"} <span className="font-mono tabular">{done}</span> / <span className="font-mono tabular">{total}</span> 条
            <span className="mx-2 text-rule">|</span>用时 <span className="font-mono tabular">{(elapsedMs / 1000).toFixed(1)}</span> 秒
            {!running && flagged > 0 && (
              <>
                <span className="mx-2 text-rule">|</span>
                <span className="whitespace-nowrap text-seal">发现 {flagged} 条需要处理</span>
              </>
            )}
            {!running && near > 0 && (
              <>
                <span className="mx-2 text-rule">|</span>
                <span className="whitespace-nowrap" style={{ color: VERDICT_META.near_match.color }}>{near} 条相近候选待核对</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!finished}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildFixedList(refs, results));
              setCopyError(false);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch { setCopyError(true); }
          }}
          className="rounded-sm border border-ink/25 px-4 py-2 text-[14px] text-ink transition hover:border-seal hover:text-seal disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-seal"
          title="已确认同一篇的有误条目使用数据库规范写法；相近候选保留原文并提示人工确认"
        >
          {copied ? "已复制到剪贴板" : "复制修正版清单"}
        </button>
        <button type="button" onClick={() => download("html")} disabled={running} title="网页格式，双击用浏览器打开，可直接打印或另存为 PDF" className="rounded-sm border border-ink/25 px-4 py-2 text-[14px] text-ink hover:border-seal hover:text-seal disabled:opacity-40">下载核查报告</button>
        <button type="button" onClick={() => download("md")} disabled={running} className="self-center px-1 py-1 text-[12.5px] text-ink-faint underline decoration-dotted underline-offset-4 hover:text-seal disabled:opacity-40">Markdown 版</button>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] leading-6 text-ink-faint">健康度只计算有明确结论的条目；相近候选、待人工与关注声明不计入分母。{!finished && "本次核查未全部完成，暂不显示健康度或提供修正版清单。"}</p>
      {copyError && <p role="alert" className="mt-2 text-sm text-seal">浏览器未允许复制，请下载核查报告。</p>}

      {/* 墨条：各结论占比，未完成部分用斜线表示 */}
      <div className="mt-6 flex h-3 w-full overflow-hidden rounded-[2px] bg-paper-deep" role="img" aria-label="结论分布">
        {VERDICT_ORDER.map((v) =>
          counts[v] ? (
            <div
              key={v}
              className="h-full transition-[width] duration-500 ease-out"
              style={{ width: `${(100 * (counts[v] ?? 0)) / total}%`, background: VERDICT_META[v].color }}
              title={`${VERDICT_META[v].label} ${counts[v]}`}
            />
          ) : null,
        )}
        {done < total && (
          <div
            className="h-full flex-1"
            style={{ background: "repeating-linear-gradient(-45deg, transparent 0 5px, rgb(29 26 22 / 0.12) 5px 6px)" }}
          />
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="按结论筛选">
        <FilterChip active={filter === "all"} onClick={() => onFilter("all")}>
          全部 <span className="font-mono tabular">{total}</span>
        </FilterChip>
        {VERDICT_ORDER.filter((v) => counts[v]).map((v) => (
          <FilterChip key={v} active={filter === v} onClick={() => onFilter(v)} color={VERDICT_META[v].color}>
            <Stamp verdict={v} size="sm" still />
            <span className="font-mono tabular">{counts[v]}</span>
          </FilterChip>
        ))}
      </div>
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13.5px] transition focus-visible:outline-2 focus-visible:outline-seal ${
        active ? (color ? "text-ink" : "border-ink bg-ink text-card") : "border-ink/20 text-ink-soft hover:border-ink/50"
      }`}
      style={active && color ? { borderColor: color, background: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}
    >
      {children}
    </button>
  );
}
