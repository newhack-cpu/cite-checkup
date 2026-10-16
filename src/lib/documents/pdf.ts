import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { DOCUMENT_LIMITS, DocumentImportError, throwIfAborted, type DocumentErrorCode } from "./types";
import { guardPdfWorkerSource } from "./pdf-decoder-guard";
import { HIDDEN_WORKER_DATA, type HiddenTechnique } from "./hidden";
import { PDF_HIDDEN_TEXT_OBSERVER } from "./pdf-hidden-text";

// PDF parsing is CPU-heavy. The worker can be terminated on disconnect or timeout,
// independently of PDF.js, and never receives network URLs or user file paths.
const PDF_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
globalThis.fetch = () => Promise.reject(new Error('Network disabled for document import'));
// A PDF.js catch/recovery must never downgrade a resource violation to partial
// success. Exiting a Node worker stops only this thread, after posting the error.
globalThis.__citePdfAbort = (code) => {
  parentPort.postMessage({ error: { code, message: code === 'PDF_RESOURCE_LIMIT'
    ? 'PDF 解压资源超出安全上限（单流 8 MiB、累计缓冲分配 32 MiB），请拆分或重新导出后导入。'
    : 'PDF 使用当前安全导入器不支持的压缩编码，请重新导出为普通文字层 PDF。' } });
  process.exit(0);
};
(async () => {
  let document;
  let task;
  try {
    // Preload the guarded module and provide its handler explicitly.
    const guarded = await import(workerData.workerUrl);
    globalThis.pdfjsWorker = { WorkerMessageHandler: guarded.WorkerMessageHandler };
    const pdfjs = await import(workerData.moduleUrl);
    pdfjs.GlobalWorkerOptions.workerSrc = workerData.workerUrl;
    task = pdfjs.getDocument({
      data: new Uint8Array(workerData.bytes), verbosity: 0,
      isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWasm: false,
      useWorkerFetch: false, stopAtErrors: true, isImageDecoderSupported: false,
      disableAutoFetch: true, disableStream: true,
      cMapUrl: workerData.cMaps, cMapPacked: true,
      standardFontDataUrl: workerData.fonts, wasmUrl: workerData.wasm,
    });
    document = await task.promise;
    if (document.numPages > workerData.limits.pages) fail('TOO_MANY_PAGES', 'PDF 最多支持 100 页。请拆分后导入。');
    // Hidden text: the observer appended to the PDF.js module reports white / invisible text;
    // size and position come from the text items. Hidden spans are wrapped in noncharacter
    // markers (see src/lib/documents/hidden.ts), which are first stripped from the PDF's own text.
    const hiddenText = globalThis.__citeHiddenText;
    const { start: MARK_START, end: MARK_END, base: MARK_BASE, bits: BITS } = workerData.hidden;
    const MARKS = /[\uFDD0-\uFDEF]/g;
    const mark = (text, mask) => MARK_START + String.fromCharCode(MARK_BASE + mask) + text + MARK_END;
    const maskOf = (techniques) => techniques.reduce((sum, t) => sum | (BITS[t] || 0), 0);
    // Locate an observed hidden run inside the page text, ignoring whitespace and markers and
    // comparing NFKC forms character by character (PDF.js already expanded ligatures).
    const keyChars = (text, keepIndex) => {
      const chars = [];
      const index = [];
      for (let i = 0; i < text.length; i++) {
        for (const ch of text[i].normalize('NFKC')) {
          if (/[\s\uFDD0-\uFDEF\p{Cf}]/u.test(ch)) continue;
          chars.push(ch);
          if (keepIndex) index.push(i);
        }
      }
      return { key: chars.join(''), index };
    };
    const pages = [];
    const hiddenExtras = [];
    let count = 0;
    let emptyPages = 0;
    let ocrPages = 0;
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const view = page.view;
      hiddenText?.begin(view);
      const reader = page.streamTextContent().getReader();
      let pageText = '';
      let lastY;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const item of value.items) {
          if (typeof item.str !== 'string') continue;
          const str = item.str.replace(MARKS, '');
          const tr = item.transform;
          let mask = 0;
          if (Array.isArray(tr) && /\S/.test(str)) {
            const size = Math.hypot(tr[2], tr[3]);
            const width = Math.max(0, Number(item.width) || 0);
            if (size > 0 && size < 1.5) mask |= BITS.tiny;
            if (tr[4] > view[2] + 1 || tr[5] > view[3] + 1 || tr[4] + width < view[0] - 1 || tr[5] + size < view[1] - 1) mask |= BITS.offpage;
          }
          const y = tr?.[5];
          if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 3 && !pageText.endsWith('\n')) pageText += '\n';
          pageText += (mask ? mark(str, mask) : str) + (item.hasEOL ? '\n' : ' ');
          lastY = y;
          if (count + pageText.length > workerData.limits.characters) fail('TEXT_TOO_LONG', '文档文字超过 160,000 字符，请拆分后导入。');
        }
      }
      pageText = pageText.replace(/[ \t]+\n/g, '\n').trim();
      const observed = hiddenText?.end();
      if (observed?.runs.length) {
        // Invisible text covering most of a page is an OCR layer over a scanned image, not a hidden prompt.
        const ocr = observed.invisible >= 30 && observed.invisible >= observed.total * 0.5;
        if (ocr) ocrPages++;
        const { key, index } = keyChars(pageText, true);
        const find = (needle, cursor) => { const at = key.indexOf(needle, cursor); return at >= 0 ? at : key.indexOf(needle); };
        const spans = [];
        let cursor = 0;
        let previousExtra = -2;
        observed.runs.forEach((run, i) => {
          if (ocr && run.techniques.includes('invisible')) return;
          const needle = keyChars(run.text, false).key;
          if (needle.length < 2) return;
          let at = find(needle, cursor);
          let length = needle.length;
          // PDF.js drops glyphs outside the page, so a line running off an edge is only partly in
          // the text: fall back to the longest matching prefix, then suffix (at least 12 characters).
          if (at < 0 && needle.length >= 12) {
            for (const fromEnd of [false, true]) {
              let low = 12, high = needle.length - 1, best = -1, bestAt = -1;
              while (low <= high) {
                const mid = (low + high) >> 1;
                const found = find(fromEnd ? needle.slice(-mid) : needle.slice(0, mid), cursor);
                if (found >= 0) { best = mid; bestAt = found; low = mid + 1; } else high = mid - 1;
              }
              if (best > 0) { at = bestAt; length = best; break; }
            }
          }
          if (at < 0) {
            // Not in the text layer at all (e.g. off-page): report only. Merge consecutive lines.
            const last = hiddenExtras[hiddenExtras.length - 1];
            if (last && previousExtra === i - 1 && last.page === n && last.techniques.join() === run.techniques.join() && last.text.length < 2000) last.text += ' ' + run.text;
            else hiddenExtras.push({ page: n, text: run.text.slice(0, 2000), techniques: run.techniques });
            previousExtra = i;
            return;
          }
          spans.push({ start: index[at], end: index[at + length - 1] + 1, mask: maskOf(run.techniques) });
          cursor = at + length;
        });
        // Insert from the end so earlier offsets stay valid; overlapping spans nest.
        const edits = spans.flatMap((s) => [{ at: s.end, text: MARK_END, order: 0 }, { at: s.start, text: MARK_START + String.fromCharCode(MARK_BASE + s.mask), order: 1 }]);
        // At a shared position the next span's start goes in first, so it lands after the previous span's end.
        edits.sort((a, b) => b.at - a.at || b.order - a.order);
        for (const edit of edits) pageText = pageText.slice(0, edit.at) + edit.text + pageText.slice(edit.at);
      }
      if (pageText) { const block = '[第 ' + n + ' 页]\n' + pageText; count += block.length + 2; pages.push(block); }
      else emptyPages++;
      page.cleanup();
    }
    if (!pages.length) fail('NO_TEXT', '未提取到 PDF 文字层，文件可能是扫描件。参考文献页可截图后用「拍照 / 截图识别」，或先转换为带文字层的 PDF。');
    parentPort.postMessage({ text: pages.join('\n\n'), pageCount: document.numPages, emptyPages, ocrPages, hiddenExtras: hiddenExtras.slice(0, 50) });
  } catch (error) {
    const encrypted = error?.name === 'PasswordException';
    const known = ['ENCRYPTED', 'TOO_MANY_PAGES', 'TEXT_TOO_LONG', 'NO_TEXT'].includes(error?.code);
    parentPort.postMessage({ error: { code: encrypted ? 'ENCRYPTED' : known ? error.code : 'INVALID_DOCUMENT', message: encrypted ? 'PDF 已加密。请先在本地解密，再导入。' : known ? error.message : '无法读取 PDF；文件可能损坏或格式不受支持。请重新导出为带文字层的 PDF。' } });
  } finally { if (task) await task.destroy().catch(() => {}); }
})();
`;

export interface ParsedPdf {
  /** 页面文字；隐藏文字用 hidden.ts 的标记包住 */
  text: string;
  pageCount: number;
  emptyPages: number;
  /** 不可见文字占多数的页：扫描件的 OCR 文字层 */
  ocrPages: number;
  /** 观察到、但没在提取文字里找到的隐藏文字 */
  hiddenExtras: { page: number; text: string; techniques: HiddenTechnique[] }[];
}

export function parsePdf(bytes: Uint8Array, signal?: AbortSignal): Promise<ParsedPdf> {
  throwIfAborted(signal);
  const nodeRequire = createRequire(join(process.cwd(), "package.json"));
  const root = dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
  const guardedSource = guardPdfWorkerSource(readFileSync(join(root, "legacy/build/pdf.worker.mjs"), "utf8")) + PDF_HIDDEN_TEXT_OBSERVER;
  // Use a private file URL because Next's runtime loaders can reject data: module
  // URLs. This preserves normal module URL semantics. Only reviewed program code
  // is written here; uploaded PDF bytes remain in memory.
  const workerDirectory = mkdtempSync(join(tmpdir(), "cite-checkup-pdf-"));
  const workerFile = join(workerDirectory, "guarded-pdf-worker.mjs");
  const cleanup = () => {
    try { unlinkSync(workerFile); } catch { /* Already removed or never written. */ }
    try { rmdirSync(workerDirectory); } catch { /* No recursive/path-derived deletion. */ }
  };
  let worker: Worker;
  try {
    writeFileSync(workerFile, guardedSource, { encoding: "utf8", mode: 0o600 });
    worker = new Worker(PDF_WORKER, {
    eval: true,
    name: "document-text-extraction",
    resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    workerData: {
      bytes, limits: DOCUMENT_LIMITS, hidden: HIDDEN_WORKER_DATA,
      moduleUrl: pathToFileURL(join(root, "legacy/build/pdf.mjs")).href,
      workerUrl: pathToFileURL(workerFile).href,
      cMaps: join(root, "cmaps").replaceAll("\\", "/") + "/",
      fonts: join(root, "standard_fonts").replaceAll("\\", "/") + "/",
      wasm: join(root, "wasm").replaceAll("\\", "/") + "/",
    },
    });
  } catch {
    cleanup();
    throw new DocumentImportError("PARSER_UNAVAILABLE", "PDF 安全解析器暂不可用，请稍后重试或联系管理员。", 503);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: DocumentImportError, result?: ParsedPdf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const complete = () => { cleanup(); if (error) reject(error); else resolve(result!); };
      void worker.terminate().then(complete, complete);
    };
    const onAbort = () => finish(new DocumentImportError("CANCELLED", "已取消文档导入。", 499));
    const timer = setTimeout(() => finish(new DocumentImportError("TIMEOUT", "PDF 解析超时，请拆分文件或重新导出后重试。", 408)), DOCUMENT_LIMITS.parseMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (result: ParsedPdf & { error?: { code: DocumentErrorCode; message: string } }) => {
      if (result.error) finish(new DocumentImportError(result.error.code, result.error.message, result.error.code === "PDF_RESOURCE_LIMIT" ? 413 : 422));
      else finish(undefined, result);
    });
    worker.once("error", () => finish(new DocumentImportError("INVALID_DOCUMENT", "PDF 解析失败或超出处理资源限制，请重新导出或拆分文件。")));
    worker.once("exit", () => finish(new DocumentImportError("INVALID_DOCUMENT", "PDF 解析提前结束，请重新导出文件后重试。")));
    if (signal?.aborted) onAbort();
  });
}
