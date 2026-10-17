import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent-stream";
import type { RefResult } from "@/lib/verify/types";

const agent = vi.hoisted(() => ({ run: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent")>()),
  runAgent: agent.run,
  getAgentStatus: agent.status,
}));

const raw = "Goodfellow, I., Bengio, Y., & Courville, A. (2016). Deep learning. MIT Press.";
const result = {
  index: 2, raw, verdict: "verified", confidence: 0.9, summary: "已核实", issues: [], notes: [], fields: [], steps: [],
  parsed: { index: 2, raw, kind: "book", lang: "en" },
} as unknown as RefResult;

let nextIp = 0;
function request(body: unknown, ip = `198.51.100.${++nextIp}`) {
  return new Request("http://localhost/api/agent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
async function routes() {
  return import("./route");
}
async function events(response: Response): Promise<AgentEvent[]> {
  expect(response.status).toBe(200);
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// The first import has Vite transform the route's whole dependency graph; under a busy parallel run that can exceed the default 5 s.
// Load it once up front with a longer limit; each test's re-import after vi.resetModules() then reuses the transformed code.
const IMPORT_TIMEOUT = 30_000;
beforeAll(async () => { await routes(); }, IMPORT_TIMEOUT);

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  agent.status.mockReturnValue({ available: true, provider: "DeepSeek", model: "fixture-model", limits: { toolCalls: 4 } });
  agent.run.mockImplementation(async (_raw: string, index: number, options: { onStep?: (step: unknown) => void }) => {
    options.onStep?.({ action: "agent_search", reason: "按书名检索", detail: "Crossref 检索「Deep learning」：1 条候选", ok: true, ms: 12 });
    return { ...result, index };
  });
});
afterEach(() => vi.restoreAllMocks());

describe("/api/agent", () => {
  it("reports availability without exposing configuration", async () => {
    const body = await (await (await routes()).GET()).json();
    expect(body).toEqual({ available: true, provider: "DeepSeek", model: "fixture-model", limits: { toolCalls: 4 } });
  });

  it.each([
    ["{broken", 400], ["[]", 400], [JSON.stringify({ raw: "short", index: 1 }), 400],
    [JSON.stringify({ raw, index: 0 }), 400], [JSON.stringify({ raw, index: 81 }), 400],
    [JSON.stringify({ raw, index: 1, mode: "agent" }), 400],
    [JSON.stringify({ raw: "x".repeat(2_001), index: 1 }), 413],
  ])("rejects invalid payload case %#", async (body, status) => {
    const response = await (await routes()).POST(request(body));
    expect(response.status).toBe(status);
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("refuses when DeepSeek is not configured", async () => {
    agent.status.mockReturnValue({ available: false, provider: "DeepSeek", model: "fixture-model", limits: { toolCalls: 4 } });
    const response = await (await routes()).POST(request({ raw, index: 1 }));
    expect(response.status).toBe(503);
    expect(agent.run).not.toHaveBeenCalled();
  });

  it("streams each search step and then the rule-checked result", async () => {
    const list = await events(await (await routes()).POST(request({ raw, index: 2 })));
    expect(list.map((e) => e.type)).toEqual(["step", "result"]);
    expect(list[1]).toMatchObject({ type: "result", result: { index: 2, verdict: "verified" } });
    expect(agent.run).toHaveBeenCalledWith(raw, 2, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("turns an engine failure into a fatal frame without a result", async () => {
    agent.run.mockRejectedValue(new Error("boom"));
    const list = await events(await (await routes()).POST(request({ raw, index: 1 })));
    expect(list).toEqual([{ type: "fatal", message: expect.stringContaining("原有结论保持不变") }]);
  });

  it("limits each client to six runs per minute", async () => {
    const { POST } = await routes();
    for (let i = 0; i < 6; i++) await events(await POST(request({ raw, index: 1 }, "203.0.113.9")));
    const blocked = await POST(request({ raw, index: 1 }, "203.0.113.9"));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining("每分钟最多 6 次") });
  });
});

describe("agent stream reader", () => {
  function stream(lines: unknown[]) {
    const text = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");
    return new Response(text).body!;
  }

  it("returns the final result after forwarding steps", async () => {
    const { readAgentStream } = await import("@/lib/agent-stream");
    const seen: string[] = [];
    const final = await readAgentStream(stream([
      { type: "step", step: { action: "agent_search", detail: "d", ok: true, ms: 1 } },
      { type: "result", result: { ...result, index: 2 } },
    ]), 2, (e) => seen.push(e.type));
    expect(final.verdict).toBe("verified");
    expect(seen).toEqual(["step", "result"]);
  });

  it.each([
    [[{ type: "step", step: { action: "agent_search", detail: "d", ok: true, ms: 1 } }], /连接中断/],
    [[{ type: "result", result: { ...result, index: 5 } }], /格式不正确/],
    [[{ type: "fatal", message: "AI 检索中断了" }], /AI 检索中断了/],
    [["not json"], /格式不正确/],
  ])("rejects incomplete or inconsistent streams (case %#)", async (lines, message) => {
    const { readAgentStream } = await import("@/lib/agent-stream");
    await expect(readAgentStream(stream(lines), 2, () => {})).rejects.toThrow(message);
  });
});
