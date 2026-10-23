"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { inkDrop, scrollBehavior, useCountUp } from "@/lib/motion";
import { RUN_STARTED, TRY_SAMPLE } from "@/lib/onboarding";
import { SAMPLE_REFERENCES } from "@/lib/samples";
import { VERDICT_META } from "@/lib/verdict-meta";
import { notReference, parseReferenceList } from "@/lib/verify/extract";
import { agentEligible, readAgentStream } from "@/lib/agent-stream";
import { readCheckStream } from "@/lib/check-stream";
import type { CheckEvent, ParsedRef, RefKind, RefResult, Verdict } from "@/lib/verify/types";
import { ATTENTION, ReportSummary, type Filter } from "./report-summary";
import { ResultCard, type AgentRunState } from "./result-card";
import { Stamp } from "./seal";
import { DocumentImport } from "./document-import";
import { IconArrow, IconCheck, IconChevron, IconShield, IconSpark, IconStop } from "./icons";

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
  presentation: "会议报告",
  archive: "档案手稿",
  software: "软件",
  preprint: "预印本",
  unknown: "其他",
};

const MAX_REFS = 80;
const CHECKS = ["DOI 是否注册", "题名、作者、年份、期刊是否一致", "是否撤稿"];
/** 配置了 DeepSeek 密钥才会用它的搜索接口做中文期刊联网核查，没有就不列 */
const CN_CHECK = "中文期刊到知网、万方、维普核对";
/** 图例只放常见的六种；关注声明和出错很少见，出现时在结果里有说明 */
const LEGEND: Verdict[] = ["verified", "mismatch", "near_match", "not_found", "retracted", "unverifiable"];
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;
const PLACEHOLDER = "[1] 作者. 题名[J]. 刊名, 年, 卷(期): 页码.\n[2] Author, A. (2023). Title. Journal, 12(3), 45–67.\n\n每条一行，或用 [1]、1. 这类序号分隔；支持 GB/T 7714、APA、IEEE 等格式，只贴 DOI 也行";
const noSubscribe = () => () => {};

