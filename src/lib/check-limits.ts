const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_IPS = 10_000;

/** Process-local only. Full maps reject new identities until an entry expires. */
class WindowLimit {
  private readonly hits = new Map<string, number[]>();
  private sweptAt = 0;

  constructor(private readonly duration: number, private readonly maximum: number, private readonly capacity = MAX_IPS) {}

  take(key: string, now = Date.now()): boolean {
    if (now - this.sweptAt >= this.duration || this.hits.size >= this.capacity) {
      for (const [entry, times] of this.hits) {
        if (times[times.length - 1] <= now - this.duration) this.hits.delete(entry);
      }
      this.sweptAt = now;
    }
    const recent = (this.hits.get(key) ?? []).filter((time) => time > now - this.duration);
    if (recent.length >= this.maximum || (!this.hits.has(key) && this.hits.size >= this.capacity)) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export function createCheckLimits() {
  const checks = new WindowLimit(MINUTE, 6);
  const aiPerIp = new WindowLimit(MINUTE, 2);
  const aiTotal = new WindowLimit(HOUR, 30, 1);
  let aiActive = 0;
  return {
    allowCheck(ip: string) { return checks.take(ip); },
    reserveAI(ip: string, chars: number): { notice: string; release?: never } | { notice?: never; release: () => void } {
      if (chars > 20_000) return { notice: "AI 单次解析限额为 20,000 字符，本次已改用标准规则核验。" };
      if (aiActive >= 2) return { notice: "AI 当前并发额度已满，本次已改用标准规则核验。" };
      if (!aiPerIp.take(ip)) return { notice: "AI 请求过于频繁（每分钟最多 2 次），本次已改用标准规则核验。" };
      if (!aiTotal.take("all")) return { notice: "AI 本进程每小时 30 次调用限额已用完，本次已改用标准规则核验。" };
      aiActive++;
      let released = false;
      return { release() { if (!released) { released = true; aiActive--; } } };
    },
  };
}

/** Only trust this header when the deployment proxy overwrites client values. */
export function checkClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded && forwarded.length <= 64 ? forwarded : "local";
}
