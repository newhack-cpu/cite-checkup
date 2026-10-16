"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaimResult, ClaimServiceStatus, ClaimVerdict, EvidenceChunk } from "@/lib/claims/types";
import { buildClaimReport, CLAIM_LABELS } from "@/lib/claim-report";
import { DocumentImport } from "./document-import";

const COLORS: Record<ClaimVerdict, string> = { supported: "var(--color-jade)", partially_supported: "var(--color-amber)", contradicted: "var(--color-seal)", insufficient_evidence: "var(--color-slate)" };
const METHOD_LABEL: Record<ClaimResult["coverage"]["method"], string> = { "hybrid-v1": "混合检索（词面 + 模型扩展检索词 + 模型重排）", "bm25-en-zh-v1": "词面检索", "all-chunks": "材料较短，全部片段参与判断" };
const DEMO_EVIDENCE = "以下为功能演示用的虚构研究片段，不是真实论文。\n\n研究方法：本研究招募了40名大学生，将他们随机分为学习计划组和对照组，各20人。干预持续四周。研究仅测量这40名参与者的课程测验成绩。\n\n研究结果：学习计划组与对照组的平均成绩差异没有达到统计显著性。研究没有观察到学习计划能提高考试成绩的可靠证据。\n\n研究局限：样本规模小，干预时间短，无法将结果推广到所有年龄段的学生，也不能推断长期学习效果。";
const field = "w-full rounded-sm border border-rule bg-card px-3 py-2.5 text-[14px] leading-7 text-ink outline-none focus-visible:border-seal disabled:opacity-60";

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
    const url = URL.createObjectURL(new Blob([buildClaimReport(result)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `论断核查报告-${new Date().toISOString().slice(0, 10)}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(320px,400px)_1fr] lg:gap-10">
      <section className="self-start">
        <div className="sheet rounded-sm border border-rule/80">
          <header className="border-b border-dashed border-rule px-5 py-4">
            <h2 className="font-serif text-[19px] font-bold">这句话，原文支持吗？</h2>
            <p className="mt-1 text-[12.5px] leading-6 text-ink-faint">每次核查一条论断，展示判断依据与适用范围。</p>
          </header>
          <div className="space-y-4 p-5">
            <label className="block text-sm text-ink-soft" htmlFor="claim-text">正文中的论断</label>
            <textarea id="claim-text" value={claim} onChange={event => setClaim(event.target.value)} disabled={running} rows={4} className={field} placeholder="例如：这项研究证明，某种方法能够显著提高学习效果。" />
            <p className={`text-right font-mono text-xs ${claim.length > claimLimit ? "text-seal" : "text-ink-faint"}`}>{claim.length.toLocaleString()} / {claimLimit.toLocaleString()}</p>
            <fieldset disabled={running}>
              <legend className="mb-3 text-sm text-ink-soft">证据来自哪里</legend>
              <div className="flex flex-wrap gap-4 text-[13px]">
                <label className="flex items-center gap-2"><input type="radio" name="claim-source" checked={sourceMode === "doi"} onChange={() => setSourceMode("doi")} className="accent-seal" />通过 DOI 查原文</label>
                <label className="flex items-center gap-2"><input type="radio" name="claim-source" checked={sourceMode === "text"} onChange={() => setSourceMode("text")} className="accent-seal" />提供文献正文</label>
              </div>
            </fieldset>
            {sourceMode === "doi" ? <div>
              <label htmlFor="claim-doi" className="mb-2 block text-sm text-ink-soft">文献 DOI</label>
              <input id="claim-doi" value={doi} onChange={event => setDoi(event.target.value)} disabled={running} className={`${field} font-mono`} placeholder="10.1038/s41598-023-41032-5" />
              <p className="mt-2 text-xs leading-6 text-ink-faint">优先读取 Europe PMC、arXiv 的开放获取全文，取不到再用 Crossref / OpenAlex 摘要；都没有时会提示补充正文，不凭题名推断。</p>
            </div> : <div className="space-y-3">
              <label htmlFor="evidence-label" className="block text-sm text-ink-soft">来源说明</label>
              <input id="evidence-label" value={label} onChange={event => setLabel(event.target.value)} disabled={running} maxLength={200} className={field} placeholder="文献题名、章节或文件名" />
              <DocumentImport onImport={setEvidence} disabled={running} purpose="evidence" />
              <label htmlFor="claim-evidence" className="block text-sm text-ink-soft">文献原文</label>
              <textarea id="claim-evidence" value={evidence} onChange={event => setEvidence(event.target.value)} disabled={running} rows={8} className={field} placeholder="粘贴摘要或相关章节，也可以从上方导入文档。" />
              <p className={`text-xs leading-6 ${evidence.length > evidenceLimit ? "text-seal" : "text-ink-faint"}`}>{evidence.length.toLocaleString()} / {evidenceLimit.toLocaleString()} 字符 · 请确认来源真实、内容完整。</p>
            </div>}
            {tooLong && <p role="alert" className="text-sm text-seal">内容超过长度限制，请缩短论断或选择更相关的原文章节。</p>}
            <button type="button" disabled={running || !claim.trim() || !(sourceMode === "doi" ? doi.trim() : evidence.trim()) || tooLong} onClick={check} className="w-full rounded-sm bg-seal px-4 py-3 font-serif text-[17px] font-bold tracking-widest text-card shadow-sm hover:bg-seal-deep disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{running ? "正在核查证据…" : "核查论断"}</button>
            {running && <button type="button" onClick={() => abort.current?.abort()} className="w-full text-sm text-ink-soft underline underline-offset-4">停止论断核查</button>}
            <div className="flex flex-wrap justify-between gap-2 text-xs text-ink-soft">
              <button type="button" disabled={running} onClick={() => example("doi")} className="underline decoration-dotted underline-offset-4">试用公开文献摘要</button>
              <button type="button" disabled={running} onClick={() => example("text")} className="underline decoration-dotted underline-offset-4">试用矛盾演示材料</button>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] leading-6 text-ink-faint">点击核查后，论断及检索到的原文片段会发送给 DeepSeek。请仅提供你有权处理的文本。{service && !service.available && " 当前 AI 服务未配置，暂时不能生成论断判断。"}</p>
      </section>

      <div ref={report} className="min-w-0 scroll-mt-6 space-y-4">
        {running && <div role="status" aria-live="polite" className="sheet rounded-sm border border-rule p-6">
          <p className="font-kai text-lg">正在检索证据、比对论断…</p>
          <p className="mt-2 text-sm leading-7 text-ink-faint">只判断本次召回片段能够支持的内容。已用时 {seconds} 秒，可随时停止。</p>
        </div>}
        {error && <p role="alert" className="rounded-sm border border-seal/40 bg-seal/5 px-5 py-4 text-sm leading-7 text-seal">{error}</p>}
        {result ? <>
          <section className="sheet rounded-sm border border-rule p-5 sm:p-7">
            <p className="text-xs tracking-[0.3em] text-ink-faint">论 断 核 查 报 告</p>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <h2 className="font-serif text-3xl font-black" style={{ color: result.status === "complete" && result.verdict ? COLORS[result.verdict] : "var(--color-slate)" }}>{result.status === "complete" && result.verdict ? CLAIM_LABELS[result.verdict] : "核查未完成"}</h2>
              <button type="button" onClick={download} className="rounded-sm border border-ink/25 px-3 py-2 text-[13px] hover:border-seal hover:text-seal">下载论断报告</button>
            </div>
            <p className="mt-5 border-l-2 border-rule pl-4 font-serif text-[15px] leading-8">{result.claim}</p>
            <p className="mt-5 font-kai text-[18px] leading-8 text-ink-soft">{result.explanation}</p>
            <div className="mt-5 border-t border-dashed border-rule pt-4 text-[12.5px] leading-7 text-ink-faint">
              <p>判断范围：{result.source?.scope === "full_text" ? `${result.source.label}，只核查召回的片段` : result.source?.scope === "abstract" ? "仅数据库摘要，未核查全文" : result.source ? "仅用户提供的文本，来源未经独立认证" : "尚未取得可用证据"}</p>
              {result.source && <p className="break-words">来源：{result.source.title || result.source.label}{result.source.doi && <> · <a className="break-all underline" href={`https://doi.org/${encodeURI(result.source.doi)}`} target="_blank" rel="noreferrer">{result.source.doi}</a></>}{result.source.scope === "full_text" && result.source.url && <> · <a className="break-all underline" href={result.source.url} target="_blank" rel="noreferrer">全文</a></>}</p>}
              <p>检索到 {result.coverage.retrievedChunks} / {result.coverage.totalChunks} 个片段，{result.coverage.retrievedChars.toLocaleString()} 字符{METHOD_LABEL[result.coverage.method] ? ` · ${METHOD_LABEL[result.coverage.method]}` : ""}。</p>
              {result.coverage.expansion?.length ? <p className="break-words">扩展检索词：{result.coverage.expansion.join("、")}</p> : null}
            </div>
            {result.warnings.length > 0 && <ul className="mt-4 space-y-2 text-[13px] leading-6 text-amber">{result.warnings.map((warning, index) => <li key={index}>注：{warning}</li>)}</ul>}
          </section>
          <section className="sheet rounded-sm border border-rule p-5 sm:p-7">
            <h3 className="font-serif text-lg font-bold">判断引用的原文</h3>
            {result.citations.length ? <ol className="mt-4 space-y-4">{result.citations.map((citation, index) => <li key={`${citation.chunkId}-${index}`}>
              <blockquote className="border-l-2 border-seal/50 bg-paper/60 px-4 py-3 text-[14px] leading-7 text-ink-soft">{citation.quote}</blockquote>
              <button type="button" className="mt-2 text-xs text-seal underline underline-offset-4" onClick={() => { setShowEvidence(true); requestAnimationFrame(() => document.getElementById(`evidence-${citation.chunkId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>查看片段 {citation.chunkId} · 文本位置 {citation.start + 1}–{citation.end}</button>
            </li>)}</ol> : <p className="mt-3 text-sm leading-7 text-ink-faint">本次没有可用于判断的有效引句。证据不足不等于论断错误。</p>}
          </section>
          {result.chunks.length > 0 && <section className="sheet rounded-sm border border-rule p-5 sm:p-7">
            <button type="button" aria-expanded={showEvidence} onClick={() => setShowEvidence(!showEvidence)} className="flex w-full items-center justify-between gap-3 text-left"><span className="font-serif text-lg font-bold">检索召回的证据片段</span><span className="text-xs text-ink-faint">{showEvidence ? "收起" : "展开"}</span></button>
            {showEvidence && <div className="mt-5 space-y-5">{result.chunks.map(chunk => <Evidence key={chunk.id} chunk={chunk} />)}</div>}
          </section>}
        </> : !running && <section className="sheet rounded-sm border border-rule p-6 sm:p-8">
          <p className="text-xs tracking-[0.3em] text-ink-faint">从 文 献 到 论 据</p>
          <h2 className="mt-3 font-serif text-[27px] font-black leading-snug">文献是真的，<br />也要看这句话有没有依据。</h2>
          <ol className="mt-7 space-y-6">{[
            ["壹", "提供一句论断", "拆开过长的复合结论，每次聚焦一个能被证据检验的说法。"],
            ["贰", "检索相关原文", "可按 DOI 读取开放全文或摘要，也可导入正文。长材料先做词面检索，再由模型补充中英文检索词、重排候选片段，保留每段来源和文本位置。"],
            ["叁", "带着证据看判断", "支持、部分支持、矛盾或证据不足，每个有效引句都能回到召回片段复核。"],
          ].map(([n, title, body]) => <li key={n} className="flex gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-seal font-bold text-seal">{n}</span><div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm leading-7 text-ink-soft">{body}</p></div></li>)}</ol>
          <p className="mt-7 border-t border-dashed border-rule pt-5 font-kai text-[17px] leading-8 text-ink-soft">召回的片段不能替代通读全文，模型判断也不能替代对研究方法与适用范围的人工复核。</p>
        </section>}
      </div>
    </div>
  );
}

function Evidence({ chunk }: { chunk: EvidenceChunk }) {
  return <article id={`evidence-${chunk.id}`} className="scroll-mt-6 border-t border-dashed border-rule pt-4 first:border-0 first:pt-0">
    <p className="mb-2 font-mono text-xs text-ink-faint">{chunk.id} · 文本位置 {chunk.start + 1}–{chunk.end}</p>
    <p className="whitespace-pre-wrap break-words text-[14px] leading-7 text-ink-soft">{chunk.text}</p>
  </article>;
}