export function Checker() {
  // 服务端渲染和水合时为 false，脚本接管后为 true。慢网络（如魔搭）下页面先出现、脚本后到：
  // 这段时间粘贴的文字会在水合时被清空，“载入示例”也点不动（10-19 实测）。所以接管前先禁用输入并提示加载中
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
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
  const phaseRef = useRef<Phase>("idle");
  const [sampleRequest, setSampleRequest] = useState(0);
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
  // 像正文段落而不像参考文献的条目序号（只提醒，不拦截）
  const prose = useMemo(() => detected.filter(notReference).map((r) => r.index), [detected]);

  // 页面上的“开始体检”是否在屏幕里；不在时手机底部显示一个
  const startRef = useRef<HTMLButtonElement>(null);
  const [startVisible, setStartVisible] = useState(true);
  useEffect(() => {
    const el = startRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStartVisible(entry.isIntersecting), { threshold: 0.6 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 新手引导最后一步“载入示例并开始体检”：先填入示例，等这次渲染拿到新文本再开始（run 提交的是当次渲染的 text）
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    const onTry = () => {
      if (phaseRef.current === "running") return;
      setText(SAMPLE_REFERENCES);
      setSampleRequest((n) => n + 1);
    };
    window.addEventListener(TRY_SAMPLE, onTry);
    return () => window.removeEventListener(TRY_SAMPLE, onTry);
  }, []);
  useEffect(() => {
    if (sampleRequest > 0) void run();
    // 每收到一次示例请求只开始一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleRequest]);

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
    window.dispatchEvent(new Event(RUN_STARTED));
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
    requestAnimationFrame(() => reportRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }));

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

  const visible = filter === "all" ? refs : refs.filter((r) => {
    const verdict = results.get(r.index)?.verdict;
    return filter === "attention" ? !!verdict && ATTENTION.includes(verdict) : verdict === filter;
  });
  const tooMany = detected.length > MAX_REFS;
  const canRun = detected.length > 0 && !tooMany && phase !== "running";
  const running = phase === "running";
  const done = results.size;
  const total = refs.length;
  const count = useCountUp(detected.length);

  return (
    <div>
      <div className="mb-6 max-w-3xl md:mb-8">
        <h2 className="reveal font-serif text-[28px] font-bold leading-tight tracking-[0.02em] sm:text-[36px]" style={delay(160)}>
          参考文献，逐条体检
        </h2>
        <p className="reveal mt-3 text-[15px] leading-7 text-ink-soft sm:text-[16px]" style={delay(220)}>
          粘贴论文末尾的参考文献列表，逐条查 DOI 是否注册、信息是否一致、有没有撤稿；数据库查不到的，再交给 AI 继续查。
        </p>
      </div>

      {/* 输入卡：上面是输入框，下面一行工具条 */}
      <section className="card reveal overflow-hidden transition-[border-color,box-shadow] duration-300 focus-within:border-seal/45 focus-within:shadow-[0_0_0_4px_rgb(184_50_42/0.08),0_18px_40px_-26px_rgb(40_28_14/0.28)]" style={delay(280)}>
        <label htmlFor="refs" className="sr-only">
          参考文献列表
        </label>
        <textarea
          id="refs"
          data-tour="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl / ⌘ + Enter 直接开始体检，不用再去找按钮
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canRun) {
              e.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          disabled={!hydrated || running}
          placeholder={hydrated ? PLACEHOLDER : "页面还在加载，稍候即可粘贴参考文献…"}
          className="autogrow block max-h-[20rem] min-h-[11.5rem] w-full resize-y bg-transparent px-5 py-4 font-serif text-[15px] leading-[1.85] text-ink outline-none placeholder:text-ink-faint/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-seal/25 sm:min-h-[13rem] sm:px-6 sm:py-5"
        />
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-hair px-2.5 py-2.5 sm:px-3.5">
          <button
            type="button"
            onClick={() => setText(SAMPLE_REFERENCES)}
            disabled={!hydrated || running}
            data-tour="sample"
            title="填入 11 条示例：含真实、写错、编造和已撤稿的文献"
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-seal transition hover:bg-seal/8 focus-visible:outline-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-45"
          >
            <IconSpark className="text-[16px]" />
            载入示例
          </button>
          <DocumentImport onImport={setText} disabled={!hydrated || running} purpose="references" pasteTargetId="refs" tourId="import" />
          <span aria-hidden className="mx-1.5 hidden h-5 w-px bg-rule sm:block" />
          <span title={kindSummary || undefined} className={`min-w-0 px-1.5 text-[13px] ${tooMany ? "text-seal" : "text-ink-soft"}`}>
            识别到 <b className="font-semibold tabular text-ink">{count}</b> 条
            {tooMany && `（单次最多 ${MAX_REFS} 条）`}
          </span>
          <span className="ml-auto flex items-center gap-1 max-sm:w-full">
            <button
              type="button"
              role="switch"
              aria-checked={mode === "ai"}
              onClick={() => setMode(mode === "ai" ? "standard" : "ai")}
              disabled={!hydrated || running}
              title="规则没解析出题名的条目交给 DeepSeek 从原文摘取字段；结论仍由数据库核验"
              className="inline-flex h-9 items-center gap-2 rounded-full px-2.5 text-[13px] text-ink-soft transition hover:bg-paper-deep/80 focus-visible:outline-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span aria-hidden className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-300 ${mode === "ai" ? "bg-seal" : "bg-ink/20"}`}>
                <span className={`absolute left-[2px] top-[2px] size-[14px] rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring ${mode === "ai" ? "translate-x-[14px]" : ""}`} />
              </span>
              AI 辅助解析
            </button>
            {text && !running && (
              <button type="button" onClick={() => setText("")} className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-ink-soft transition hover:bg-paper-deep/80 hover:text-ink">
                清空
              </button>
            )}
            {running && (
              <button type="button" onClick={() => abortRef.current?.abort()} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] text-ink-soft transition hover:bg-paper-deep/80 hover:text-seal">
                <IconStop className="text-[15px]" />
                停止
              </button>
            )}
            <button
              ref={startRef}
              type="button"
              data-tour="start"
              onClick={run}
              onPointerDown={(e) => {
                if (canRun) inkDrop(e);
              }}
              disabled={!canRun}
              className={`ink group ml-1 inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-semibold tracking-[0.06em] transition duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal max-sm:ml-auto max-sm:flex-1 ${
                running ? "cursor-progress bg-seal text-card" : canRun ? "bg-seal text-card shadow-[0_10px_24px_-12px_rgb(184_50_42/0.85)] hover:-translate-y-px hover:bg-seal-deep" : "cursor-not-allowed bg-ink/10 text-ink-faint"
              }`}
            >
              {running ? (
                <>
                  <span aria-hidden className="progress-fill absolute inset-y-0 left-0 -z-10 bg-white/20" style={{ width: total ? `${(100 * done) / total}%` : "8%" }} />
                  <span aria-hidden className="progress-sheen absolute inset-0 -z-10" />
                  体检中 <span className="tabular">{total ? `${done} / ${total}` : "…"}</span>
                </>
              ) : (
                <>
                  开始体检
                  <IconArrow className="text-[15px] transition-transform duration-300 group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </span>
        </div>
        {(mode === "ai" || (prose.length > 0 && !tooMany)) && (
          <div className="space-y-2 border-t border-hair px-5 py-3 sm:px-6">
            {mode === "ai" && (
              <p className="text-[12.5px] leading-6 text-ink-faint">
                {aiStatus?.available ? "AI 辅助解析：规则没解析出题名的条目交给 DeepSeek 从原文摘取字段，逐条核对确是原文片段；其余条目不发送，结论仍由数据库核验。" : "AI 服务尚未就绪，本次将明确回退标准核验。"}
              </p>
            )}
            {prose.length > 0 && !tooMany && (
              <p role="status" className="text-[13px] leading-6 text-amber">
                {prose.length === detected.length && detected.length === 1 ? "这段文字" : `第 ${prose.join("、")} 条`}看起来不像参考文献（没有年份、出处或 DOI），像是正文段落。请确认粘贴的是参考文献列表。
              </p>
            )}
          </div>
        )}
      </section>

      {/* 会查什么、结论印章、隐私：一眼扫过，不用读长段说明 */}
      <div className="reveal mt-4 space-y-3 px-1" style={delay(360)}>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-soft">
          {(aiStatus?.available ? [...CHECKS.slice(0, 2), CN_CHECK, ...CHECKS.slice(2)] : CHECKS).map((check) => (
            <li key={check} className="inline-flex items-center gap-1.5">
              <IconCheck className="text-[14px] text-jade" />
              {check}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <IconSpark className="text-[14px] text-seal" />
            查不到的交给 AI 继续查
          </li>
        </ul>
        <div data-tour="legend" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12.5px] text-ink-faint">结论印章</span>
          {LEGEND.map((verdict) => (
            <span key={verdict} title={VERDICT_META[verdict].hint} className="inline-flex">
              <Stamp verdict={verdict} size="sm" still />
            </span>
          ))}
        </div>
        <details className="group text-[12.5px] leading-6 text-ink-faint">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full py-1 transition hover:text-ink-soft [&::-webkit-details-marker]:hidden">
            <IconShield className="text-[14px]" />
            只发送参考文献条目，不上传论文正文
            <IconChevron className="text-[13px] transition-transform duration-300 group-open:rotate-180" />
          </summary>
          <p className="mt-1 max-w-3xl">
            {mode === "ai" ? "AI 辅助模式会把规则没解析出题名的参考文献条目发送给 DeepSeek 解析，再查询公开数据库。请勿粘贴未公开论文正文或敏感信息。" : aiStatus?.available ? "只把参考文献条目发送给 Crossref、OpenAlex、doi.org 检索；中文期刊论文的题名还会发给 DeepSeek 的搜索接口，并读取知网和期刊官网的论文页。不上传论文正文。" : "只把参考文献条目发送给 Crossref、OpenAlex、doi.org 检索，不上传论文正文。"}
            {agentAvailable && "点击「AI 继续查」时，该条引文会发送给 DeepSeek 规划检索，并用 DeepSeek 联网搜索查询知网、万方、维普的论文页，以及 DataCite 等数据源。"}查不到不等于一定是编造，结果供人工复核参考。
          </p>
        </details>
      </div>

      {/* 体检报告 */}
      <div ref={reportRef} className="mt-10 min-w-0 scroll-mt-24 space-y-3">
        {running && <p role="status" aria-live="polite" className="enter rounded-xl border border-rule bg-card px-5 py-3 text-[14px] text-ink-soft">{progress || "正在逐条核验…"}</p>}
        {notices.map((notice, i) => <p key={i} role="status" className="rounded-xl border border-amber/30 bg-amber/5 px-5 py-3 text-[14px] leading-6 text-ink-soft">{notice}</p>)}
        {error && (
          <div role="alert" className="enter rounded-xl border border-seal/30 bg-seal/5 px-5 py-3 text-[14px] text-seal">
            {error}
          </div>
        )}
        {refs.length > 0 && (
          <>
            <ReportSummary refs={refs} results={results} running={running} complete={phase === "done"} elapsedMs={elapsedMs} filter={filter} onFilter={setFilter} />
            <div className="space-y-3">
              {visible.map((r, i) => {
                const result = results.get(r.index);
                const state = agentRuns.get(r.index);
                const canRunAgent = agentAvailable && !running && !!result && !result.agent && agentEligible(result) && state?.status !== "running";
                return (
                  <ResultCard
                    key={`${runId}-${r.index}`}
                    order={i}
                    refItem={r}
                    result={result}
                    stopped={phase === "interrupted"}
                    agent={{ state, onRun: canRunAgent ? () => void runAgent(r) : undefined }}
                  />
                );
              })}
              {visible.length === 0 && <p className="py-10 text-center text-[14px] text-ink-faint">这一类暂时没有条目</p>}
            </div>
          </>
        )}
      </div>

      {/* 手机上贴完列表，开始按钮可能在屏幕外：在底部补一个，页面上的按钮露出来就收起。
          挂到 body 上：外层区块的入场动画留下 transform，fixed 会变成相对区块定位。首屏渲染时输入为空，不会进服务端渲染 */}
      {canRun && refs.length === 0 && !startVisible && typeof document !== "undefined" && createPortal(
        <div className="enter fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/85 px-4 py-3 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={run}
            onPointerDown={(e) => inkDrop(e)}
            className="ink w-full rounded-full bg-seal px-4 py-3 text-[15px] font-semibold tracking-[0.08em] text-card shadow-[0_10px_24px_-12px_rgb(184_50_42/0.85)]"
          >
            开始体检（{detected.length} 条）
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
