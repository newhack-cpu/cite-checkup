import { SaxesParser, type SaxesTagNS } from "saxes";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import type { Readable } from "node:stream";
import { markHidden, stripMarks, type HiddenTechnique } from "./hidden";
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

// ---- 隐藏文字：Word 的隐藏格式、白色字、极小字号（含样式继承） ----

/** 与隐藏判断有关的字符格式；后出现的层级覆盖前面的 */
interface RunFormat { vanish?: boolean; color?: string; size?: number; fill?: string; highlight?: string }
interface StyleDefinition { basedOn?: string; format: RunFormat }
interface DocxStyles { defaults: RunFormat; styles: Map<string, StyleDefinition>; defaultParagraph?: string }

const attribute = (tag: SaxesTagNS, local: string) => Object.values(tag.attributes).find(a => a.local === local)?.value;
const isOn = (value: string | undefined) => !["0", "false", "off"].includes((value ?? "true").toLowerCase());
const HIGHLIGHT_DARK = new Set(["black", "blue", "darkblue", "darkcyan", "darkgray", "darkgreen", "darkmagenta", "darkred", "red", "green", "magenta"]);

/** 读取一个格式子元素（rPr 里的 vanish / color / sz / shd / highlight） */
function readFormat(tag: SaxesTagNS, format: RunFormat) {
  switch (tag.local) {
    case "vanish": format.vanish = isOn(attribute(tag, "val")); break;
    case "color": format.color = attribute(tag, "val"); break;
    case "sz": { const size = Number(attribute(tag, "val")); if (Number.isFinite(size)) format.size = size; break; }
    case "shd": format.fill = attribute(tag, "fill"); break;
    case "highlight": format.highlight = attribute(tag, "val"); break;
  }
}

function parseStyles(xml: string | undefined): DocxStyles {
  const result: DocxStyles = { defaults: {}, styles: new Map() };
  if (!xml) return result;
  try {
    readStyles(xml, result);
  } catch {
    // 样式表只用于隐藏文字检测；读不了就只看直接格式，不影响正文导入
    return { defaults: {}, styles: new Map() };
  }
  return result;
}

function readStyles(xml: string, result: DocxStyles) {
  const path: string[] = [];
  let current: StyleDefinition | undefined;
  parseXml(xml, tag => {
    path.push(WORD_NAMESPACES.has(tag.uri) ? tag.local : "");
    if (!WORD_NAMESPACES.has(tag.uri)) return;
    const parent = path.at(-2);
    if (tag.local === "style") {
      const id = attribute(tag, "styleId");
      current = { format: {} };
      if (id) result.styles.set(id, current);
      if (id && attribute(tag, "type") === "paragraph" && ["1", "true", "on"].includes((attribute(tag, "default") ?? "").toLowerCase())) result.defaultParagraph = id;
    } else if (tag.local === "basedOn" && parent === "style" && current) current.basedOn = attribute(tag, "val");
    else if (parent === "rPr" && path.at(-3) === "style" && current) readFormat(tag, current.format);
    else if (parent === "rPr" && path.at(-3) === "rPrDefault") readFormat(tag, result.defaults);
  }, tag => {
    path.pop();
    if (WORD_NAMESPACES.has(tag.uri) && tag.local === "style") current = undefined;
  });
}

function resolveStyle(id: string | undefined, styles: DocxStyles, seen = new Set<string>()): RunFormat {
  const style = id ? styles.styles.get(id) : undefined;
  if (!id || !style || seen.has(id) || seen.size > 20) return {};
  seen.add(id);
  return { ...resolveStyle(style.basedOn, styles, seen), ...style.format };
}

