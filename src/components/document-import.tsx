"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { DOCUMENT_LIMITS, type ImportedDocument } from "@/lib/documents/types";

export interface DocumentImportProps {
  onImport: (text: string) => void;
  disabled?: boolean;
  purpose?: "references" | "evidence";
  /** 在这个输入框里粘贴截图时也走图片识别（仅参考文献） */
  pasteTargetId?: string;
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface VisionPreview {
  entries: string[];
  warnings: string[];
  model: string;
  /** 压缩后原图的本地预览地址，用于对照核对 */
  thumbs: string[];
}

/** 浏览器里先把长边缩到 2048 像素再重新编码：上传更快，也去掉了照片里的 GPS 等 EXIF 信息 */
async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`无法读取图片「${file.name}」；iPhone 的 HEIC 照片请先截图或转成 JPG / PNG。`);
  }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("浏览器无法处理图片，请换一个浏览器重试。");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // 截图里的小字用 PNG 无损保存，照片用 JPEG 体积小得多
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("图片处理失败，请重试。"))), type, 0.92));
}

export function DocumentImport({ onImport, disabled = false, purpose = "references", pasteTargetId }: DocumentImportProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<false | "document" | "vision">(false);
  const [document, setDocument] = useState<ImportedDocument | null>(null);
  const [vision, setVision] = useState<VisionPreview | null>(null);
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [selection, setSelection] = useState<"full" | "references">("full");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const limit = purpose === "references" ? 60_000 : DOCUMENT_LIMITS.characters;
  const overLimit = preview.length > limit;
  const allowImages = purpose === "references" && visionAvailable;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => vision?.thumbs.forEach((url) => URL.revokeObjectURL(url)), [vision]);
  useEffect(() => {
    if (purpose !== "references") return;
    const status = new AbortController();
    fetch("/api/vision", { signal: status.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setVisionAvailable(body?.available === true))
      .catch(() => {});
    return () => status.abort();
  }, [purpose]);

  function reset() {
    controller.current?.abort();
    setError(null);
    setNotice(null);
    setDocument(null);
    setVision(null);
    setPreview("");
  }

  function failed(next: AbortController, error: unknown) {
    if (controller.current !== next) return;
    if (next.signal.aborted) setNotice("已取消，原输入内容未变更。");
    else setError(error instanceof Error ? error.message : "导入失败，请重试。");
  }

  async function upload(file: File) {
    reset();
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) { setError("仅支持 PDF、DOCX 和 TXT；旧版 .doc 请先另存为 .docx。"); return; }
    if (file.size > DOCUMENT_LIMITS.fileBytes) { setError("文件超过 8 MiB，请压缩或拆分后导入。"); return; }
    const next = new AbortController();
    controller.current = next;
    setBusy("document");
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
      failed(next, error);
    } finally { if (controller.current === next) { setBusy(false); controller.current = null; } }
  }

  /** 图片识别：DeepSeek 视觉模型逐字转写，用户对照原图核对后才填入 */
  async function recognize(files: File[]) {
    reset();
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    if (!images.length) { setError("请选择 PNG、JPG、WebP 或 GIF 图片。"); return; }
    if (images.length > MAX_IMAGES) { setError(`每次最多识别 ${MAX_IMAGES} 张图片，请分批上传。`); return; }
    const next = new AbortController();
    controller.current = next;
    setBusy("vision");
    try {
      const blobs = await Promise.all(images.map(prepareImage));
      if (blobs.reduce((sum, blob) => sum + blob.size, 0) > MAX_IMAGE_BYTES) throw new Error("图片合计超过 8 MiB，请减少张数后重试。");
      const body = new FormData();
      blobs.forEach((blob, i) => body.append("image", blob, `image-${i + 1}.${blob.type === "image/png" ? "png" : "jpg"}`));
      const response = await fetch("/api/vision", { method: "POST", body, signal: next.signal });
      const result = await response.json() as { entries?: unknown; text?: unknown; warnings?: unknown; model?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error || "图片识别失败，请重试。");
      if (!Array.isArray(result.entries) || typeof result.text !== "string" || !Array.isArray(result.warnings)) throw new Error("服务器返回了不完整的识别结果，请重试。");
      if (controller.current !== next) return;
      setVision({
        entries: result.entries.filter((e): e is string => typeof e === "string"),
        warnings: result.warnings.filter((w): w is string => typeof w === "string"),
        model: typeof result.model === "string" ? result.model : "DeepSeek",
        thumbs: blobs.map((blob) => URL.createObjectURL(blob)),
      });
      setPreview(result.text);
    } catch (error) {
      failed(next, error);
    } finally { if (controller.current === next) { setBusy(false); controller.current = null; } }
  }

  const onPastedImages = useEffectEvent((files: File[]) => { void recognize(files); });
  useEffect(() => {
    if (!allowImages) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const inside = !!target && (root.current?.contains(target) || (target instanceof HTMLElement && !!pasteTargetId && target.id === pasteTargetId));
      if (!inside || disabled) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
      // 同时带文字的粘贴（比如从网页复制）照常粘贴文字
      if (!files.length || event.clipboardData?.getData("text/plain").trim()) return;
      event.preventDefault();
      onPastedImages(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [allowImages, disabled, pasteTargetId]);

  function select(value: "full" | "references") {
    if (!document) return;
    setSelection(value);
    setPreview(value === "references" ? document.references?.text ?? "" : document.text);
  }

  function discard() {
    setDocument(null);
    setVision(null);
    setPreview("");
  }

  function confirm() {
    if (!preview.trim() || overLimit || disabled) return;
    onImport(preview.trim());
    discard();
    setNotice(purpose === "references" ? "已将确认的文字填入参考文献框；请再开始核验。" : "已将确认的文字填入证据框，来源为用户提供；请再开始证据核查。");
  }

  const warnings = document?.warnings ?? vision?.warnings ?? [];
  return (
    <div ref={root} className="border-b border-dashed border-rule px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input id={`${id}-file`} ref={input} type="file" accept=".pdf,.docx,.txt" disabled={disabled || !!busy} className="sr-only" aria-label={purpose === "references" ? "选择参考文献文件" : "选择证据文件"} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        <button type="button" disabled={disabled || !!busy} onClick={() => input.current?.click()} className="rounded-sm border border-rule bg-white/60 px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-seal hover:text-seal disabled:cursor-not-allowed disabled:opacity-50">{busy === "document" ? "正在提取文字…" : "导入 PDF / Word / TXT"}</button>
        {allowImages && <>
          <input id={`${id}-image`} ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple disabled={disabled || !!busy} className="sr-only" aria-label="选择参考文献图片" onChange={event => { const files = [...(event.target.files ?? [])]; if (files.length) void recognize(files); event.target.value = ""; }} />
          <button type="button" disabled={disabled || !!busy} onClick={() => imageInput.current?.click()} className="rounded-sm border border-rule bg-white/60 px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-seal hover:text-seal disabled:cursor-not-allowed disabled:opacity-50">{busy === "vision" ? "正在识别图片…" : "拍照 / 截图识别"}</button>
        </>}
        {busy && <button type="button" onClick={() => controller.current?.abort()} className="px-2 py-1 text-[12px] text-seal underline underline-offset-4">取消</button>}
        <span className="text-[11px] text-ink-faint">8 MiB · PDF 最多 100 页{allowImages ? ` · 图片最多 ${MAX_IMAGES} 张` : ""}</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-ink-faint">
        {allowImages
          ? "文件在本站服务器提取文字，不调用 AI；图片识别会把图片发给 DeepSeek 视觉模型转写文字，也可以在参考文献框里直接粘贴截图。都要确认预览后才填入，原文件不持久保存。"
          : "文件发送至本站服务器提取文字，确认预览后填入；导入不调用 AI，原文件不持久保存。"}
      </p>
      {busy === "vision" && <p role="status" className="mt-2 text-[12px] leading-5 text-ink-soft">DeepSeek 正在逐条转写图片中的参考文献，通常需要 5–15 秒<span className="animate-blink">▍</span></p>}
      {error && <p role="alert" className="mt-2 text-[12px] leading-5 text-seal">{error}</p>}
      {notice && <p role="status" className="mt-2 text-[12px] leading-5 text-jade">{notice}</p>}
      {(document || vision) && <div className="mt-3 space-y-3 rounded-sm border border-rule bg-white/45 p-3">
        {document && <>
          <div>
            <p className="break-all text-[12px] font-medium text-ink">{document.metadata.filename}</p>
            <p className="mt-1 text-[11px] text-ink-faint">{document.metadata.format.toUpperCase()} · {document.metadata.pageCount ? `${document.metadata.pageCount} 页 · ` : ""}{document.metadata.characterCount.toLocaleString()} 字符</p>
          </div>
          <fieldset disabled={disabled} className="flex flex-wrap gap-3 text-[12px] text-ink-soft">
            <legend className="mb-2 text-[12px] font-medium text-ink">选择导入范围</legend>
            <label className="flex items-center gap-1.5"><input type="radio" name={`${id}-range`} checked={selection === "full"} onChange={() => select("full")} className="accent-seal" />全文文字</label>
            <label className={`flex items-center gap-1.5 ${document.references ? "" : "opacity-50"}`}><input type="radio" name={`${id}-range`} checked={selection === "references"} disabled={!document.references || disabled} onChange={() => select("references")} className="accent-seal" />参考文献区域{!document.references && "（未识别）"}</label>
          </fieldset>
        </>}
        {vision && <div>
          <p className="text-[12px] font-medium text-ink">图片识别 · {vision.thumbs.length} 张图片 · 识别出 {vision.entries.length} 条</p>
          <p className="mt-1 text-[11px] text-ink-faint">由 DeepSeek 视觉模型（{vision.model}）逐字转写；点击缩略图可查看原图</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {vision.thumbs.map((src, i) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                {/* 本地 blob 地址的临时预览，不经过 next/image 优化 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`第 ${i + 1} 张原图`} className="h-28 rounded-sm border border-rule bg-white object-contain" />
              </a>
            ))}
          </div>
        </div>}
        <div>
          <label htmlFor={`${id}-preview`} className="mb-1.5 block text-[12px] text-ink-soft">{vision ? "识别结果 · 请对照原图逐条核对，可直接修改" : "文字预览 · 可编辑或删除不需要的部分"}</label>
          <textarea id={`${id}-preview`} value={preview} disabled={disabled} onChange={event => setPreview(event.target.value)} spellCheck={false} rows={10} className="block w-full resize-y rounded-sm border border-rule bg-paper p-2.5 font-serif text-[12px] leading-6 text-ink outline-none focus:border-seal" />
          <p className={`mt-1 text-[11px] ${overLimit ? "text-seal" : "text-ink-faint"}`}>{preview.length.toLocaleString()} / {limit.toLocaleString()} 字符{overLimit ? "，请删减预览内容后确认；不会自动截断。" : ""}</p>
        </div>
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-5 text-ink-faint">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        <p className="text-[11px] leading-5 text-ink-soft">确认后将替换{purpose === "references" ? "参考文献" : "证据"}输入框现有内容。{document ? "切换范围会重新载入该范围文字。" : ""}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={confirm} disabled={disabled || overLimit || !preview.trim()} className="rounded-sm border border-seal bg-seal px-3 py-1.5 text-[12px] text-white disabled:cursor-not-allowed disabled:opacity-40">确认并填入{purpose === "references" ? "参考文献" : "证据"}</button>
          <button type="button" onClick={discard} className="rounded-sm border border-rule px-3 py-1.5 text-[12px] text-ink-soft">放弃预览</button>
        </div>
      </div>}
    </div>
  );
}
