# Document text import

`DocumentImport` accepts `onImport(text)`, optional `disabled`, and `purpose: "references" | "evidence"`.
It sends one `file` through `POST /api/import`, shows editable plain text, and calls `onImport` only after the user presses the confirmation button. Confirmation explicitly replaces the caller's current text. Reference input is capped at 60,000 characters; evidence input at 160,000. There is no silent truncation.

The response is `ImportedDocument` from `types.ts`: `text`, a heuristic `references` region or `null`, `warnings`, and metadata including original filename, format, byte size, character count and PDF page count. Error responses have a stable `code` and an actionable Chinese `error` string. Original files are held only in request memory; the implementation does not persist them or send them to any AI service.

## Limits and extraction scope

- File: 8 MiB; multipart body: 8 MiB + 64 KiB, bounded before `formData` parses it; upload timeout: 15 seconds.
- PDF: Mozilla PDF.js 6.4.299, Node 22.13 or newer, maximum 100 pages; worker timeout 25 seconds, 96 MiB old-generation V8 heap plus 16 MiB young-generation heap. The decoder additionally enforces an 8 MiB maximum decoded stream capacity and a 32 MiB cumulative decoded-buffer allocation budget per document. Each growth charges the actual new capacity before allocation; unchanged buffer reuse is free. The budget is not a claim about total process RSS; a public deployment should additionally cap container/process memory and request sizes at ingress.
- PDF extraction uses only text-layer content and bundled local fonts/maps. JavaScript evaluation and network fetch are disabled in the parsing worker. Cancellation terminates the worker before releasing the request slot. It does not render or execute embedded PDF actions. Page markers are included for provenance.
- DOCX: streaming ZIP entries; at most 1,000 entries, 32 MiB declared total expansion, 8 MiB per entry, compression ratio at most 200 for entries larger than 1 MiB. Actual bytes for opened XML entries are bounded and checked against the ZIP declaration. Only selected XML parts are opened; no archive contents are written to disk.
- DOCX XML: DTD/entity declarations, unsafe/duplicate paths, encryption, macros, `altChunk`, depth above 128 or more than 200,000 elements are rejected. External relationships are reported and never fetched. Text is extracted from Word body paragraphs/tables using namespaces, excluding deleted revisions. Headers, footers, footnotes, images, equations and text boxes are not a completeness guarantee. DOCX pagination is not inferred from potentially stale Word metadata.
- TXT: UTF-8 or BOM-marked UTF-16; binary control characters and malformed encoding are rejected.
- Extracted text: 160,000 characters maximum. Scanned/image-only PDFs get an explicit no-text/OCR-needed error; no OCR or multimodal capability is claimed. Layout, table reading order and PDF line breaks require user review.
- Admission: two simultaneous imports and 12 attempts per minute per forwarded IP, within each Node process. Multi-instance/public deployments also need trusted-proxy and shared ingress limits.

## PDF decoder guard and dependency upgrades

`pdf-decoder-guard.ts` verifies the complete SHA-256 of the installed PDF.js legacy worker before appending module-scope safety hooks. It does not inspect PDF bytes with regular expressions or edit `node_modules`. Its audited hash is `bb422f60804477de4a0b09091d8347a916a387755ed1cbad24ccaec1d09c78bf` for PDF.js 6.4.299. An unknown or modified worker fails closed as `PARSER_UNAVAILABLE` (HTTP 503); the user is told that an administrator must complete the compatibility upgrade. Do not simply replace the hash after a dependency update: re-audit decoder classes, expansion paths and filter dispatch, then rerun the stream/object-stream/nested-filter and real PDF tests against the production build.

The guard wraps `DecodeStream.ensureBuffer` before each allocation, including Flate/LZW/ASCII/RunLength/predictor streams, compressed object streams and concatenated content. PDF.js's native `DecompressionStream` path is disabled in favor of its budgeted JavaScript Flate decoder. Predictor dimensions are checked before overflow-prone arithmetic. Non-budgeted Brotli and image decode paths are conservatively rejected if invoked; ordinary PDFs that contain images remain readable through their text layer. Resource limits report `PDF_RESOURCE_LIMIT` (HTTP 413), while unsupported decoding reports `PDF_UNSUPPORTED_ENCODING` (HTTP 422). A guard violation posts the error and exits the single worker immediately, preventing PDF.js recovery handlers from turning rejection into partial success.

The guarded program is written into a random private temporary directory because Next runtime loaders rejected a `data:` module URL during integration. Only parser program code is written, never uploaded document bytes or provider secrets. After worker termination, the parent unlinks that exact program file and removes the empty directory on success, failure, cancellation or timeout. These are non-recursive operations on application-created paths. A hard server process crash can leave a temporary program-code directory for the operating system's temp cleanup.

## Verification fixtures

`__tests__/fixtures/generate.py` produces synthetic fixtures locally with reportlab, pypdf and python-docx. Fixtures contain no private documents or network downloads. It covers English and Chinese PDFs, DOCX and TXT, a genuine password-encrypted PDF, no-text PDF, 101-page PDF, corrupt files, an encrypted ZIP flag, expansion, false uncompressed-size metadata, traversal, external relationships and XML entity/depth attacks. The encrypted ZIP flag fixture is a metadata guard fixture, not an actual encrypted Office file.

Run `pnpm test src/lib/documents/__tests__/import.test.ts src/app/api/import/route.test.ts` for parser and request-boundary checks. Browser confirmation/replacement checks are part of the parent integration acceptance.

`__tests__/pdf-resource.test.ts` additionally verifies a 32 MiB Flate expansion attack, nested Flate filters, compressed object-stream expansion, cumulative decoded allocations across pages, bounded ordinary content and fail-closed worker integrity. `fixtures/resource-pdf.ts` generates these real PDFs without downloading data. An independent review also covers RunLength expansion. Production verification must upload an ordinary PDF, a Chinese PDF and an expansion fixture through the actual `/api/import` route, because unit tests alone did not expose the Next module-loader difference.

Primary references: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [yauzl security and lazy entry behavior](https://github.com/thejoshwolfe/yauzl), [saxes entity behavior](https://github.com/lddubeau/saxes).
