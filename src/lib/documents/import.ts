import { UPLOAD_LIMIT_MIB } from "../deployment-limits";
import { parseDocx } from "./docx";
import { applyHiddenText, stripMarks, type HiddenTechnique } from "./hidden";
import { parsePdf } from "./pdf";
import { extractReferenceSection } from "./references";
import { DOCUMENT_LIMITS, DocumentImportError, throwIfAborted, type DocumentFormat, type ImportedDocument } from "./types";

export async function importDocument(file: File, signal?: AbortSignal): Promise<ImportedDocument> {
  throwIfAborted(signal);
  if (file.size > DOCUMENT_LIMITS.fileBytes) throw new DocumentImportError("FILE_TOO_LARGE", `文件超过 ${UPLOAD_LIMIT_MIB} MiB，请压缩或拆分后导入。`, 413);
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!["pdf", "docx", "txt"].includes(extension ?? "")) throw new DocumentImportError("UNSUPPORTED_TYPE", "仅支持 PDF、DOCX 和 TXT。旧版 .doc 请先另存为 .docx。", 415);
  const format = extension as DocumentFormat;
  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(signal);
  if (!bytes.length) throw new DocumentImportError("NO_TEXT", "文件为空，请选择包含文字的文件。");
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) throw new DocumentImportError("ENCRYPTED", "文件可能是加密 Word 文档或旧版 .doc；请在本地解密并另存为 .docx。");
  let text: string;
  let pageCount: number | undefined;
  const warnings: string[] = [];
  let hiddenExtras: { page: number; text: string; techniques: HiddenTechnique[] }[] = [];
  if (format === "pdf") {
    if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) throw new DocumentImportError("INVALID_DOCUMENT", "文件内容不是有效 PDF，请重新导出文件。");
    const parsed = await parsePdf(bytes, signal);
    text = parsed.text;
    pageCount = parsed.pageCount;
    hiddenExtras = parsed.hiddenExtras;
    if (parsed.emptyPages) warnings.push(`${parsed.emptyPages} 页未提取到文字；图片、扫描内容和图表可能未被读取。`);
    if (parsed.ocrPages) warnings.push(`${parsed.ocrPages} 页的文字是扫描件的 OCR 文字层（不可见文字叠在页面图像上），按正常文字导入。`);
    warnings.push("仅提取 PDF 文字层；多栏、公式、表格和断行可能影响顺序，请对照原文件核对。未执行 OCR。");
  } else if (format === "docx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new DocumentImportError("INVALID_DOCUMENT", "文件内容不是有效 DOCX，请在 Word 中重新另存为 DOCX。");
    const parsed = await parseDocx(bytes, signal);
    text = parsed.text;
    warnings.push(...parsed.warnings, "仅提取 Word 正文和表格文字；图片、文本框、页眉页脚、脚注及修订删除内容不保证包含。未执行 OCR。");
  } else {
    try {
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) throw new Error("binary");
    } catch { throw new DocumentImportError("INVALID_TEXT", "TXT 不是可读取的纯文本，请另存为 UTF-8 或带 BOM 的 UTF-16 编码。"); }
    text = stripMarks(text);
  }
  throwIfAborted(signal);
  // 隐藏文字：报告并去掉读者看不见的片段（PDF / DOCX 解析器已用标记包住），再去掉 Unicode 隐形字符
  const hiddenResult = applyHiddenText(text, hiddenExtras);
  text = hiddenResult.text;
  warnings.push(...hiddenResult.warnings);
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!text) throw new DocumentImportError("NO_TEXT", "未提取到可用文字。文件可能是图片或扫描件；参考文献可截图后用「拍照 / 截图识别」。");
  if (text.length > DOCUMENT_LIMITS.characters) throw new DocumentImportError("TEXT_TOO_LONG", "文档文字超过 160,000 字符，请拆分后导入。", 413);
  const references = extractReferenceSection(text);
  if (references) warnings.push("参考文献区域根据标题识别，可能包含漏选或多选；请确认并编辑预览后再使用。");
  else warnings.push("未识别到独立的参考文献标题，可在全文预览中手动保留需要的文字。");
  return {
    text, references, warnings, hidden: hiddenResult.hidden,
    metadata: { filename: file.name.slice(0, 180), format, byteSize: file.size, characterCount: text.length, ...(pageCount === undefined ? {} : { pageCount }), extraction: format === "pdf" ? "text-layer" : format === "docx" ? "document-body" : "plain-text" },
  };
}
