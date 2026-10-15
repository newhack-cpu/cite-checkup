import { createHash } from "node:crypto";
import { DOCUMENT_LIMITS, DocumentImportError } from "./types";

// Reviewed PDF.js 6.4.299 legacy worker. Never apply internal hooks to unknown code.
export const PDF_WORKER_SHA256 = "bb422f60804477de4a0b09091d8347a916a387755ed1cbad24ccaec1d09c78bf";

/** Append audited hooks inside the worker module scope; never mutate node_modules. */
export function guardPdfWorkerSource(source: string): string {
  if (createHash("sha256").update(source).digest("hex") !== PDF_WORKER_SHA256) {
    throw new DocumentImportError("PARSER_UNAVAILABLE", "PDF 解析库版本发生变化，需要管理员完成安全兼容升级后才能导入。", 503);
  }
  return source + String.raw`

// Cite Checkup's reviewed decoder budget. All checks precede buffer allocation.
{
  const perStream = ${DOCUMENT_LIMITS.pdfDecodedStreamBytes};
  const totalBudget = ${DOCUMENT_LIMITS.pdfDecodedTotalBytes};
  let allocated = 0;
  const stop = (code = 'PDF_RESOURCE_LIMIT') => globalThis.__citePdfAbort(code);
  const originalEnsure = DecodeStream.prototype.ensureBuffer;
  DecodeStream.prototype.ensureBuffer = function(requested) {
    if (!Number.isSafeInteger(requested) || requested < 0 || requested > perStream) stop();
    if (requested <= this.buffer.byteLength) return this.buffer;
    let capacity = this.minBufferLength;
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > perStream) stop();
    while (capacity < requested) capacity *= 2;
    // Charge actual new capacity, including growth copies; unchanged reuse is free.
    if (capacity > perStream || allocated + capacity > totalBudget) stop();
    allocated += capacity;
    return originalEnsure.call(this, requested);
  };

  // Native DecompressionStream accumulates unbounded external buffers. Returning
  // null selects PDF.js's existing JS Flate path, now guarded at each expansion.
  FlateStream.prototype.asyncGetBytes = async function() { return null; };
  DecodeStream.prototype.asyncGetBytesFromDecompressionStream = async function() { stop('PDF_UNSUPPORTED_ENCODING'); };

  // These image/Brotli decoders allocate outside ensureBuffer. Text import never
  // needs image decoding. Preserve ordinary image-bearing PDFs but reject any
  // attempt to decode an image stream as text/font data, and reject Brotli.
  for (const decoder of [JpegStream, JpxStream, Jbig2Stream, CCITTFaxStream]) {
    decoder.prototype.decodeImage = function() { stop('PDF_UNSUPPORTED_ENCODING'); };
    decoder.prototype.readBlock = function() { stop('PDF_UNSUPPORTED_ENCODING'); };
  }
  BrotliStream.prototype.readBlock = function() { stop('PDF_UNSUPPORTED_ENCODING'); };
  BrotliStream.prototype.asyncGetBytes = async function() { stop('PDF_UNSUPPORTED_ENCODING'); };

  const safeFilters = new Set(['Fl', 'FlateDecode', 'LZW', 'LZWDecode', 'A85', 'ASCII85Decode', 'AHx', 'ASCIIHexDecode', 'RL', 'RunLengthDecode', 'Crypt', 'DCT', 'DCTDecode', 'JPX', 'JPXDecode', 'JBIG2Decode', 'CCF', 'CCITTFaxDecode']);
  const originalFilter = Parser.prototype.makeFilter;
  Parser.prototype.makeFilter = function(stream, name, maybeLength, params, cipherTransform) {
    if (!safeFilters.has(name)) stop('PDF_UNSUPPORTED_ENCODING');
    if (maybeLength != null && (!Number.isSafeInteger(maybeLength) || maybeLength < 0 || maybeLength > perStream)) stop();
    // Predictor row buffers depend on untrusted dimensions. Validate before the
    // constructor's bitwise calculations can wrap or allocate auxiliary arrays.
    if (params instanceof Dict && ['Fl', 'FlateDecode', 'LZW', 'LZWDecode'].includes(name)) {
      const colors = params.get('Colors') || 1;
      const bits = params.get('BPC', 'BitsPerComponent') || 8;
      const columns = params.get('Columns') || 1;
      if (!Number.isSafeInteger(colors) || colors < 1 || colors > 32 || ![1, 2, 4, 8, 16].includes(bits) || !Number.isSafeInteger(columns) || columns < 1 || colors * bits * columns > perStream * 8) stop();
    }
    return originalFilter.call(this, stream, name, maybeLength, params, cipherTransform);
  };
}
`;
}
