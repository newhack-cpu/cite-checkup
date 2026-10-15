import { describe, expect, it } from "vitest";
import { readCheckRequest } from "../check-request";

describe("bounded request decoding", () => {
  it("accepts a full character allowance encoded as JSON escapes", async () => {
    const request = new Request("https://example.invalid", { method: "POST", body: '{"text":"' + "\\u4e2d".repeat(60_000) + '"}' });
    const result = await readCheckRequest(request);
    expect(result.text).toHaveLength(60_000);
    expect(result.text.startsWith("中")).toBe(true);
    expect(result.mode).toBe("standard");
  });

  it("rejects invalid UTF-8 instead of silently replacing citation characters", async () => {
    const request = new Request("https://example.invalid", { method: "POST", body: new Uint8Array([123, 34, 116, 101, 120, 116, 34, 58, 34, 255, 34, 125]) });
    await expect(readCheckRequest(request)).rejects.toMatchObject({ status: 400 });
  });

  it("cancels a pending request body read when its signal aborts", async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const controller = new AbortController();
    const request = new Request("https://example.invalid", { method: "POST", body: source, signal: controller.signal, duplex: "half" } as RequestInit);
    const pending = readCheckRequest(request);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 499 });
    expect(cancelled).toBe(true);
  });
});
