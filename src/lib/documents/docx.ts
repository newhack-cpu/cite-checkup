import { SaxesParser, type SaxesTagNS } from "saxes";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import type { Readable } from "node:stream";
import { DOCUMENT_LIMITS, DocumentImportError, throwIfAborted } from "./types";

const WORD_NAMESPACES = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);

function parseXml(xml: string, onOpen: (tag: SaxesTagNS) => void, onClose?: (tag: SaxesTagNS) => void, onText?: (text: string) => void) {
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let elements = 0;
  parser.on("doctype", () => { throw new DocumentImportError("UNSAFE_DOCUMENT", "文档包含不支持的 XML 实体声明，请重新另存为 DOCX 后导入。"); });
  parser.on("opentag", tag => {
    if (++depth > 128 || ++elements > 200_000) throw new DocumentImportError("UNSAFE_DOCUMENT", "DOCX 的 XML 结构过于复杂，请拆分或重新另存文件。");
    onOpen(tag);
  });
  parser.on("closetag", tag => { onClose?.(tag); depth--; });
  if (onText) { parser.on("text", onText); parser.on("cdata", onText); }
  parser.write(xml).close();
}

function bodyText(xml: string): string {
  let text = "";
  let inBody = false;
  let inText = false;
  let deleted = 0;
  let bodySeen = false;
  const add = (value: string) => {
    text += value;
    if (text.length > DOCUMENT_LIMITS.characters) throw new DocumentImportError("TEXT_TOO_LONG", "文档文字超过 160,000 字符，请拆分后导入。");
  };
  parseXml(xml, tag => {
    if (!WORD_NAMESPACES.has(tag.uri)) return;
    if (tag.local === "body") { inBody = true; bodySeen = true; }
    if (!inBody) return;
    if (tag.local === "del") deleted++;
    if (tag.local === "altChunk") throw new DocumentImportError("UNSAFE_DOCUMENT", "文档包含外部嵌入正文，请在 Word 中展开并另存为 DOCX 后导入。");
    if (deleted) return;
    if (tag.local === "t") inText = true;
    if (["br", "cr"].includes(tag.local)) add("\n");
    if (tag.local === "tab") add("\t");
  }, tag => {
    if (!WORD_NAMESPACES.has(tag.uri)) return;
    if (tag.local === "t") inText = false;
    if (inBody && !deleted && ["p", "tr"].includes(tag.local)) add("\n");
    if (inBody && !deleted && tag.local === "tc") add("\t");
    if (tag.local === "del") deleted--;
    if (tag.local === "body") inBody = false;
  }, value => { if (inBody && inText && !deleted) add(value); });
  if (!bodySeen) throw new DocumentImportError("INVALID_DOCUMENT", "DOCX 缺少有效正文，请重新另存为 DOCX 后导入。");
  return text;
}

