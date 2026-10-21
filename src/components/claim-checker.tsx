"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClaimResult, ClaimServiceStatus, ClaimVerdict, EvidenceChunk } from "@/lib/claims/types";
import { buildClaimReport, CLAIM_LABELS } from "@/lib/claim-report";
import { inkDrop } from "@/lib/motion";
import { localDate, reportHtml, saveFile } from "@/lib/report-html";
import { DocumentImport } from "./document-import";
import { IconArrow, IconChevron, IconDownload, IconShield, IconStop } from "./icons";

const COLORS: Record<ClaimVerdict, string> = { supported: "var(--color-jade)", partially_supported: "var(--color-amber)", contradicted: "var(--color-seal)", insufficient_evidence: "var(--color-slate)" };
const METHOD_LABEL: Record<ClaimResult["coverage"]["method"], string> = { "hybrid-v1": "混合检索（词面 + 模型扩展检索词 + 模型重排）", "bm25-en-zh-v1": "词面检索", "all-chunks": "材料较短，全部片段参与判断" };
const DEMO_EVIDENCE = "以下为功能演示用的虚构研究片段，不是真实论文。\n\n研究方法：本研究招募了40名大学生，将他们随机分为学习计划组和对照组，各20人。干预持续四周。研究仅测量这40名参与者的课程测验成绩。\n\n研究结果：学习计划组与对照组的平均成绩差异没有达到统计显著性。研究没有观察到学习计划能提高考试成绩的可靠证据。\n\n研究局限：样本规模小，干预时间短，无法将结果推广到所有年龄段的学生，也不能推断长期学习效果。";
const field = "w-full rounded-xl border border-rule bg-card px-3.5 py-2.5 text-[14.5px] leading-7 text-ink outline-none transition focus-visible:border-seal/50 focus-visible:ring-4 focus-visible:ring-seal/10 disabled:opacity-60";
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;
const STEPS = [
  ["一句论断", "每次核查一个能被证据检验的说法，过长的复合结论先拆开。"],
  ["原文出处", "填 DOI 自动读开放全文或摘要，也可以导入、粘贴原文。"],
  ["带引句的判断", "支持、部分支持、矛盾或证据不足；每条引句都能回到原文片段复核。"],
];

