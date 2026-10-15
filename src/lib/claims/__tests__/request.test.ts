import { describe, expect, it, vi } from "vitest";
import { normalizeDoi, readClaimRequest, validateClaimInput } from "../request";

describe("claim input boundary", () => {
  it("accepts one source and canonicalizes a DOI without fetching arbitrary URLs", () => {
    expect(normalizeDoi("https://doi.org/10.1038/NATURE14539")).toBe("10.1038/nature14539");
    expect(validateClaimInput({ claim: " A claim. ", evidenceText: "Study result." })).toEqual({ claim: "A claim.", evidenceText: "Study result." });
  });

  it.each([
    { claim: "C", doi: "http://localhost/admin" },
    { claim: "C", doi: "https://doi.org.evil.invalid/10.1234/a" },
    { claim: "C", doi: "10.1234/a", evidenceText: "text" },
    { claim: "C" },
    { claim: " ", evidenceText: "text" },
    { claim: "c".repeat(2_001), evidenceText: "text" },
    { claim: "C", evidenceText: "x".repeat(160_001) },
    { claim: "C", evidenceText: "text", model: "attacker" },
  ])("rejects invalid, oversized or ambiguous input", (input) => {
    expect(() => validateClaimInput(input)).toThrow();
  });

  it("bounds chunked JSON bodies before parsing", async () => {
    const bytes = new TextEncoder().encode("x".repeat(1_000_001));
    const request = new Request("https://local/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), duplex: "half" } as RequestInit);
    await expect(readClaimRequest(request)).rejects.toMatchObject({ status: 413 });
  });

  it("honors pre-cancelled requests", async () => {
    const request = new Request("https://local/api/claims", { method: "POST", signal: AbortSignal.abort(), body: "{}" });
    await expect(readClaimRequest(request)).rejects.toMatchObject({ status: 499 });
  });

  it("times out a stalled request body and cancels its reader", async () => {
    vi.useFakeTimers();
    try {
      const request = new Request("https://local/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: new ReadableStream(), duplex: "half" } as RequestInit);
      const task = readClaimRequest(request).catch((error) => error);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await task).toMatchObject({ status: 408 });
    } finally { vi.useRealTimers(); }
  });
});
