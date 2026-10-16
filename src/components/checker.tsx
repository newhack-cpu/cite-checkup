"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_REFERENCES } from "@/lib/samples";
import { VERDICT_META, VERDICT_ORDER } from "@/lib/verdict-meta";
import { parseReferenceList } from "@/lib/verify/extract";
import { agentEligible, readAgentStream } from "@/lib/agent-stream";
import { readCheckStream } from "@/lib/check-stream";
import type { CheckEvent, ParsedRef, RefKind, RefResult } from "@/lib/verify/types";
import { ReportSummary, type Filter } from "./report-summary";
import { ResultCard, type AgentRunState } from "./result-card";
import { Stamp } from "./seal";
import { DocumentImport } from "./document-import";

type Phase = "idle" | "running" | "done" | "interrupted";

const KIND_LABEL: Record<RefKind, string> = {
  journal: "期刊",
  conference: "会议",
  book: "图书",
  thesis: "学位论文",
  standard: "标准",
  patent: "专利",
  report: "报告",
  newspaper: "报纸",
  web: "网页",
  legal: "法规",
  software: "软件",
  preprint: "预印本",
  unknown: "其他",
};

const MAX_REFS = 80;

export function Checker() {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [refs, setRefs] = useState<ParsedRef[]>([]);
  const [results, setResults] = useState<Map<number, RefResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [runId, setRunId] = useState(0);
  const [mode, setMode] = useState<"standard" | "ai">("standard");
  const [aiStatus, setAiStatus] = useState<{ available: boolean; model: string } | null>(null);
  const [progress, setProgress] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [agentRuns, setAgentRuns] = useState<Map<number, AgentRunState>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const agentAborts = useRef(new Map<number, AbortController>());
  const reportRef = useRef<HTMLDivElement>(null);

  // 输入框里实时识别条目数
  const deferredText = useDeferredValue(text);
  const detected = useMemo(() => parseReferenceList(deferredText), [deferredText]);
  const kindSummary = useMemo(() => {
    const counts = new Map<RefKind, number>();
    for (const r of detected) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(" · ");
  }, [detected]);

  // 计时器
  useEffect(() => {
    if (phase !== "running") return;
    const start = Date.now() - elapsedMs;
    const id = setInterval(() => setElapsedMs(Date.now() - start), 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    const agents = agentAborts.current;
    return () => {
      abortRef.current?.abort();
      for (const controller of agents.values()) controller.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/check", { signal: controller.signal, cache: "no-store" })
      .then(res => res.ok ? res.json() : null)
      .then(status => { if (status && typeof status.available === "boolean") setAiStatus(status); })
      .catch(() => {});
    fetch("/api/agent", { signal: controller.signal, cache: "no-store" })
      .then(res => res.ok ? res.json() : null)
      .then(status => setAgentAvailable(status?.available === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function stopAgents() {
    for (const controller of agentAborts.current.values()) controller.abort();
    agentAborts.current.clear();
    setAgentRuns(new Map());
  }

  /** AI 检索单条：每一步实时显示，结束后用规则复核的新结果替换原结论；失败时原结论不变 */
  async function runAgent(item: ParsedRef) {
    if (agentAborts.current.has(item.index)) return;
    const controller = new AbortController();
    agentAborts.current.set(item.index, controller);
    const update = (state?: AgentRunState) => setAgentRuns(prev => {
      const next = new Map(prev);
      if (state) next.set(item.index, state);
      else next.delete(item.index);
      return next;
    });
    const steps: AgentRunState["steps"] = [];
    update({ status: "running", steps: [] });
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: item.raw, index: item.index }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败（${res.status}）`);
      }
      const result = await readAgentStream(res.body, item.index, event => {
        if (event.type === "step" && agentAborts.current.get(item.index) === controller) {
          steps.push(event.step);
          update({ status: "running", steps: [...steps] });
        }
      });
      if (agentAborts.current.get(item.index) !== controller) return;
      setResults(prev => new Map(prev).set(item.index, result));
      update(undefined);
    } catch (err) {
      if (agentAborts.current.get(item.index) === controller && !controller.signal.aborted) {
        update({ status: "failed", steps, error: (err as Error).message || "网络异常" });
      }
    } finally {
      if (agentAborts.current.get(item.index) === controller) agentAborts.current.delete(item.index);
    }
  }

  async function run() {
    abortRef.current?.abort();
    stopAgents();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNotices([]);
    setProgress(mode === "ai" ? "正在准备 AI 辅助解析…" : "正在提交参考文献…");
    setResults(new Map());
    setRefs([]);
    setFilter("all");
    setElapsedMs(0);
    setRunId((n) => n + 1);
    setPhase("running");
    requestAnimationFrame(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    let completed = false;
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败（${res.status}）`);
      }
      await readCheckStream(res.body, event => {
        if (abortRef.current === controller) handle(event);
      });
      completed = true;
    } catch (err) {
      if (abortRef.current === controller) setError(controller.signal.aborted ? "已停止核查。尚未返回的条目没有结论，可重新开始。" : (err as Error).message || "网络异常，请重试");
    } finally {
      if (abortRef.current === controller) {
        setPhase(completed ? "done" : "interrupted");
        setProgress("");
      }
    }
  }

  function handle(event: CheckEvent) {
    switch (event.type) {
      case "phase":
        setProgress(event.message);
        break;
      case "notice":
        setNotices(prev => [...prev, event.message]);
        break;
      case "meta":
        setRefs(event.refs);
        break;
      case "result":
        setResults((prev) => new Map(prev).set(event.result.index, event.result));
        break;
      case "done":
        setElapsedMs(event.stats.ms);
        break;
      case "fatal":
        setError(event.message);
        break;
    }
  }

  const visible = filter === "all" ? refs : refs.filter((r) => results.get(r.index)?.verdict === filter);
  const tooMany = detected.length > MAX_REFS;
  const canRun = detected.length > 0 && !tooMany && phase !== "running";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(320px,400px)_1fr] lg:gap-10">
      {/* 送检单 */}
      <section className="animate-rise self-start [animation-delay:120ms] lg:sticky lg:top-8">
        <div className="sheet overflow-hidden rounded-sm border border-rule/80">
          <header className="flex items-center justify-between border-b border-dashed border-rule px-5 py-3">
            <h2 className="whitespace-nowrap font-serif text-[17px] font-bold">
              送检单 <span className="ml-1 text-[13px] font-normal text-ink-faint">粘贴参考文献列表</span>
            </h2>
            <span className="hidden whitespace-nowrap font-mono text-[11px] tracking-wider text-ink-faint sm:inline">GB/T 7714 · APA · IEEE</span>
          </header>
          <DocumentImport onImport={setText} disabled={phase === "running"} purpose="references" />
          <fieldset disabled={phase === "running"} className="border-b border-dashed border-rule px-5 py-3">
            <legend className="sr-only">核验模式</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-soft">
              <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="mode" value="standard" checked={mode === "standard"} onChange={() => setMode("standard")} className="accent-seal" />标准核验</label>
              <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="mode" value="ai" checked={mode === "ai"} onChange={() => setMode("ai")} className="accent-seal" />AI 辅助解析</label>
            </div>
            <p className="mt-2 text-[12px] leading-5 text-ink-faint">{mode === "standard" ? "直接检索数据库，不调用大模型。" : aiStatus?.available ? "DeepSeek 提取原文中的字段，数据库负责核验。" : "AI 服务尚未就绪，本次将明确回退标准核验。"}</p>
          </fieldset>
          <label htmlFor="refs" className="sr-only">
            参考文献列表
          </label>
          <textarea
            id="refs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            disabled={phase === "running"}
            placeholder={"[1] 作者. 题名[J]. 刊名, 年, 卷(期): 页码.\n[2] Author, A. (2023). Title. Journal, 12(3), 45–67.\n\n每条一行，或用 [1]、1. 这类序号分隔"}
            className="ruled block h-[16rem] w-full resize-y py-2 pl-[3.4rem] pr-4 font-serif text-[14px] text-ink outline-none placeholder:text-ink-faint/70 focus-visible:bg-white/40 lg:h-[17rem]"
          />
          <footer className="space-y-3 border-t border-dashed border-rule px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px]">
              <span className={tooMany ? "text-seal" : "text-ink-soft"}>
                识别到 <b className="font-mono text-[15px] tabular">{detected.length}</b> 条
                {tooMany && `（单次最多 ${MAX_REFS} 条）`}
              </span>
              {kindSummary && !tooMany && <span className="text-[12.5px] text-ink-faint">{kindSummary}</span>}
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  onClick={() => setText(SAMPLE_REFERENCES)}
                  disabled={phase === "running"}
                  className="rounded-sm px-2 py-1 text-ink-soft underline decoration-dotted underline-offset-4 hover:text-seal"
                >
                  载入示例
                </button>
                <button
                  type="button"
                  onClick={() => setText("")}
                  disabled={!text || phase === "running"}
                  className="rounded-sm px-2 py-1 text-ink-soft underline decoration-dotted underline-offset-4 hover:text-seal disabled:opacity-40"
                >
                  清空
                </button>
              </span>
            </div>
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="group relative w-full overflow-hidden rounded-sm bg-seal px-4 py-3 font-serif text-[17px] font-bold tracking-[0.4em] text-card shadow-[0_2px_0_var(--color-seal-deep)] transition hover:bg-seal-deep active:translate-y-px active:shadow-none disabled:cursor-not-allowed disabled:bg-ink-faint/40 disabled:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
            >
              {phase === "running" ? "体检中…" : "开始体检"}
            </button>
            {phase === "running" && <button type="button" onClick={() => abortRef.current?.abort()} className="w-full py-1 text-sm text-ink-soft underline underline-offset-4">停止核查</button>}
          </footer>
        </div>
        <p className="mt-4 flex gap-2 text-[12.5px] leading-6 text-ink-faint">
          <span aria-hidden>⚿</span>
          {mode === "ai" ? "AI 辅助模式会将参考文献条目发送给 DeepSeek 解析，再查询公开数据库。请勿粘贴未公开论文正文或敏感信息。" : "只把参考文献条目发送给 Crossref、OpenAlex、doi.org 检索，不上传论文正文。"}
          {agentAvailable && "点击「AI 继续查」时，该条引文会发送给 DeepSeek 规划检索，并查询 DataCite 等数据源。"}查不到不等于一定是编造，结果供人工复核参考。
        </p>
      </section>

      {/* 体检报告 */}
      <div ref={reportRef} className="min-w-0 scroll-mt-6 space-y-4">
        {phase === "running" && <p role="status" aria-live="polite" className="rounded-sm border border-rule bg-card px-5 py-3 font-kai text-[16px] text-ink-soft">{progress || "正在逐条核验…"}</p>}
        {notices.map((notice, i) => <p key={i} role="status" className="rounded-sm border border-amber/40 bg-amber/5 px-5 py-3 text-[14px] leading-6 text-ink-soft">{notice}</p>)}
        {error && (
          <div role="alert" className="animate-rise rounded-sm border border-seal/40 bg-seal/5 px-5 py-3 font-kai text-[16px] text-seal">
            ✎ {error}
          </div>
        )}
        {refs.length > 0 ? (
          <>
            <ReportSummary
              refs={refs}
              results={results}
              running={phase === "running"}
              complete={phase === "done"}
              elapsedMs={elapsedMs}
              filter={filter}
              onFilter={setFilter}
            />
            <div className="space-y-3">
              {visible.map((r) => {
                const result = results.get(r.index);
                const state = agentRuns.get(r.index);
                const canRun = agentAvailable && phase !== "running" && !!result && !result.agent && agentEligible(result) && state?.status !== "running";
                return (
                  <ResultCard
                    key={`${runId}-${r.index}`}
                    refItem={r}
                    result={result}
                    stopped={phase === "interrupted"}
                    agent={{ state, onRun: canRun ? () => void runAgent(r) : undefined }}
                  />
                );
              })}
              {visible.length === 0 && <p className="py-10 text-center font-kai text-[16px] text-ink-faint">这一类暂时没有条目</p>}
            </div>
          </>
        ) : (
          <EmptyState waiting={phase === "running"} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ waiting }: { waiting: boolean }) {
  const checks = [
    { n: "壹", title: "DOI 是否真实注册", body: "通过 doi.org 查询，覆盖 Crossref、DataCite、中文 DOI 等所有注册机构。大模型编造的 DOI 在这一步就会露馅。" },
    { n: "贰", title: "题名、作者、年份、期刊是否对得上", body: "用整条引文到 Crossref 检索，必要时用 OpenAlex 兜底，再逐字段比对。真题名配假作者、DOI 张冠李戴都能识别。" },
    { n: "叁", title: "是否已被撤稿", body: "读取 Crossref 中的 Retraction Watch 撤稿数据，提醒你别把已撤稿的研究当论据。" },
    { n: "肆", title: "查不到的，交给 AI 继续查", body: "对无法核验或只找到相近候选的条目，DeepSeek 规划检索策略，换着方式查 Crossref、OpenAlex、DataCite，每一步都摆在你眼前；找到的候选仍由规则逐字段确认。" },
  ];
  return (
    <section className="sheet animate-rise rounded-sm border border-rule/80 p-6 [animation-delay:220ms] sm:p-8">
      <p className="text-[12px] tracking-[0.4em] text-ink-faint">{waiting ? "正 在 送 检" : "尚 未 送 检"}</p>
      <h2 className="mt-2 font-serif text-[26px] font-black leading-snug sm:text-[30px]">三道检查，逐条过关</h2>
      <ol className="mt-6 space-y-5">
        {checks.map((c) => (
          <li key={c.n} className="grid grid-cols-[2.75rem_1fr] gap-4">
            <span className="flex size-11 items-center justify-center rounded-full border-2 border-seal font-serif text-[17px] font-black text-seal">
              {c.n}
            </span>
            <div>
              <h3 className="font-serif text-[17px] font-bold">{c.title}</h3>
              <p className="mt-1 text-[14px] leading-7 text-ink-soft">{c.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 border-t border-dashed border-rule pt-6">
        <p className="mb-4 text-[12px] tracking-[0.3em] text-ink-faint">结论印章说明</p>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {VERDICT_ORDER.filter((v) => v !== "error").map((v) => (
            <div key={v} className="flex items-start gap-3">
              <dt className="w-[5.5rem] shrink-0 pt-0.5">
                <Stamp verdict={v} size="sm" still />
              </dt>
              <dd className="text-[13.5px] leading-6 text-ink-soft">{VERDICT_META[v].hint}</dd>
            </div>
          ))}
        </dl>
      </div>

      <blockquote className="mt-8 border-l-2 border-seal/60 pl-4 font-kai text-[16px] leading-8 text-ink-soft">
        一项发表在 Scientific Reports 的研究发现：GPT-3.5 生成的参考文献中 55% 是编造的，GPT-4 也有 18%。
        <footer className="mt-1 font-serif text-[12.5px] not-italic text-ink-faint">
          —— Walters &amp; Wilder, 2023,{" "}
          <a
            className="font-mono underline decoration-rule underline-offset-4 hover:text-seal"
            href="https://doi.org/10.1038/s41598-023-41032-5"
            target="_blank"
            rel="noreferrer"
          >
            doi:10.1038/s41598-023-41032-5
          </a>
        </footer>
      </blockquote>
    </section>
  );
}
