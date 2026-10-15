"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DOCUMENT_LIMITS, type ImportedDocument } from "@/lib/documents/types";

export interface DocumentImportProps {
  onImport: (text: string) => void;
  disabled?: boolean;
  purpose?: "references" | "evidence";
}

export function DocumentImport({ onImport, disabled = false, purpose = "references" }: DocumentImportProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [document, setDocument] = useState<ImportedDocument | null>(null);
  const [selection, setSelection] = useState<"full" | "references">("full");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const limit = purpose === "references" ? 60_000 : DOCUMENT_LIMITS.characters;
  const overLimit = preview.length > limit;

  useEffect(() => () => controller.current?.abort(), []);

  async function upload(file: File) {
    controller.current?.abort();
    setError(null);
    setNotice(null);
    setDocument(null);
    setPreview("");
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) { setError("仅支持 PDF、DOCX 和 TXT；旧版 .doc 请先另存为 .docx。"); return; }
    if (file.size > DOCUMENT_LIMITS.fileBytes) { setError("文件超过 8 MiB，请压缩或拆分后导入。"); return; }
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/import", { method: "POST", body, signal: next.signal });
      const result = await response.json() as ImportedDocument & { error?: string };
      if (!response.ok) throw new Error(result.error || "文档导入失败，请重试。");
      if (typeof result.text !== "string" || !result.metadata || !Array.isArray(result.warnings)) throw new Error("服务器返回了不完整的预览，请重试。");
      if (controller.current !== next) return;
      const references = purpose === "references" && Boolean(result.references?.text);
      setDocument(result);
      setSelection(references ? "references" : "full");
      setPreview(references ? result.references!.text : result.text);
    } catch (error) {
      if (controller.current === next) {
        if (next.signal.aborted) setNotice("已取消导入，原输入内容未变更。");
        else setError(error instanceof Error ? error.message : "导入失败，请重试。");
      }
    } finally { if (controller.current === next) { setBusy(false); controller.current = null; } }
  }

  function select(value: "full" | "references") {
    if (!document) return;
    setSelection(value);
    setPreview(value === "references" ? document.references?.text ?? "" : document.text);
  }

  function confirm() {
    if (!preview.trim() || overLimit || disabled) return;
    onImport(preview.trim());
    setDocument(null);
    setPreview("");
    setNotice(purpose === "references" ? "已将确认的文字填入参考文献框；请再开始核验。" : "已将确认的文字填入证据框，来源为用户提供；请再开始证据核查。");
  }

  return (
    <div className="border-b border-dashed border-rule px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input id={`${id}-file`} ref={input} type="file" accept=".pdf,.docx,.txt" disabled={disabled || busy} className="sr-only" aria-label={purpose === "references" ? "选择参考文献文件" : "选择证据文件"} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()} className="rounded-sm border border-rule bg-white/60 px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-seal hover:text-seal disabled:cursor-not-allowed disabled:opacity-50">{busy ? "正在提取文字…" : "导入 PDF / Word / TXT"}</button>
        {busy && <button type="button" onClick={() => controller.current?.abort()} className="px-2 py-1 text-[12px] text-seal underline underline-offset-4">取消导入</button>}
        <span className="text-[11px] text-ink-faint">8 MiB · PDF 最多 100 页</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-ink-faint">文件发送至本站服务器提取文字，确认预览后填入；导入不调用 AI、不执行 OCR，原文件不持久保存。</p>
      {error && <p role="alert" className="mt-2 text-[12px] leading-5 text-seal">{error}</p>}
      {notice && <p role="status" className="mt-2 text-[12px] leading-5 text-jade">{notice}</p>}
      {document && <div className="mt-3 space-y-3 rounded-sm border border-rule bg-white/45 p-3">
        <div>
          <p className="break-all text-[12px] font-medium text-ink">{document.metadata.filename}</p>
          <p className="mt-1 text-[11px] text-ink-faint">{document.metadata.format.toUpperCase()} · {document.metadata.pageCount ? `${document.metadata.pageCount} 页 · ` : ""}{document.metadata.characterCount.toLocaleString()} 字符</p>
        </div>
        <fieldset disabled={disabled} className="flex flex-wrap gap-3 text-[12px] text-ink-soft">
          <legend className="mb-2 text-[12px] font-medium text-ink">选择导入范围</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name={`${id}-range`} checked={selection === "full"} onChange={() => select("full")} className="accent-seal" />全文文字</label>
          <label className={`flex items-center gap-1.5 ${document.references ? "" : "opacity-50"}`}><input type="radio" name={`${id}-range`} checked={selection === "references"} disabled={!document.references || disabled} onChange={() => select("references")} className="accent-seal" />参考文献区域{!document.references && "（未识别）"}</label>
        </fieldset>
        <div>
          <label htmlFor={`${id}-preview`} className="mb-1.5 block text-[12px] text-ink-soft">文字预览 · 可编辑或删除不需要的部分</label>
          <textarea id={`${id}-preview`} value={preview} disabled={disabled} onChange={event => setPreview(event.target.value)} spellCheck={false} rows={10} className="block w-full resize-y rounded-sm border border-rule bg-paper p-2.5 font-serif text-[12px] leading-6 text-ink outline-none focus:border-seal" />
          <p className={`mt-1 text-[11px] ${overLimit ? "text-seal" : "text-ink-faint"}`}>{preview.length.toLocaleString()} / {limit.toLocaleString()} 字符{overLimit ? "，请删减预览内容后确认；不会自动截断。" : ""}</p>
        </div>
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-5 text-ink-faint">{document.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        <p className="text-[11px] leading-5 text-ink-soft">确认后将替换{purpose === "references" ? "参考文献" : "证据"}输入框现有内容。切换范围会重新载入该范围文字。</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={confirm} disabled={disabled || overLimit || !preview.trim()} className="rounded-sm border border-seal bg-seal px-3 py-1.5 text-[12px] text-white disabled:cursor-not-allowed disabled:opacity-40">确认并填入{purpose === "references" ? "参考文献" : "证据"}</button>
          <button type="button" onClick={() => { setDocument(null); setPreview(""); }} className="rounded-sm border border-rule px-3 py-1.5 text-[12px] text-ink-soft">放弃预览</button>
        </div>
      </div>}
    </div>
  );
}
