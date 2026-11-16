"use client";

import { inkDrop } from "@/lib/motion";
import { IconSpark, IconStop } from "./icons";

/** 每次批量追查最多几条：接口限制每个访客每分钟 6 次 AI 检索 */
export const AGENT_BATCH_SIZE = 6;

export interface AgentBatchState {
  running: boolean;
  /** 这一批要查几条、查完几条 */
  total: number;
  done: number;
  /** 规则复核后确认是同一篇 / 结论不变 / 没查完（网络、限流等） */
  confirmed: number;
  unchanged: number;
  failed: number;
  /** 这一批里 AI 实际发起的检索次数 */
  toolCalls: number;
  /** 正在查的条目序号 */
  current?: number;
  /** 提前结束的原因（用户停止、触发限流） */
  stopped?: string;
}

/**
 * 体检完成后，把数据库没查到或只找到相近候选的条目一次交给 AI 逐条追查。
 * 逐条排队，每条的检索步骤在各自的结果卡上实时显示；这里只显示整批的进度和小结。
 * 结论仍由规则逐字段比对后才更新，这一点在三种状态下都写明。
 */
export function AgentBatch({ eligible, batch, onRun, onStop }: { eligible: number; batch: AgentBatchState | null; onRun: () => void; onStop: () => void }) {
  if (!batch && eligible === 0) return null;
  const next = Math.min(eligible, AGENT_BATCH_SIZE);
  return (
    <section data-tour="agent-batch" aria-label="AI 批量追查" className="enter rounded-2xl border border-seal/20 bg-seal/[0.035] px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <p className="flex min-w-0 flex-1 basis-72 items-start gap-2 text-[13.5px] leading-6 text-ink-soft">
          <IconSpark className="mt-[5px] shrink-0 text-[14px] text-seal" />
          {batch?.running ? (
            <span role="status" aria-live="polite">
              AI 正在追查第 <b className="tabular text-ink">{Math.min(batch.done + 1, batch.total)}</b> / {batch.total} 条
              {batch.current !== undefined && <span className="text-ink-faint">（第 {String(batch.current).padStart(2, "0")} 条，检索步骤显示在它的卡片上）</span>}
              {batch.done > 0 && <span className="text-ink-faint"> · 已确认 {batch.confirmed} 条，结论不变 {batch.unchanged} 条</span>}
            </span>
          ) : batch ? (
            <span role="status">
              AI 追查了 <b className="tabular text-ink">{batch.done}</b> 条，共发起 {batch.toolCalls} 次检索：
              <b className="text-jade">{batch.confirmed} 条找到并由规则确认是同一篇</b>，{batch.unchanged} 条没有找到能确认的记录、结论不变
              {batch.failed > 0 && <>，{batch.failed} 条没查完</>}。
              {batch.stopped && <span className="text-seal">{batch.stopped}</span>}
              {eligible > 0 && <span className="text-ink-faint"> 还有 {eligible} 条可以继续查。</span>}
            </span>
          ) : (
            <span>
              有 <b className="tabular text-ink">{eligible}</b> 条数据库没查到或只找到相近候选。可以交给 AI 换检索策略逐条再查；找到的候选仍由规则逐字段比对，AI 不能改结论。
              {eligible > AGENT_BATCH_SIZE && <span className="text-ink-faint"> 每次最多查 {AGENT_BATCH_SIZE} 条。</span>}
            </span>
          )}
        </p>
        {batch?.running ? (
          <button type="button" onClick={onStop} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] text-ink-soft transition hover:bg-paper-deep/80 hover:text-seal focus-visible:outline-2 focus-visible:outline-seal">
            <IconStop className="text-[15px]" />
            停止追查
          </button>
        ) : eligible > 0 && (
          <button
            type="button"
            onClick={onRun}
            onPointerDown={(e) => inkDrop(e, "rgb(184 50 42 / 0.2)")}
            title="由 DeepSeek 逐条规划检索策略并调用 Crossref、OpenAlex、DataCite 等工具；找到的候选仍由规则逐字段比对"
            className="ink inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-seal/45 bg-card px-3.5 text-[13.5px] font-semibold text-seal transition hover:border-seal hover:bg-seal/5 focus-visible:outline-2 focus-visible:outline-seal"
          >
            <IconSpark className="text-[14px]" />
            {batch ? `继续查 ${next} 条` : `AI 继续查这 ${next} 条`}
          </button>
        )}
      </div>
      {batch?.running && (
        <div aria-hidden className="mt-3 h-1 overflow-hidden rounded-full bg-seal/10">
          <div className="progress-fill h-full rounded-full bg-seal/70" style={{ width: `${Math.max(4, (100 * batch.done) / batch.total)}%` }} />
        </div>
      )}
    </section>
  );
}
