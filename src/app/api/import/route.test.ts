import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

// A real PDF parse starts a fresh worker that loads PDF.js; under a busy parallel run that can exceed the default 5 s.
// Above parsePdf's own 25 s limit, so a hung parse still fails with its TIMEOUT error rather than a bare test timeout.
const PDF_TIMEOUT = 30_000;

beforeEach(() => vi.resetModules());
async function route() { return import("./route"); }
function multipart(file: File) {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/import", { method: "POST", body: form });
}

describe("/api/import", () => {
  it("returns text, metadata and warnings for an actual PDF upload", async () => {
    const file = new File([new Uint8Array(await readFile(new URL("../../../lib/documents/__tests__/fixtures/paper.pdf", import.meta.url)))], "paper.pdf");
    const response = await (await route()).POST(multipart(file));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ text: expect.stringContaining("Miller"), metadata: { format: "pdf", pageCount: 2 }, warnings: expect.any(Array) });
  }, PDF_TIMEOUT);

  it("rejects invalid form requests and duplicate files", async () => {
    const { POST } = await route();
    expect((await POST(new Request("http://localhost/api/import", { method: "POST", body: "bad" }))).status).toBe(400);
    const form = new FormData();
    form.append("file", new File(["hello"], "one.txt"));
    form.append("file", new File(["world"], "two.txt"));
    expect((await POST(new Request("http://localhost/api/import", { method: "POST", body: form }))).status).toBe(400);
  });

  it("rejects oversized content-length before reading any bytes", async () => {
    const request = multipart(new File(["hello"], "paper.txt"));
    request.headers.set("content-length", "999999999");
    Object.defineProperty(request, "body", { get() { throw new Error("must not read oversized body"); } });
    expect((await (await route()).POST(request)).status).toBe(413);
  });

  it("bounds chunked uploads before multipart parsing and cancels the source", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
    const request = new Request("http://localhost/api/import", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=fixture" }, duplex: "half" } as RequestInit);
    expect((await (await route()).POST(request)).status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it("limits parallel imports and releases slots on cancellation", async () => {
    const { POST } = await route();
    const makePending = () => {
      const controller = new AbortController();
      const stream = new ReadableStream<Uint8Array>({ start() {} });
      const request = new Request("http://localhost/api/import", { method: "POST", body: stream, signal: controller.signal, headers: { "content-type": "multipart/form-data; boundary=fixture" }, duplex: "half" } as RequestInit);
      return { controller, promise: POST(request) };
    };
    const first = makePending();
    const second = makePending();
    expect((await POST(multipart(new File(["hello"], "paper.txt")))).status).toBe(429);
    first.controller.abort(); second.controller.abort();
    expect((await first.promise).status).toBe(499);
    expect((await second.promise).status).toBe(499);
    expect((await POST(multipart(new File(["hello"], "paper.txt")))).status).toBe(200);
  });

  it("keeps HTML-like text inert in the JSON response", async () => {
    const response = await (await route()).POST(multipart(new File(["<script>window.evil=true</script>"], "paper.txt")));
    expect((await response.json()).text).toBe("<script>window.evil=true</script>");
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