const hexLuminance = (hex: string | undefined) => {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function bodyText(xml: string, stylesXml?: string): string {
  let text = "";
  let inBody = false;
  let inText = false;
  let deleted = 0;
  let bodySeen = false;
  const styles = parseStyles(stylesXml);
  const path: string[] = [];
  let pageFill: string | undefined;
  const paragraphs: { style?: string; fill?: string }[] = [];
  const runs: { style?: string; format: RunFormat }[] = [];
  const cells: { fill?: string }[] = [];
  const add = (value: string) => {
    text += value;
    if (text.length > DOCUMENT_LIMITS.characters) throw new DocumentImportError("TEXT_TOO_LONG", "文档文字超过 160,000 字符，请拆分后导入。");
  };
  /** 当前文字片段的隐藏方式：隐藏格式、浅色背景上的白字、小于 2 磅的字 */
  const hiddenTechniques = (): HiddenTechnique[] => {
    const run = runs.at(-1);
    if (!run) return [];
    const paragraph = paragraphs.at(-1);
    const format = { ...styles.defaults, ...resolveStyle(paragraph?.style ?? styles.defaultParagraph, styles), ...resolveStyle(run.style, styles), ...run.format };
    const techniques: HiddenTechnique[] = [];
    if (format.vanish) techniques.push("invisible");
    const colour = hexLuminance(format.color);
    if (colour !== undefined && colour >= 0.92) {
      // 最内层的底色说了算：字符底纹 / 突出显示 > 段落底纹 > 单元格底纹 > 页面背景
      const highlight = format.highlight && format.highlight !== "none" ? format.highlight.toLowerCase() : undefined;
      const background = highlight ? (HIGHLIGHT_DARK.has(highlight) ? 0 : 1) : hexLuminance(format.fill) ?? hexLuminance(paragraph?.fill) ?? hexLuminance(cells.at(-1)?.fill) ?? hexLuminance(pageFill) ?? 1;
      if (background >= 0.5) techniques.push("white");
    }
    if (format.size !== undefined && format.size > 0 && format.size < 4) techniques.push("tiny");
    return techniques;
  };
  parseXml(xml, tag => {
    path.push(WORD_NAMESPACES.has(tag.uri) ? tag.local : "");
    if (!WORD_NAMESPACES.has(tag.uri)) return;
    const parent = path.at(-2);
    if (tag.local === "background" && parent === "document") pageFill = attribute(tag, "color");
    if (tag.local === "body") { inBody = true; bodySeen = true; }
    if (!inBody) return;
    if (tag.local === "p") paragraphs.push({});
    else if (tag.local === "r") runs.push({ format: {} });
    else if (tag.local === "tc") cells.push({});
    else if (parent === "pPr" && tag.local === "pStyle" && paragraphs.length) paragraphs.at(-1)!.style = attribute(tag, "val");
    else if (parent === "pPr" && tag.local === "shd" && paragraphs.length) paragraphs.at(-1)!.fill = attribute(tag, "fill");
    else if (parent === "tcPr" && tag.local === "shd" && cells.length) cells.at(-1)!.fill = attribute(tag, "fill");
    else if (parent === "rPr" && path.at(-3) === "r" && runs.length) {
      if (tag.local === "rStyle") runs.at(-1)!.style = attribute(tag, "val");
      else readFormat(tag, runs.at(-1)!.format);
    }
    if (tag.local === "del") deleted++;
    if (tag.local === "altChunk") throw new DocumentImportError("UNSAFE_DOCUMENT", "文档包含外部嵌入正文，请在 Word 中展开并另存为 DOCX 后导入。");
    if (deleted) return;
    if (tag.local === "t") inText = true;
    if (["br", "cr"].includes(tag.local)) add("\n");
    if (tag.local === "tab") add("\t");
  }, tag => {
    path.pop();
    if (!WORD_NAMESPACES.has(tag.uri)) return;
    if (tag.local === "t") inText = false;
    if (inBody && !deleted && ["p", "tr"].includes(tag.local)) add("\n");
    if (inBody && !deleted && tag.local === "tc") add("\t");
    if (tag.local === "p") paragraphs.pop();
    if (tag.local === "r") runs.pop();
    if (tag.local === "tc") cells.pop();
    if (tag.local === "del") deleted--;
    if (tag.local === "body") inBody = false;
  }, value => {
    if (!inBody || !inText || deleted) return;
    const clean = stripMarks(value);
    const techniques = hiddenTechniques();
    add(techniques.length ? markHidden(clean, techniques) : clean);
  });
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
    let stylesXml: string | undefined;
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
        resolve({ text: bodyText(documentXml, stylesXml), warnings: [...warnings] });
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
          const wanted = entry.fileName === "word/document.xml" || entry.fileName === "word/styles.xml" || entry.fileName.endsWith(".rels") || entry.fileName === "[Content_Types].xml";
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
                else if (entry.fileName === "word/styles.xml") stylesXml = xml;
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
