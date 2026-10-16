import { DOCUMENT_LIMITS, DocumentImportError, throwIfAborted } from "./types";

/** Read a bounded wire body before allowing the multipart parser to allocate. */
export async function readDocumentUpload(request: Request): Promise<File> {
  const form = await readBoundedForm(request, "请使用文件选择器上传 PDF、DOCX 或 TXT。");
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0][0] !== "file" || !(entries[0][1] instanceof File)) throw new DocumentImportError("INVALID_DOCUMENT", "每次仅支持上传一个文件，请重新选择。", 400);
  return entries[0][1];
}

/** 先按字节上限读完请求体，再交给 multipart 解析；允许哪些字段由调用方检查。 */
export async function readBoundedForm(request: Request, typeHint: string): Promise<FormData> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > DOCUMENT_LIMITS.requestBytes)) throw new DocumentImportError("FILE_TOO_LARGE", "上传请求过大，文件最多 8 MiB。", 413);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new DocumentImportError("INVALID_DOCUMENT", typeHint, 400);
  throwIfAborted(request.signal);
  if (!request.body) throw new DocumentImportError("INVALID_DOCUMENT", "上传内容为空，请重新选择文件。", 400);
  const reader = request.body.getReader();
  let timedOut = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, DOCUMENT_LIMITS.uploadMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      throwIfAborted(request.signal);
      const { done, value } = await reader.read();
      throwIfAborted(request.signal);
      if (timedOut) throw new DocumentImportError("TIMEOUT", "文件上传超时，请检查网络或减小文件后重试。", 408);
      if (done) break;
      size += value.byteLength;
      if (size > DOCUMENT_LIMITS.requestBytes) throw new DocumentImportError("FILE_TOO_LARGE", "上传请求过大，文件最多 8 MiB。", 413);
      chunks.push(value);
    }
  } catch (error) {
    cancel();
    if (error instanceof DocumentImportError) throw error;
    throw new DocumentImportError("INVALID_DOCUMENT", "文件上传中断，请重新选择文件。", 400);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    throwIfAborted(request.signal);
    return form;
  } catch (error) {
    if (error instanceof DocumentImportError) throw error;
    throw new DocumentImportError("INVALID_DOCUMENT", "上传格式不完整，请重新选择文件。", 400);
  }
}
