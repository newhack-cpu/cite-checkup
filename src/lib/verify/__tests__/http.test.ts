import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("JSON upstream integrity", () => {
  it("does not cache a malformed 200 response", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", async () => ++attempt === 1
      ? new Response("not JSON", { status: 200 })
      : Response.json({ valid: true }));
    const { getJson, UpstreamError } = await import("../http");
    await expect(getJson("https://metadata.example/work", { retries: 0 })).rejects.toBeInstanceOf(UpstreamError);
    await expect(getJson("https://metadata.example/work")).resolves.toMatchObject({ json: { valid: true } });
  });

  it("passes cancellation to a running request without retrying", async () => {
    const controller = new AbortController();
    let calls = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls++;
      controller.abort();
      init.signal?.throwIfAborted();
      return Response.json({ valid: true });
    });
    const { getJson } = await import("../http");
    await expect(getJson("https://metadata.example/work", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
