// 拍照 / 截图识别参考文献：上传 1–4 张图片，返回 AI 转写的文字供用户对照原图核对。
// 识别不判断真伪；用户确认后的文字再走 /api/check 的规则核验。原图只在请求内存中使用，不保存。
import { checkClientIp, WindowLimit } from "@/lib/check-limits";
import { readBoundedForm } from "@/lib/documents/request";
import { DocumentImportError } from "@/lib/documents/types";
import { getVisionStatus, sniffImage, transcribeReferences, VISION_LIMITS, VisionError, type ImageFormat } from "@/lib/vision";

export const maxDuration = 90;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string, code: string) => Response.json({ error, code }, { status, headers });

// 进程内限额：每 IP 每分钟 4 次、每进程每小时 40 次、同时 2 个
const perIp = new WindowLimit(60_000, 4);
const perHour = new WindowLimit(3_600_000, 40, 1);
let active = 0;

export async function GET() {
  return Response.json(getVisionStatus(), { headers });
}

export async function POST(request: Request) {
  if (!getVisionStatus().available) return fail(503, "DeepSeek 尚未配置，暂时不能识别图片", "CONFIGURATION");
  if (!perIp.take(checkClientIp(request))) return fail(429, "识别过于频繁（每分钟最多 4 次），请稍后再试", "BUSY");
  if (active >= 2) return fail(429, "正在识别其他图片，请稍后再试", "BUSY");
  if (!perHour.take("all")) return fail(429, "本进程每小时 40 次图片识别限额已用完，请稍后再试", "BUSY");
  active++;
  try {
    const form = await readBoundedForm(request, "请使用图片选择器上传 PNG、JPG、WebP 或 GIF 图片。");
    const entries = [...form.entries()];
    if (!entries.length || entries.length > VISION_LIMITS.images || entries.some(([name, value]) => name !== "image" || !(value instanceof File))) {
      return fail(400, `每次可上传 1 至 ${VISION_LIMITS.images} 张图片`, "INVALID_IMAGE");
    }
    const images: { bytes: Uint8Array; format: ImageFormat }[] = [];
    for (const [, value] of entries) {
      const bytes = new Uint8Array(await (value as File).arrayBuffer());
      const format = sniffImage(bytes);
      if (!format) return fail(415, "只支持 PNG、JPG、WebP 和 GIF 图片；iPhone 的 HEIC 照片请先截图或转成 JPG", "INVALID_IMAGE");
      images.push({ bytes, format });
    }
    const result = await transcribeReferences(images, { signal: request.signal });
    return Response.json({ ...result, images: images.length }, { headers });
  } catch (error) {
    if (request.signal.aborted) return fail(499, "已取消识别", "CANCELLED");
    if (error instanceof VisionError) return fail(error.status, error.message, error.code);
    if (error instanceof DocumentImportError) return fail(error.status, error.message, error.code);
    return fail(500, "图片识别失败，请稍后重试", "MODEL_UNAVAILABLE");
  } finally {
    active--;
  }
}
