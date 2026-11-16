import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseReferenceList } from "@/lib/verify/extract";
import type { RefResult } from "@/lib/verify/types";

const calls = vi.hoisted(() => ({ verify: vi.fn(), claim: vi.fn() }));
vi.mock("@/lib/verify/verify", () => ({ verifyAll: calls.verify }));
vi.mock("@/lib/claims", async (original) => ({ ...(await original<typeof import("@/lib/claims")>()), checkClaim: calls.claim }));

const citation = "Miller, G. (1956). The magical number seven. Psychological Review, 63(2), 81–97. doi:10.1037/h0043158";
let identity = 0;

/** 让 SDK 客户端的请求直接交给路由处理，不起真实服务 */
async function connect(ip = `mcp-test-${++identity}`) {
  const route = await import("./route");
  const handlers: Record<string, (r: Request) => Promise<Response>> = { POST: route.POST, GET: route.GET, DELETE: route.DELETE };
  const fetchLike = async (url: string | URL, init?: RequestInit) => {
    const request = new Request(url, init);
    request.headers.set("x-forwarded-for", ip);
    const handler = handlers[request.method];
    return handler ? handler(new Request(request, { headers: request.headers })) : new Response(null, { status: 405 });
  };
  const client = new Client({ name: "route-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), { fetch: fetchLike }));
  return client;
}

afterEach(() => {
  calls.verify.mockReset();
  calls.claim.mockReset();
});

describe("MCP over Streamable HTTP", () => {
  it("lists the same two tools as the stdio server", async () => {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["check_claim", "verify_references"]);
    await client.close();
  });

  it("verifies references through the shared engine and returns structured results", async () => {
    calls.verify.mockImplementation(async (refs: unknown[], onResult: (r: RefResult) => void) => {
      onResult({ index: 1, raw: citation, verdict: "verified", confidence: 1, summary: "已核实：与数据库记录一致（来源：Crossref）", issues: [], notes: [], fields: [], steps: [], parsed: parseReferenceList(citation)[0] } as RefResult);
    });
    const client = await connect();
    const result = await client.callTool({ name: "verify_references", arguments: { references: citation } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { total: number; counts: Record<string, number> }).counts.verified).toBe(1);
    expect(JSON.stringify(result.content)).toContain("已核实");
    await client.close();
  });

  it("rate-limits check_claim per caller across requests", async () => {
    calls.claim.mockResolvedValue({ status: "complete", verdict: "supported", explanation: "ok", citations: [], source: null, warnings: [], model: "m" });
    const client = await connect("same-caller");
    const outcomes = [];
    for (let i = 0; i < 7; i++) outcomes.push(await client.callTool({ name: "check_claim", arguments: { claim: `论断 ${i}`, evidence_text: "材料" } }));
    expect(outcomes.slice(0, 6).every((r) => !r.isError)).toBe(true);
    expect(outcomes[6].isError).toBe(true);
    expect(JSON.stringify(outcomes[6].content)).toContain("每分钟最多 6 次");
    await client.close();
  });

  it("answers a browser GET with usage, rejects oversized and malformed bodies, and caps messages per minute", async () => {
    const route = await import("./route");
    const get = await route.GET();
    expect(get.status).toBe(405);
    expect((await get.json()).usage).toContain("verify_references");
    const big = await route.POST(new Request("http://localhost/api/mcp", { method: "POST", headers: { "x-forwarded-for": "big", "content-length": String(600 * 1024) }, body: "{}" }));
    expect(big.status).toBe(413);
    const bad = await route.POST(new Request("http://localhost/api/mcp", { method: "POST", headers: { "x-forwarded-for": "bad" }, body: "{not json" }));
    expect(bad.status).toBe(400);
    let last = 200;
    for (let i = 0; i < 31; i++) {
      const r = await route.POST(new Request("http://localhost/api/mcp", { method: "POST", headers: { "x-forwarded-for": "flood", accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "ping" }) }));
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
