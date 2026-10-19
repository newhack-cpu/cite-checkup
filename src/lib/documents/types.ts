import { UPLOAD_LIMIT_BYTES } from "../deployment-limits";
import type { HiddenTextReport } from "./hidden";

export type DocumentFormat = "pdf" | "docx" | "txt";

export interface ReferenceSection {
  text: string;
  heading: string;
  start: number;
  end: number;
}

export interface ImportedDocument {
  text: string;
  references: ReferenceSection | null;
  warnings: string[];
  /** 读者看不见、但会被 AI 读到的隐藏文字；已从 text 中去掉。没有发现时为 null */
  hidden: HiddenTextReport | null;
  metadata: {
    filename: string;
    format: DocumentFormat;
    byteSize: number;
    characterCount: number;
    pageCount?: number;
    extraction: "text-layer" | "document-body" | "plain-text";
  };
}

export const DOCUMENT_LIMITS = {
  fileBytes: UPLOAD_LIMIT_BYTES,
  requestBytes: UPLOAD_LIMIT_BYTES + 64 * 1024,
  characters: 160_000,
  pages: 100,
  pdfDecodedStreamBytes: 8 * 1024 * 1024,
  pdfDecodedTotalBytes: 32 * 1024 * 1024,
  zipEntries: 1_000,
  zipTotalBytes: 32 * 1024 * 1024,
  zipEntryBytes: 8 * 1024 * 1024,
  zipRatio: 200,
  parseMs: 25_000,
  uploadMs: 15_000,
} as const;

export type DocumentErrorCode = "UNSUPPORTED_TYPE" | "FILE_TOO_LARGE" | "INVALID_DOCUMENT" | "INVALID_TEXT" | "ENCRYPTED" | "NO_TEXT" | "TOO_MANY_PAGES" | "TEXT_TOO_LONG" | "ZIP_LIMIT" | "UNSAFE_DOCUMENT" | "CANCELLED" | "TIMEOUT" | "BUSY" | "PDF_RESOURCE_LIMIT" | "PDF_UNSUPPORTED_ENCODING" | "PARSER_UNAVAILABLE";

export class DocumentImportError extends Error {
  constructor(public readonly code: DocumentErrorCode, message: string, public readonly status = 422) {
    super(message);
    this.name = "DocumentImportError";
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DocumentImportError("CANCELLED", "已取消文档导入。", 499);
}