export function ClaimChecker() {
  const [claim, setClaim] = useState("");
  const [sourceMode, setSourceMode] = useState<"doi" | "text">("doi");
  const [doi, setDoi] = useState("");
  const [evidence, setEvidence] = useState("");
  const [label, setLabel] = useState("");
  const [service, setService] = useState<ClaimServiceStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const report = useRef<HTMLDivElement>(null);
  const claimLimit = service?.limits.claimChars ?? 2000;
  const evidenceLimit = service?.limits.evidenceChars ?? 160000;
  const tooLong = claim.length > claimLimit || (sourceMode === "text" && evidence.length > evidenceLimit);
  const canCheck = !running && !!claim.trim() && !!(sourceMode === "doi" ? doi.trim() : evidence.trim()) && !tooLong;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/claims", { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(status => { if (status && typeof status.available === "boolean") setService(status); })
      .catch(() => {});
    return () => { controller.abort(); abort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  async function check() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(null); setResult(null); setSeconds(0);
    requestAnimationFrame(() => report.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    try {
      const response = await fetch("/api/claims", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ claim, ...(sourceMode === "doi" ? { doi } : { evidenceText: evidence, evidenceLabel: label || "用户提供的文献文本" }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "请求未完成，请稍后重试");
      if (!["complete", "incomplete"].includes(body.status) || !Array.isArray(body.chunks) || !Array.isArray(body.citations) || !Array.isArray(body.warnings) || !body.coverage || typeof body.explanation !== "string" || (body.verdict !== null && !Object.hasOwn(CLAIM_LABELS, body.verdict))) throw new Error("核查响应不完整，请重试");
      if (!controller.signal.aborted) { setResult(body); setShowEvidence(true); }
    } catch (err) {
      if (abort.current === controller) setError(controller.signal.aborted ? "已停止论断核查，本次没有形成判断。" : err instanceof Error ? err.message : "网络异常，请重试");
    } finally {
      if (abort.current === controller) setRunning(false);
    }
  }

  function example(kind: "doi" | "text") {
    setSourceMode(kind);
    if (kind === "doi") { setDoi("10.1038/s41598-023-41032-5"); setClaim("在该研究样本中，GPT-3.5生成引文的55%为虚构，GPT-4为18%。"); }
    else { setLabel("演示研究片段（虚构）"); setEvidence(DEMO_EVIDENCE); setClaim("这项研究招募了400名大学生。"); }
    setError(null); setResult(null);
  }

  function download() {
    if (!result) return;
    saveFile(reportHtml(buildClaimReport(result), "论断核查报告"), "text/html;charset=utf-8", `论断核查报告-${localDate()}.html`);
  }

  const verdictColor = result && result.status === "complete" && result.verdict ? COLORS[result.verdict] : "var(--color-slate)";

  return (
    <div>
      <div className="mb-6 max-w-3xl md:mb-8">
        <h2 className="reveal font-serif text-[28px] font-bold leading-tight tracking-[0.02em] sm:text-[36px]" style={delay(160)}>这句话，原文支持吗？</h2>
        <p className="reveal mt-3 text-[15px] leading-7 text-ink-soft sm:text-[16px]" style={delay(220)}>输入正文里的一句论断，再给出处：DOI 或原文。系统检索相关片段，判断支持、部分支持、矛盾还是证据不足，并附上原文引句。</p>
      </div>

      <section className="card reveal space-y-4 p-5 sm:p-6" style={delay(280)}>
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label className="text-[14px] font-semibold text-ink" htmlFor="claim-text">正文中的论断</label>
            <span className={`font-mono text-[12px] ${claim.length > claimLimit ? "text-seal" : "text-ink-faint"}`}>{claim.length.toLocaleString()} / {claimLimit.toLocaleString()}</span>
          </div>
          <textarea id="claim-text" value={claim} onChange={event => setClaim(event.target.value)} disabled={running} rows={3} className={`${field} autogrow min-h-[6.5rem] resize-y font-serif`} placeholder="例如：这项研究证明，某种方法能够显著提高学习效果。" />
        </div>

        <fieldset disabled={running} className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">证据来自哪里</legend>
          <span aria-hidden className="text-[14px] font-semibold text-ink">证据来自</span>
          <div className="inline-grid grid-cols-2 rounded-full border border-rule bg-paper-deep/70 p-1 text-[13.5px]">
            {([["doi", "通过 DOI 查原文"], ["text", "提供文献正文"]] as const).map(([value, text]) => (
              <label key={value} className={`cursor-pointer rounded-full px-3.5 py-1.5 text-center transition duration-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-seal ${sourceMode === value ? "bg-card font-semibold text-ink shadow-[0_1px_2px_rgb(40_28_14/0.12)]" : "text-ink-soft hover:text-ink"}`}>
                <input type="radio" name="claim-source" checked={sourceMode === value} onChange={() => setSourceMode(value)} className="sr-only" />
                {text}
              </label>
            ))}
          </div>
        </fieldset>

        {sourceMode === "doi" ? <div className="enter">
          <label htmlFor="claim-doi" className="mb-2 block text-[14px] font-semibold text-ink">文献 DOI</label>
          <input id="claim-doi" value={doi} onChange={event => setDoi(event.target.value)} disabled={running} className={`${field} font-mono`} placeholder="10.1038/s41598-023-41032-5" />
          <p className="mt-2 text-[12.5px] leading-6 text-ink-faint">优先读取 Europe PMC、arXiv 的开放获取全文，取不到再用 Crossref / OpenAlex 摘要；都没有时会提示补充正文，不凭题名推断。</p>
        </div> : <div className="enter space-y-3">
          <div>
            <label htmlFor="evidence-label" className="mb-2 block text-[14px] font-semibold text-ink">来源说明</label>
            <input id="evidence-label" value={label} onChange={event => setLabel(event.target.value)} disabled={running} maxLength={200} className={field} placeholder="文献题名、章节或文件名" />
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="claim-evidence" className="text-[14px] font-semibold text-ink">文献原文</label>
              <span className="flex flex-wrap items-center"><DocumentImport onImport={setEvidence} disabled={running} purpose="evidence" /></span>
            </div>
            <textarea id="claim-evidence" value={evidence} onChange={event => setEvidence(event.target.value)} disabled={running} rows={8} className={`${field} resize-y`} placeholder="粘贴摘要或相关章节，也可以从上方导入文档。" />
            <p className={`mt-1.5 text-[12.5px] leading-6 ${evidence.length > evidenceLimit ? "text-seal" : "text-ink-faint"}`}>{evidence.length.toLocaleString()} / {evidenceLimit.toLocaleString()} 字符 · 请确认来源真实、内容完整。</p>
          </div>
        </div>}
        {tooLong && <p role="alert" className="text-[13px] text-seal">内容超过长度限制，请缩短论断或选择更相关的原文章节。</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-hair pt-4">
          <button type="button" disabled={running} onClick={() => example("doi")} className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-seal transition hover:bg-seal/8 disabled:opacity-45">试用公开文献摘要</button>
          <button type="button" disabled={running} onClick={() => example("text")} className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-seal transition hover:bg-seal/8 disabled:opacity-45">试用矛盾演示材料</button>
          <span className="ml-auto flex items-center gap-1 max-sm:w-full">
            {running && <button type="button" onClick={() => abort.current?.abort()} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] text-ink-soft transition hover:bg-paper-deep/80 hover:text-seal"><IconStop className="text-[15px]" />停止</button>}
            <button
              type="button"
              disabled={!canCheck}
              onClick={check}
              onPointerDown={(e) => { if (canCheck) inkDrop(e); }}
              className={`ink group inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-semibold tracking-[0.06em] transition duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal max-sm:ml-auto max-sm:flex-1 ${running ? "cursor-progress bg-seal text-card" : canCheck ? "bg-seal text-card shadow-[0_10px_24px_-12px_rgb(184_50_42/0.85)] hover:-translate-y-px hover:bg-seal-deep" : "cursor-not-allowed bg-ink/10 text-ink-faint"}`}
            >
              {running ? <><span aria-hidden className="progress-sheen absolute inset-0 -z-10" />正在核查证据…</> : <>核查论断<IconArrow className="text-[15px] transition-transform duration-300 group-hover:translate-x-0.5" /></>}
            </button>
          </span>
        </div>
      </section>
      <p className="reveal mt-3 flex items-start gap-1.5 px-1 text-[12.5px] leading-6 text-ink-faint" style={delay(340)}>
        <IconShield className="mt-[5px] shrink-0 text-[14px]" />
        <span>点击核查后，论断及检索到的原文片段会发送给 DeepSeek。请仅提供你有权处理的文本。{service && !service.available && " 当前 AI 服务未配置，暂时不能生成论断判断。"}</span>
      </p>

      <div ref={report} className="mt-10 min-w-0 scroll-mt-24 space-y-3">
        {running && <div role="status" aria-live="polite" className="card enter p-5 sm:p-6">
          <p className="font-serif text-[18px] font-bold">正在检索证据、比对论断…</p>
          <p className="mt-1.5 text-[13.5px] leading-7 text-ink-faint">只判断本次召回片段能够支持的内容。已用时 {seconds} 秒，可随时停止。</p>
          <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-paper-deep"><div className="progress-sheen absolute inset-0" style={{ background: "linear-gradient(100deg, transparent 20%, rgb(184 50 42 / 0.45) 50%, transparent 80%)" }} /></div>
        </div>}
        {error && <p role="alert" className="enter rounded-xl border border-seal/30 bg-seal/5 px-5 py-4 text-[14px] leading-7 text-seal">{error}</p>}
        {result ? <>
          <section className="card enter overflow-hidden">
            <div className="h-1" style={{ background: verdictColor }} />
            <div className="p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[13px] text-ink-faint">论断核查报告</p>
                  <h2 className="mt-1 font-serif text-[32px] font-bold leading-tight" style={{ color: verdictColor }}>{result.status === "complete" && result.verdict ? CLAIM_LABELS[result.verdict] : "核查未完成"}</h2>
                </div>
                <button type="button" onClick={download} onPointerDown={(e) => inkDrop(e, "rgb(184 50 42 / 0.18)")} title="网页格式，双击用浏览器打开，可直接打印或另存为 PDF" className="ink inline-flex h-9 items-center gap-1.5 rounded-full border border-rule bg-card px-3.5 text-[13.5px] transition hover:border-ink/30"><IconDownload className="text-[15px]" />下载论断报告</button>
              </div>
              <p className="mt-5 border-l-2 border-rule pl-4 font-serif text-[15.5px] leading-8">{result.claim}</p>
              <p className="mt-4 text-[16px] leading-8 text-ink-soft">{result.explanation}</p>
              <div className="mt-5 space-y-0.5 rounded-xl bg-paper/70 px-4 py-3 text-[12.5px] leading-7 text-ink-faint">
                <p>判断范围：{result.source?.scope === "full_text" ? `${result.source.label}，只核查召回的片段` : result.source?.scope === "abstract" ? "仅数据库摘要，未核查全文" : result.source ? "仅用户提供的文本，来源未经独立认证" : "尚未取得可用证据"}</p>
                {result.source && <p className="break-words">来源：{result.source.title || result.source.label}{result.source.doi && <> · <a className="break-all underline" href={`https://doi.org/${encodeURI(result.source.doi)}`} target="_blank" rel="noreferrer">{result.source.doi}</a></>}{result.source.scope === "full_text" && result.source.url && <> · <a className="break-all underline" href={result.source.url} target="_blank" rel="noreferrer">全文</a></>}</p>}
                <p>检索到 {result.coverage.retrievedChunks} / {result.coverage.totalChunks} 个片段，{result.coverage.retrievedChars.toLocaleString()} 字符{METHOD_LABEL[result.coverage.method] ? ` · ${METHOD_LABEL[result.coverage.method]}` : ""}。</p>
                {result.coverage.expansion?.length ? <p className="break-words">扩展检索词：{result.coverage.expansion.join("、")}</p> : null}
              </div>
              {result.warnings.length > 0 && <ul className="mt-4 space-y-1.5 text-[13px] leading-6 text-amber">{result.warnings.map((warning, index) => <li key={index}>注：{warning}</li>)}</ul>}
            </div>
          </section>
          <section className="card enter p-5 sm:p-7" style={delay(80)}>
            <h3 className="font-serif text-[18px] font-bold">判断引用的原文</h3>
            {result.citations.length ? <ol className="mt-4 space-y-4">{result.citations.map((citation, index) => <li key={`${citation.chunkId}-${index}`}>
              <blockquote className="rounded-r-xl border-l-2 border-seal/60 bg-paper/60 px-4 py-3 text-[14.5px] leading-7 text-ink-soft">{citation.quote}</blockquote>
              <button type="button" className="mt-2 text-[12.5px] text-seal underline underline-offset-4" onClick={() => { setShowEvidence(true); requestAnimationFrame(() => document.getElementById(`evidence-${citation.chunkId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>查看片段 {citation.chunkId} · 文本位置 {citation.start + 1}–{citation.end}</button>
            </li>)}</ol> : <p className="mt-3 text-[14px] leading-7 text-ink-faint">本次没有可用于判断的有效引句。证据不足不等于论断错误。</p>}
          </section>
          {result.chunks.length > 0 && <section className="card enter p-5 sm:p-7" style={delay(160)}>
            <button type="button" aria-expanded={showEvidence} onClick={() => setShowEvidence(!showEvidence)} className="flex w-full items-center justify-between gap-3 text-left">
              <span className="font-serif text-[18px] font-bold">检索召回的证据片段</span>
              <span className="inline-flex items-center gap-1 text-[13px] text-ink-faint">{showEvidence ? "收起" : "展开"}<IconChevron className={`transition-transform duration-300 ${showEvidence ? "rotate-180" : ""}`} /></span>
            </button>
            <div className="collapsible" data-open={showEvidence} inert={!showEvidence}>
              <div><div className="mt-5 space-y-5">{result.chunks.map(chunk => <Evidence key={chunk.id} chunk={chunk} />)}</div></div>
            </div>
          </section>}
        </> : !running && <section className="reveal grid gap-3 sm:grid-cols-3" style={delay(400)}>
          {STEPS.map(([title, body], index) => (
            <div key={title} className="rounded-2xl border border-rule bg-card/60 p-4">
              <p className="font-mono text-[12px] text-seal">0{index + 1}</p>
              <h3 className="mt-1 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1 text-[13px] leading-6 text-ink-soft">{body}</p>
            </div>
          ))}
          <p className="text-[12.5px] leading-6 text-ink-faint sm:col-span-3">召回的片段不能替代通读全文，模型判断也不能替代对研究方法与适用范围的人工复核。</p>
        </section>}
      </div>
    </div>
  );
}

function Evidence({ chunk }: { chunk: EvidenceChunk }) {
  return <article id={`evidence-${chunk.id}`} className="scroll-mt-24 border-t border-hair pt-4 first:border-0 first:pt-0">
    <p className="mb-2 font-mono text-[12px] text-ink-faint">{chunk.id} · 文本位置 {chunk.start + 1}–{chunk.end}</p>
    <p className="whitespace-pre-wrap break-words text-[14px] leading-7 text-ink-soft">{chunk.text}</p>
  </article>;
}
