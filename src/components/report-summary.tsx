"use client";

import { useState, type ReactNode } from "react";
import { inkDrop, useCountUp, useGlide } from "@/lib/motion";
import { buildFixedList, buildReportMarkdown } from "@/lib/report";
import { localDate, reportHtml, saveFile } from "@/lib/report-html";
import { VERDICT_META, VERDICT_ORDER } from "@/lib/verdict-meta";
import type { ParsedRef, RefResult, Verdict } from "@/lib/verify/types";
import { IconCheck, IconCopy, IconDownload } from "./icons";

export type Filter = "all" | "attention" | Verdict;
/** 需要处理：确认有问题的条目。相近候选没有确认哪里写错，不算在内，单独提示人工核对 */
export const ATTENTION: Verdict[] = ["not_found", "retracted", "concern", "mismatch"];

const ghost =
  "ink inline-flex h-9 items-center gap-1.5 rounded-full border border-rule bg-card px-3.5 text-[13.5px] text-ink transition hover:border-ink/30 hover:bg-paper/60 focus-visible:outline-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-40";

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
  const flagged = ATTENTION.reduce((sum, v) => sum + (counts[v] ?? 0), 0);
  const near = counts.near_match ?? 0;
  const verified = counts.verified ?? 0;

  // 主数字直接说结果：进行中是已出结论的条数，完成后有问题就是“需要处理”的条数，没有问题就是已核实的条数
  const headline = running || !complete
    ? { value: done, label: `/ ${total} 条已出结论`, color: "var(--color-ink)" }
    : flagged > 0
      ? { value: flagged, label: "条需要处理", color: "var(--color-seal)" }
      : { value: verified, label: verified === total ? "条全部核实" : "条已核实", color: "var(--color-jade)" };
  const shown = useCountUp(headline.value);
  const [glideRef, pillRef] = useGlide<HTMLDivElement>();
  const activeColor = filter === "all" ? "var(--color-ink)" : filter === "attention" ? "var(--color-seal)" : VERDICT_META[filter].color;

  // 默认给可直接打开、打印的网页；需要纯文本的另给 Markdown
  function download(format: "html" | "md") {
    const markdown = buildReportMarkdown(refs, results, complete);
    const name = `引用体检报告-${localDate()}`;
    if (format === "md") saveFile(markdown, "text/markdown;charset=utf-8", `${name}.md`);
    else saveFile(reportHtml(markdown, "引用体检报告"), "text/html;charset=utf-8", `${name}.html`);
  }

  return (
    <>
      <section data-tour="summary" className="card enter p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="text-[13px] text-ink-faint">{running ? "正在核查" : finished ? "体检完成" : complete ? "核查完成，有条目没出结论" : "核查未完成"}</p>
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
              <span className="font-serif text-[44px] font-bold leading-none tabular transition-colors duration-500" style={{ color: headline.color }}>
                {shown}
              </span>
              <span className="text-[15px] text-ink-soft">{headline.label}</span>
              {!running && complete && flagged > 0 && <span className="text-[14px] text-ink-faint">· 共 {total} 条</span>}
            </p>
            <p className="mt-2.5 text-[13px] text-ink-faint">
              已完成 <span className="font-semibold tabular text-ink-soft">{done}</span> / {total} 条 · 用时 <span className="tabular">{(elapsedMs / 1000).toFixed(1)}</span> 秒
              {!running && near > 0 && <span style={{ color: VERDICT_META.near_match.color }}> · {near} 条相近候选待人工核对</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!finished}
              onPointerDown={(e) => inkDrop(e, "rgb(184 50 42 / 0.18)")}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(buildFixedList(refs, results));
                  setCopyError(false);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                } catch {
                  setCopyError(true);
                }
              }}
              className={ghost}
              title="已确认同一篇的有误条目使用数据库规范写法；相近候选保留原文并提示人工确认"
            >
              {copied ? <IconCheck className="text-[15px] text-jade" /> : <IconCopy className="text-[15px]" />}
              {copied ? "已复制到剪贴板" : "复制修正版清单"}
            </button>
            <button type="button" onClick={() => download("html")} onPointerDown={(e) => inkDrop(e, "rgb(184 50 42 / 0.18)")} disabled={running} title="网页格式，双击用浏览器打开，可直接打印或另存为 PDF" className={ghost}>
              <IconDownload className="text-[15px]" />
              下载核查报告
            </button>
            <button type="button" onClick={() => download("md")} disabled={running} className="px-1.5 py-1 text-[12.5px] text-ink-faint underline decoration-dotted underline-offset-4 transition hover:text-seal disabled:opacity-40">
              Markdown 版
            </button>
          </div>
        </div>
        {!finished && !running && <p className="mt-3 text-[12.5px] leading-6 text-ink-faint">本次核查未全部完成，暂不提供修正版清单。</p>}
        {copyError && <p role="alert" className="mt-2 text-[13px] text-seal">浏览器未允许复制，请下载核查报告。</p>}

        {/* 各结论占比；还没出结论的部分用斜纹表示 */}
        <div className="mt-6 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-paper-deep" role="img" aria-label="结论分布">
          {VERDICT_ORDER.map((v) =>
            counts[v] ? (
              <div
                key={v}
                className="h-full rounded-full transition-[width] duration-700 ease-expo"
                style={{ width: `${(100 * (counts[v] ?? 0)) / total}%`, background: VERDICT_META[v].color }}
                title={`${VERDICT_META[v].label} ${counts[v]}`}
              />
            ) : null,
          )}
          {done < total && <div className="h-full flex-1" style={{ background: "repeating-linear-gradient(-45deg, transparent 0 5px, rgb(29 26 22 / 0.1) 5px 6px)" }} />}
        </div>
      </section>

      {/* 筛选：滚动时贴在页眉下面，当前项有一块滑动的高亮底 */}
      <div className="sticky z-20 -mx-2 px-2 py-2" style={{ top: "calc(var(--header-h) + 0.25rem)" }}>
        <div ref={glideRef} role="tablist" aria-label="按结论筛选" className="relative flex scroll-px-2 gap-1 overflow-x-auto rounded-[22px] border border-rule bg-card/80 p-1.5 shadow-[0_10px_30px_-24px_rgb(40_28_14/0.5)] backdrop-blur-md [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          <span
            ref={pillRef}
            aria-hidden
            className="glide border"
            style={{ borderColor: `color-mix(in srgb, ${activeColor} 45%, transparent)`, background: `color-mix(in srgb, ${activeColor} 9%, var(--color-card))` }}
          />
          <FilterChip active={filter === "all"} onClick={() => onFilter("all")}>
            全部 <span className="tabular text-ink-soft">{total}</span>
          </FilterChip>
          {flagged > 0 && (
            <FilterChip active={filter === "attention"} onClick={() => onFilter("attention")} color="var(--color-seal)">
              需要处理 <span className="tabular">{flagged}</span>
            </FilterChip>
          )}
          {VERDICT_ORDER.filter((v) => counts[v]).map((v) => (
            <FilterChip key={v} active={filter === v} onClick={() => onFilter(v)} color={VERDICT_META[v].color} dot>
              {VERDICT_META[v].stamp} <span className="tabular text-ink-soft">{counts[v]}</span>
            </FilterChip>
          ))}
        </div>
      </div>
    </>
  );
}

function FilterChip({ active, onClick, color, dot = false, children }: { active: boolean; onClick: () => void; color?: string; dot?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-glide-active={active}
      onClick={(event) => {
        onClick();
        // 手机上筛选横向滑动：点中的一项滚到看得见的位置
        event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }}
      className={`relative z-[1] inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-seal ${active ? "font-semibold" : "text-ink-soft hover:text-ink"}`}
      style={active ? { color: color ?? "var(--color-ink)" } : undefined}
    >
      {dot && <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}
