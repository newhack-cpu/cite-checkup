import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { DOCUMENT_LIMITS, DocumentImportError, throwIfAborted, type DocumentErrorCode } from "./types";
import { guardPdfWorkerSource } from "./pdf-decoder-guard";

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
    const pages = [];
    let count = 0;
    let emptyPages = 0;
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const reader = page.streamTextContent().getReader();
      let pageText = '';
      let lastY;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const item of value.items) {
          if (typeof item.str !== 'string') continue;
          const y = item.transform?.[5];
          if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 3 && !pageText.endsWith('\n')) pageText += '\n';
          pageText += item.str + (item.hasEOL ? '\n' : ' ');
          lastY = y;
          if (count + pageText.length > workerData.limits.characters) fail('TEXT_TOO_LONG', '文档文字超过 160,000 字符，请拆分后导入。');
        }
      }
      pageText = pageText.replace(/[ \t]+\n/g, '\n').trim();
      if (pageText) { const block = '[第 ' + n + ' 页]\n' + pageText; count += block.length + 2; pages.push(block); }
      else emptyPages++;
      page.cleanup();
    }
    if (!pages.length) fail('NO_TEXT', '未提取到 PDF 文字层。文件可能是扫描件或图片；本工具不执行 OCR，请先转换为带文字层的 PDF 或粘贴文字。');
    parentPort.postMessage({ text: pages.join('\n\n'), pageCount: document.numPages, emptyPages });
  } catch (error) {
    const encrypted = error?.name === 'PasswordException';
    const known = ['ENCRYPTED', 'TOO_MANY_PAGES', 'TEXT_TOO_LONG', 'NO_TEXT'].includes(error?.code);
    parentPort.postMessage({ error: { code: encrypted ? 'ENCRYPTED' : known ? error.code : 'INVALID_DOCUMENT', message: encrypted ? 'PDF 已加密。请先在本地解密，再导入。' : known ? error.message : '无法读取 PDF；文件可能损坏或格式不受支持。请重新导出为带文字层的 PDF。' } });
  } finally { if (task) await task.destroy().catch(() => {}); }
})();
`;

export interface ParsedPdf { text: string; pageCount: number; emptyPages: number }

export function parsePdf(bytes: Uint8Array, signal?: AbortSignal): Promise<ParsedPdf> {
  throwIfAborted(signal);
  const nodeRequire = createRequire(join(process.cwd(), "package.json"));
  const root = dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
  const guardedSource = guardPdfWorkerSource(readFileSync(join(root, "legacy/build/pdf.worker.mjs"), "utf8"));
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
      bytes, limits: DOCUMENT_LIMITS,
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
