import { describe, expect, it } from "vitest";
import { readCheckStream } from "../check-stream";
import { parseReference } from "../verify/extract";
import type { CheckEvent, RefResult } from "../verify/types";

const ref = parseReference("Miller, G. (1956). The magical number seven. Psychological Review.", 1);
const result: RefResult = { index: 1, raw: ref.raw, parsed: ref, verdict: "verified", confidence: 0.9, summary: "已核实", issues: [], notes: [], fields: [], steps: [] };
const meta: CheckEvent = { type: "meta", total: 1, refs: [ref] };
const done: CheckEvent = { type: "done", stats: { total: 1, counts: { verified: 1, mismatch: 0, near_match: 0, not_found: 0, retracted: 0, concern: 0, unverifiable: 0, error: 0 }, ms: 15 } };
function stream(text: string, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize)); c.close(); } });
}
const lines = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n");

describe("readCheckStream", () => {
  it("preserves UTF-8 across chunks and handles the final line without a newline", async () => {
    const events: CheckEvent[] = [];
    await readCheckStream(stream(lines(meta, { type: "result", result }, done), 1), (e) => events.push(e));
    expect(events).toEqual([meta, { type: "result", result }, done]);
  });
  it("rejects EOF without done even when a result was received", async () => {
    await expect(readCheckStream(stream(lines(meta, { type: "result", result })), () => {})).rejects.toThrow(/中断|不完整/);
  });
  it("rejects a done event with missing results", async () => {
    await expect(readCheckStream(stream(lines(meta, done)), () => {})).rejects.toThrow(/不完整|数量/);
  });
  it("rejects an incorrect count rather than presenting a complete report", async () => {
    const wrong = { ...done, stats: { ...done.stats, counts: { ...done.stats.counts, verified: 0, mismatch: 1 } } };
    await expect(readCheckStream(stream(lines(meta, { type: "result", result }, wrong)), () => {})).rejects.toThrow(/数量|统计/);
  });
  it("accepts near matches, and older servers that omit zero-count categories", async () => {
    const near = { ...result, verdict: "near_match" as const };
    const counted = { ...done, stats: { ...done.stats, counts: { ...done.stats.counts, verified: 0, near_match: 1 } } };
    await expect(readCheckStream(stream(lines(meta, { type: "result", result: near }, counted)), () => {})).resolves.toBeUndefined();
    const older = { ...done, stats: { ...done.stats, counts: { verified: 1, mismatch: 0, not_found: 0, retracted: 0, unverifiable: 0, error: 0 } } };
    await expect(readCheckStream(stream(lines(meta, { type: "result", result }, older)), () => {})).resolves.toBeUndefined();
  });
  it("rejects a near match that the summary counts as wrong information", async () => {
    const near = { ...result, verdict: "near_match" as const };
    const wrong = { ...done, stats: { ...done.stats, counts: { ...done.stats.counts, verified: 0, mismatch: 1 } } };
    await expect(readCheckStream(stream(lines(meta, { type: "result", result: near }, wrong)), () => {})).rejects.toThrow(/统计/);
  });
  it("rejects duplicated results and unknown reference indices", async () => {
    await expect(readCheckStream(stream(lines(meta, { type: "result", result }, { type: "result", result }, done)), () => {})).rejects.toThrow(/重复/);
    await expect(readCheckStream(stream(lines(meta, { type: "result", result: { ...result, index: 4 } }, done)), () => {})).rejects.toThrow(/序号/);
  });
  it("rejects malformed protocol frames and surfaces fatal errors", async () => {
    await expect(readCheckStream(stream(lines(meta) + "\n{broken"), () => {})).rejects.toThrow(/格式/);
    await expect(readCheckStream(stream(lines(meta, { type: "fatal", message: "数据源断开" })), () => {})).rejects.toThrow("数据源断开");
  });
  it("delivers progress and fallback notices before references", async () => {
    const events: CheckEvent[] = [];
    await readCheckStream(stream(lines({ type: "phase", phase: "extract", message: "解析中" }, { type: "notice", message: "已回退" }, meta, { type: "result", result }, done)), (e) => events.push(e));
    expect(events[0].type).toBe("phase");
    expect(events[1].type).toBe("notice");
  });
});
