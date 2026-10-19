import { checkClientIp } from "@/lib/check-limits";
import { checkClaim, getClaimStatus } from "@/lib/claims";
import { createClaimLimits } from "@/lib/claims/limits";
import { ClaimRequestError, readClaimRequest } from "@/lib/claims/request";
import { createRequestDeadline } from "@/lib/request-deadline";

export const maxDuration = 90;
const limits = createClaimLimits();
const headers = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function GET() {
  return Response.json(getClaimStatus(), { headers });
}

export async function POST(request: Request) {
  const work = createRequestDeadline(request);
  let release: (() => void) | undefined;
  try {
    if (!limits.allowRequest(checkClientIp(request))) return fail(429, "请求过于频繁，请一分钟后再试");
    const input = await work.run(() => readClaimRequest(work.request));
    if (getClaimStatus().available) {
      // Reserve an upper bound before database/model I/O. Failed attempts still consume the hour budget.
      const slot = limits.reserve(input.claim.length + 7_200);
      if (slot.error) return fail(429, slot.error);
      release = slot.release;
    }
    const result = await work.run(() => checkClaim(input, { signal: work.signal }));
    return Response.json(result, { headers });
  } catch (error) {
    if (work.timedOut) return fail(504, "证据核查超时，尚未完成，请稍后重试");
    if (work.signal.aborted || error instanceof Error && error.name === "AbortError") return fail(499, "核查已取消");
    if (error instanceof ClaimRequestError) return fail(error.status, error.message);
    return fail(500, "证据核查未完成，请稍后重试");
  } finally { work.dispose(); release?.(); }
}
