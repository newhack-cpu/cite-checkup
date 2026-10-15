/** Process-local quotas, not authentication or distributed billing enforcement. */
export function createClaimLimits() {
  const hits = new Map<string, number[]>();
  let reservations: { at: number; chars: number }[] = [];
  let active = 0;
  return {
    allowRequest(ip: string): boolean {
      const now = Date.now();
      if (hits.size >= 10_000) {
        for (const [key, times] of hits) if (times.at(-1)! <= now - 60_000) hits.delete(key);
      }
      const recent = (hits.get(ip) ?? []).filter((at) => at > now - 60_000);
      if (recent.length >= 6 || !hits.has(ip) && hits.size >= 10_000) return false;
      recent.push(now);
      hits.set(ip, recent);
      return true;
    },
    reserve(modelInputChars: number): { error: string; release?: never } | { error?: never; release: () => void } {
      if (!Number.isInteger(modelInputChars) || modelInputChars < 0 || modelInputChars > 9_200) return { error: "论断与召回证据超过单次预算" };
      if (active >= 2) return { error: "证据核查已有两项任务在运行，请稍后重试" };
      const now = Date.now();
      reservations = reservations.filter((entry) => entry.at > now - 3_600_000);
      if (reservations.length >= 30) return { error: "本进程每小时 30 次证据核查限额已用完，请稍后重试" };
      if (reservations.reduce((sum, entry) => sum + entry.chars, 0) + modelInputChars > 240_000) return { error: "本进程每小时模型输入字符预算已用完，请稍后重试" };
      reservations.push({ at: now, chars: modelInputChars });
      active++;
      let released = false;
      return { release() { if (!released) { released = true; active--; } } };
    },
  };
}
