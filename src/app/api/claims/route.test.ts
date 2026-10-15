import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

let identity = 0;
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://local/api/claims", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `test-${identity++}`, ...headers }, body: JSON.stringify(body) });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("claim HTTP API", () => {
  it("never reveals credentials in configuration status or missing-key results", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://private.test/secret-path");
    const state = await (await GET()).json();
    expect(state.available).toBe(false);
    expect(JSON.stringify(state)).not.toMatch(/private.test|secret-path/);
    const response = await POST(request({ claim: "The trial improved sleep.", evidenceText: "Sleep was unchanged." }));
    expect(await response.json()).toMatchObject({ status: "incomplete", verdict: null, errorCode: "CONFIGURATION" });
  });

  it("rejects arbitrary source URLs and malformed body types before any outbound call", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(request({ claim: "C", doi: "http://localhost/internal" }));
    expect(response.status).toBe(400);
    const type = await POST(request({}, { "Content-Type": "text/plain" }));
    expect(type.status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns cancelled HTTP state without starting work", async () => {
    const response = await POST(new Request("https://local/api/claims", { method: "POST", signal: AbortSignal.abort(), headers: { "Content-Type": "application/json", "x-forwarded-for": `test-${identity++}` }, body: "{}" }));
    expect(response.status).toBe(499);
  });
});