export function parseDocx(bytes: Uint8Array, signal?: AbortSignal): Promise<{ text: string; warnings: string[] }> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let zip: ZipFile | undefined;
    let stream: Readable | undefined;
    let settled = false;
    let total = 0;
    let entries = 0;
    let documentXml: string | undefined;
    let hasContentTypes = false;
    const names = new Set<string>();
    const warnings = new Set<string>();
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      stream?.destroy();
      zip?.close();
      if (error) {
        if (error instanceof DocumentImportError) reject(error);
        else if (error instanceof Error && /invalid relative path|absolute path|backslash/i.test(error.message)) reject(new DocumentImportError("UNSAFE_DOCUMENT", "DOCX 压缩包包含不安全的文件路径，无法导入。"));
        else if (error instanceof Error && /too many bytes|not enough bytes|uncompressed size|uncompressedSize/i.test(error.message)) reject(new DocumentImportError("ZIP_LIMIT", "DOCX 实际解压体积与声明不一致，请重新另存文件。"));
        else reject(new DocumentImportError("INVALID_DOCUMENT", "无法读取 DOCX；文件可能损坏、加密或并非 Word 文档。请重新另存为 DOCX。"));
        return;
      }
      try {
        if (!hasContentTypes || documentXml === undefined) throw new DocumentImportError("INVALID_DOCUMENT", "文件缺少 DOCX 正文结构，请在 Word 中重新另存为 DOCX。");
        resolve({ text: bodyText(documentXml), warnings: [...warnings] });
      } catch (error) { reject(error instanceof DocumentImportError ? error : new DocumentImportError("INVALID_DOCUMENT", "DOCX 正文 XML 损坏，请重新另存文件。")); }
    };
    const onAbort = () => finish(new DocumentImportError("CANCELLED", "已取消文档导入。", 499));
    const timer = setTimeout(() => finish(new DocumentImportError("TIMEOUT", "DOCX 解析超时，请拆分文件后重试。", 408)), DOCUMENT_LIMITS.parseMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => {
      if (settled) { archive?.close(); return; }
      if (error || !archive) { finish(error ?? new Error("Missing ZIP")); return; }
      zip = archive;
      zip.on("error", finish);
      zip.on("end", () => finish());
      zip.on("entry", (entry: Entry) => {
        if (settled) return;
        try {
          throwIfAborted(signal);
          entries++;
          total += entry.uncompressedSize;
          if (entries > DOCUMENT_LIMITS.zipEntries || total > DOCUMENT_LIMITS.zipTotalBytes || entry.uncompressedSize > DOCUMENT_LIMITS.zipEntryBytes || (entry.uncompressedSize > 1024 * 1024 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > DOCUMENT_LIMITS.zipRatio)) throw new DocumentImportError("ZIP_LIMIT", "DOCX 解压后过大或压缩比例异常，请拆分或重新另存文件。");
          if (names.has(entry.fileName) || /(?:^|\/)\.\.(?:\/|$)|^[\\/]|^[a-z]:/i.test(entry.fileName)) throw new DocumentImportError("UNSAFE_DOCUMENT", "DOCX 压缩包包含重复或不安全的文件路径，无法导入。");
          names.add(entry.fileName);
          if (entry.isEncrypted()) throw new DocumentImportError("ENCRYPTED", "DOCX 已加密。请先在本地解密，再导入。");
          if (/vbaProject\.bin$/i.test(entry.fileName)) throw new DocumentImportError("UNSAFE_DOCUMENT", "不支持含宏的 Word 文件，请另存为普通 DOCX 后导入。");
          if (entry.fileName === "[Content_Types].xml") hasContentTypes = true;
          const wanted = entry.fileName === "word/document.xml" || entry.fileName.endsWith(".rels") || entry.fileName === "[Content_Types].xml";
          if (!wanted) { zip!.readEntry(); return; }
          zip!.openReadStream(entry, (streamError, readStream) => {
            if (settled) { readStream?.destroy(); return; }
            if (streamError || !readStream) { finish(streamError ?? new Error("Missing entry")); return; }
            stream = readStream;
            const chunks: Buffer[] = [];
            let size = 0;
            readStream.on("error", finish);
            readStream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > DOCUMENT_LIMITS.zipEntryBytes || size > entry.uncompressedSize) { finish(new DocumentImportError("ZIP_LIMIT", "DOCX 实际解压体积超出安全限制，请重新另存文件。")); return; }
              chunks.push(chunk);
            });
            readStream.on("end", () => {
              if (settled) return;
              try {
                const xml = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
                if (entry.fileName === "word/document.xml") documentXml = xml;
                else parseXml(xml, tag => {
                  if (Object.values(tag.attributes).some(attribute => attribute.local === "TargetMode" && attribute.value.toLowerCase() === "external")) warnings.add("文档含外部引用；未访问链接、远程图片或外部文件，仅提取已嵌入正文的文字。");
                });
                zip!.readEntry();
              } catch (error) { finish(error); }
            });
          });
        } catch (error) { finish(error); }
      });
      zip.readEntry();
    });
    if (signal?.aborted) onAbort();
  });
}
