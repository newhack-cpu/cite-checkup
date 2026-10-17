import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReferenceList } from "@/lib/verify/extract";
import type { CheckEvent, ParsedRef, WorkRecord } from "@/lib/verify/types";

const ai = vi.hoisted(() => ({ status: vi.fn(), prepare: vi.fn() }));
const sources = vi.hoisted(() => ({ crossref: vi.fn(), search: vi.fn(), registry: vi.fn(), csl: vi.fn(), openalex: vi.fn(), openalexSearch: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getAIStatus: ai.status, prepareAIReferences: ai.prepare }));
vi.mock("@/lib/verify/sources/crossref", () => ({ crossrefByDoi: sources.crossref, crossrefSearch: sources.search }));
vi.mock("@/lib/verify/sources/doi", () => ({ doiRegistry: sources.registry, doiCsl: sources.csl }));
vi.mock("@/lib/verify/sources/openalex", () => ({ openalexByDoi: sources.openalex, openalexSearchTitle: sources.openalexSearch }));

const citation = "Miller, G. (1956). The magical number seven. Psychological Review, 63(2), 81–97. doi:10.1037/h0043158";
const record: WorkRecord = { source: "crossref", doi: "10.1037/h0043158", title: "The magical number seven", authors: [{ family: "Miller", given: "G." }], year: 1956, venue: "Psychological Review" };
let nextIp = 0;
function request(body: unknown, opts: { raw?: boolean; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  return new Request("http://localhost/api/check", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `192.0.2.${++nextIp}`, ...opts.headers }, body: opts.raw ? String(body) : JSON.stringify(body), signal: opts.signal });
}
async function events(response: Response): Promise<CheckEvent[]> {
  expect(response.status).toBe(200);
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
async function routes() { return import("./route"); }

// The first import has Vite transform the route's whole dependency graph; under a busy parallel run that can exceed the default 5 s.
// Load it once up front with a longer limit; each test's re-import after vi.resetModules() then reuses the transformed code.
const IMPORT_TIMEOUT = 30_000;
beforeAll(async () => { await routes(); }, IMPORT_TIMEOUT);

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  ai.status.mockReturnValue({ available: true, provider: "DeepSeek", model: "fixture-model" });
  ai.prepare.mockResolvedValue({ refs: parseReferenceList(citation), model: "fixture-model" });
  sources.crossref.mockResolvedValue({ record });
  sources.search.mockResolvedValue({ records: [] });
  sources.registry.mockResolvedValue({ exists: false });
  sources.csl.mockResolvedValue({});
  sources.openalex.mockResolvedValue({});
  sources.openalexSearch.mockResolvedValue({ records: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("/api/check request validation", () => {
  it.each([
    ["{broken", 400], ["null", 400], ["[]", 400], ['{"text":23}', 400], ['{"text":"  "}', 400],
    [JSON.stringify({ text: citation, mode: "agent" }), 400],
    [JSON.stringify({ text: citation, mode: null }), 400],
    [JSON.stringify({ text: "x".repeat(60_001) }), 413],
    [JSON.stringify({ text: "references" }), 422],
    [JSON.stringify({ text: Array.from({ length: 81 }, (_, i) => `[${i + 1}] ${citation}`).join("\n") }), 413],
  ])("rejects invalid or excessive payload case %#", async (body, status) => {
    const response = await (await routes()).POST(request(body, { raw: true }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(ai.prepare).not.toHaveBeenCalled();
    expect(sources.crossref).not.toHaveBeenCalled();
  });

  it("rejects declared oversized bodies without reading them", async () => {
    let reads = 0;
    const req = request({ text: citation }, { headers: { "content-length": "10000000" } });
    Object.defineProperty(req, "body", { get() { reads++; throw new Error("must not read"); } });
    const response = await (await routes()).POST(req);
    expect(response.status).toBe(413);
    expect(reads).toBe(0);
  });

  it("limits chunked body bytes before JSON parsing and cancels the source", async () => {
    let cancelled = false;
    let chunks = 0;
    const input = new ReadableStream<Uint8Array>({ pull(c) { if (chunks++ < 5) c.enqueue(new Uint8Array(100_000).fill(32)); else c.close(); }, cancel() { cancelled = true; } });
    const req = new Request("http://localhost/api/check", { method: "POST", body: input, duplex: "half" } as RequestInit);
    const response = await (await routes()).POST(req);
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("retains six checks per IP per minute", async () => {
    const { POST } = await routes();
    for (let i = 0; i < 6; i++) expect((await POST(request({}, { headers: { "x-forwarded-for": "192.0.2.250" } }))).status).toBe(400);
    expect((await POST(request({ text: citation }, { headers: { "x-forwarded-for": "192.0.2.250" } }))).status).toBe(429);
  });
});

describe("/api/check AI orchestration", () => {
  it("exposes only safe AI status fields", async () => {
    ai.status.mockReturnValue({ available: true, provider: "DeepSeek", model: "fixture-model", apiKey: "secret-fixture", baseURL: "https://private.invalid" });
    const response = await (await routes()).GET();
    expect(await response.json()).toEqual({ available: true, provider: "DeepSeek", model: "fixture-model" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("standard mode skips AI and returns real engine results and concern counts", async () => {
    sources.crossref.mockResolvedValue({ record: { ...record, retraction: { status: "concern", source: "publisher" } } });
    const output = await events(await (await routes()).POST(request({ text: citation })));
    expect(ai.prepare).not.toHaveBeenCalled();
    expect(output.find((event) => event.type === "result")).toMatchObject({ result: { verdict: "concern" } });
    expect(output.at(-1)).toMatchObject({ type: "done", stats: { total: 1, counts: { concern: 1, retracted: 0, verified: 0 } } });
    expect(output.some((event) => event.type === "phase" && event.phase === "verify")).toBe(true);
  });

  it("executes AI-selected validated references through the real verification engine", async () => {
    const refs: ParsedRef[] = [{ ...parseReferenceList(citation)[0], venueGuess: undefined }];
    ai.prepare.mockResolvedValue({ refs, model: "fixture-model" });
    const output = await events(await (await routes()).POST(request({ text: citation, mode: "ai" })));
    expect(output.find((event) => event.type === "meta")).toMatchObject({ refs: [{ index: 1, raw: citation }] });
    expect(output.find((event) => event.type === "result")).toMatchObject({ result: { verdict: "verified", match: { doi: "10.1037/h0043158" } } });
    const resultEvent = output.find((event) => event.type === "result");
    expect(resultEvent?.type === "result" && resultEvent.result.parsed.venueGuess).toBeUndefined();
    expect(output.some((event) => event.type === "phase" && event.phase === "extract")).toBe(true);
    expect(output.at(-1)).toMatchObject({ type: "done", stats: { counts: { verified: 1, concern: 0 } } });
  });

  it.each(["missing-key", "provider-error", "rejected-tool"])("explicitly falls back for %s", async (reason) => {
    if (reason === "missing-key") ai.status.mockReturnValue({ available: false, provider: "DeepSeek", model: "fixture-model" });
    else ai.prepare.mockRejectedValue(new Error(reason === "rejected-tool" ? "工具参数缺少原文证据" : "upstream secret-fixture failed"));
    const output = await events(await (await routes()).POST(request({ text: citation, mode: "ai" })));
    expect(output.find((event) => event.type === "notice")).toMatchObject({ message: expect.stringMatching(/标准|规则/) });
    expect(JSON.stringify(output)).not.toContain("secret-fixture");
    expect(output.find((event) => event.type === "result")).toMatchObject({ result: { verdict: "verified" } });
    if (reason === "missing-key") expect(ai.prepare).not.toHaveBeenCalled();
  });

  it("applies the smaller AI input budget while still completing standard verification", async () => {
    const output = await events(await (await routes()).POST(request({ text: `${citation} ${"x".repeat(20_000)}`, mode: "ai" })));
    expect(ai.prepare).not.toHaveBeenCalled();
    expect(output.find((event) => event.type === "notice")).toMatchObject({ message: expect.stringMatching(/标准|规则/) });
    expect(output.at(-1)?.type).toBe("done");
  });

  it("falls back after the per-IP AI allowance is exhausted", async () => {
    const { POST } = await routes();
    for (let i = 0; i < 2; i++) await events(await POST(request({ text: citation, mode: "ai" }, { headers: { "x-forwarded-for": "192.0.2.249" } })));
    const output = await events(await POST(request({ text: citation, mode: "ai" }, { headers: { "x-forwarded-for": "192.0.2.249" } })));
    expect(ai.prepare).toHaveBeenCalledTimes(2);
    expect(output.find((event) => event.type === "notice")).toMatchObject({ message: expect.stringMatching(/限额|频繁/) });
    expect(output.at(-1)?.type).toBe("done");
  });
});

describe("/api/check stream termination", () => {
  it("propagates reader cancellation to AI without starting fallback verification", async () => {
    let signal: AbortSignal | undefined;
    ai.prepare.mockImplementation((_text, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal!.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const response = await (await routes()).POST(request({ text: citation, mode: "ai" }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal?.aborted).toBe(true);
    expect(sources.crossref).not.toHaveBeenCalled();
  });

  it("does not turn extraction abort errors into a successful fallback", async () => {
    ai.prepare.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const output = await events(await (await routes()).POST(request({ text: citation, mode: "ai" })));
    expect(output.some((event) => event.type === "done" || event.type === "notice" || event.type === "result")).toBe(false);
    expect(sources.crossref).not.toHaveBeenCalled();
  });

  it("propagates request abort while verifying and never emits done", async () => {
    const controller = new AbortController();
    const engine = await import("@/lib/verify/verify");
    let signal: AbortSignal | undefined;
    vi.spyOn(engine, "verifyAll").mockImplementation(async (_refs, _onResult, opts) => {
      signal = (opts as { signal?: AbortSignal }).signal;
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
    });
    const response = await (await routes()).POST(request({ text: citation }, { signal: controller.signal }));
    controller.abort();
    const output = await events(response);
    expect(signal?.aborted).toBe(true);
    expect(output.some((event) => event.type === "done")).toBe(false);
  });

  it("reports fatal engine failures without claiming a completed report", async () => {
    const engine = await import("@/lib/verify/verify");
    let signal: AbortSignal | undefined;
    vi.spyOn(engine, "verifyAll").mockImplementation(async (_refs, _onResult, opts) => {
      signal = opts?.signal;
      throw new Error("engine invariant failed");
    });
    const output = await events(await (await routes()).POST(request({ text: citation })));
    expect(output.at(-1)).toMatchObject({ type: "fatal", message: expect.any(String) });
    expect(output.some((event) => event.type === "done")).toBe(false);
    expect(signal?.aborted).toBe(true);
  });

  it("does not emit done if the engine resolves with missing results", async () => {
    const engine = await import("@/lib/verify/verify");
    vi.spyOn(engine, "verifyAll").mockResolvedValue(undefined);
    const output = await events(await (await routes()).POST(request({ text: citation })));
    expect(output.at(-1)?.type).toBe("fatal");
    expect(output.some((event) => event.type === "done")).toBe(false);
  });
});
