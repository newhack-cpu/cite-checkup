import type { CheckEvent, Verdict } from "./verify/types";

const VERDICTS: Verdict[] = ["verified", "mismatch", "not_found", "retracted", "concern", "unverifiable", "error"];
const malformed = () => new Error("核查响应格式不正确，请重试");

/** A closed connection is not a completed report: require a consistent terminal frame. */
export async function readCheckStream(stream: ReadableStream<Uint8Array>, onEvent: (event: CheckEvent) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let completed = false;
  let indices: Set<number> | undefined;
  const received = new Map<number, Verdict>();

  function accept(line: string) {
    if (!line.trim()) return;
    if (completed) throw malformed();
    let event: CheckEvent;
    try { event = JSON.parse(line) as CheckEvent; } catch { throw malformed(); }
    if (!event || typeof event !== "object") throw malformed();
    switch (event.type) {
      case "phase":
        if (!["extract", "verify"].includes(event.phase) || typeof event.message !== "string") throw malformed();
        break;
      case "notice":
        if (typeof event.message !== "string") throw malformed();
        break;
      case "fatal":
        throw new Error(typeof event.message === "string" ? event.message : "核查中断，请重试");
      case "meta":
        if (indices || !Array.isArray(event.refs) || event.total < 1 || event.total > 80 || event.refs.length !== event.total || event.refs.some(r => !r || !Number.isInteger(r.index) || typeof r.raw !== "string")) throw malformed();
        indices = new Set(event.refs.map(r => r.index));
        if (indices.size !== event.total) throw malformed();
        break;
      case "result": {
        const r = event.result;
        if (!r || !indices?.has(r.index)) throw new Error("核查结果序号不正确");
        if (received.has(r.index)) throw new Error("收到重复核查结果");
        if (!VERDICTS.includes(r.verdict) || typeof r.summary !== "string" || typeof r.confidence !== "number" || !Array.isArray(r.fields) || !Array.isArray(r.steps) || !Array.isArray(r.issues) || !Array.isArray(r.notes)) throw malformed();
        received.set(r.index, r.verdict);
        break;
      }
      case "done": {
        if (!indices || !event.stats || event.stats.total !== indices.size || received.size !== indices.size) throw new Error("核查结果数量不完整，请重试");
        if (!event.stats.counts || !Number.isFinite(event.stats.ms)) throw malformed();
        for (const verdict of VERDICTS) {
          const actual = [...received.values()].filter(v => v === verdict).length;
          // Older servers may omit the newly introduced concern category when it is zero.
          if ((event.stats.counts[verdict] ?? 0) !== actual) throw new Error("核查统计数量不一致，请重试");
        }
        completed = true;
        break;
      }
      default: throw malformed();
    }
    onEvent(event);
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8_000_000) throw new Error("核查响应过大，请减少条目后重试");
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) { accept(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
      if (buffer.length > 1_000_000) throw malformed();
    }
    buffer += decoder.decode();
    accept(buffer);
    if (!completed) throw new Error("核查连接中断，报告不完整，请重试");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
