import { importDocument } from "@/lib/documents/import";
import { readDocumentUpload } from "@/lib/documents/request";
import { DocumentImportError } from "@/lib/documents/types";

export const maxDuration = 45;

// These bounds are process-local; a multi-instance deployment also needs an ingress limit.
let active = 0;
const attempts = new Map<string, { start: number; count: number }>();
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function admit(request: Request) {
  const now = Date.now();
  const key = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local").slice(0, 80);
  for (const [ip, value] of attempts) if (now - value.start >= 60_000) attempts.delete(ip);
  const previous = attempts.get(key);
  const next = previous ? { ...previous, count: previous.count + 1 } : { start: now, count: 1 };
  if (attempts.size >= 512 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
  attempts.set(key, next);
  if (next.count > 12) throw new DocumentImportError("BUSY", "导入过于频繁，请一分钟后重试。", 429);
  if (active >= 2) throw new DocumentImportError("BUSY", "正在处理其他文档，请稍后重试。", 429);
  active++;
}

export async function POST(request: Request) {
  let admitted = false;
  try {
    admit(request);
    admitted = true;
    const file = await readDocumentUpload(request);
    const result = await importDocument(file, request.signal);
    return Response.json(result, { headers });
  } catch (error) {
    const known = error instanceof DocumentImportError ? error : new DocumentImportError("INVALID_DOCUMENT", "导入失败，请重新导出文件后重试。");
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers: { ...headers, ...(known.status === 429 ? { "Retry-After": "60" } : {}) } });
  } finally { if (admitted) active--; }
}
