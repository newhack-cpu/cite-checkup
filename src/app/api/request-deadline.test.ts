import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReferenceList } from "@/lib/verify/extract";
import type { RefResult } from "@/lib/verify/types";

const calls = vi.hoisted(() => ({ prepare: vi.fn(), verify: vi.fn(), agent: vi.fn(), claim: vi.fn(), vision: vi.fn() }));
vi.mock("@/lib/ai", () => ({ getAIStatus: () => ({ available: true }), prepareAIReferences: calls.prepare }));
vi.mock("@/lib/verify/verify", () => ({ verifyAll: calls.verify }));
vi.mock("@/lib/agent", async (original) => ({ ...(await original<typeof import("@/lib/agent")>()), getAgentStatus: () => ({ available: true }), runAgent: calls.agent }));
vi.mock("@/lib/claims", async (original) => ({ ...(await original<typeof import("@/lib/claims")>()), getClaimStatus: () => ({ available: true }), checkClaim: calls.claim }));
vi.mock("@/lib/vision", async (original) => ({ ...(await original<typeof import("@/lib/vision")>()), getVisionStatus: () => ({ available: true }), transcribeReferences: calls.vision }));

const routes = {
  check: () => import("./check/route"),
  agent: () => import("./agent/route"),
  claims: () => import("./claims/route"),
  vision: () => import("./vision/route"),
};
type Route = keyof typeof routes;
const citation = "Miller, G. (1956). The magical number seven. Psychological Review, 63(2), 81–97. doi:10.1037/h0043158";
const result = { index: 1, raw: citation, verdict: "verified", confidence: 1, summary: "已核实", issues: [], notes: [], fields: [], steps: [], parsed: parseReferenceList(citation)[0] } as RefResult;
const step = { action: "agent_search", detail: "已找到一个候选", ok: true, ms: 1 };
const never = () => new Promise<never>(() => {});
const pending = { check: calls.verify, agent: calls.agent, claims: calls.claim, vision: calls.vision };
let identity = 0;

function input(route: Route, signal?: AbortSignal) {
  const headers = { "x-forwarded-for": `deadline-${++identity}` };
  if (route === "vision") {
    const form = new FormData();
    form.append("image", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "test.png"));
    return new Request("https://local/api/vision", { method: "POST", headers, body: form, signal });
  }
  const body = route === "check" ? { text: citation, mode: "ai" } : route === "agent" ? { raw: citation, index: 1 } : { claim: "The trial improved sleep.", evidenceText: "Sleep was unchanged." };
  return new Request(`https://local/api/${route}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

async function delayedInput(route: Route, delay?: number) {
  const original = input(route);
  const bytes = new Uint8Array(await original.arrayBuffer());
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (delay !== undefined) setTimeout(() => { controller.enqueue(bytes); controller.close(); }, delay);
    },
    cancel,
  });
  return { request: new Request(original.url, { method: "POST", headers: original.headers, body, duplex: "half" } as RequestInit), cancel };
}

function workSignal(route: Route): AbortSignal {
  return pending[route].mock.calls[0][route === "check" || route === "agent" ? 2 : 1].signal;
}

async function frames(response: Response): Promise<{ type: string; message?: string; result?: unknown }[]> {
  return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

beforeAll(async () => { await Promise.all(Object.values(routes).map((load) => load())); }, 30_000);
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DEPLOY_TARGET", "netlify");
  vi.useFakeTimers();
  calls.prepare.mockResolvedValue({ refs: [result.parsed], sent: 0, supplemented: 0, rejected: 0 });
  calls.verify.mockImplementation(async (_refs, onResult) => { onResult(result); });
  calls.agent.mockResolvedValue(result);
  calls.claim.mockResolvedValue({ status: "complete" });
  calls.vision.mockResolvedValue({ text: citation, entries: [citation], warnings: [] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Netlify route-wide request deadline", () => {
  it.each(["check", "agent"] as const)("cancels a stalled %s body at 50 seconds before starting work", async (route) => {
    const { POST } = await routes[route]();
    const upload = await delayedInput(route);
    const response = POST(upload.request);
    await vi.advanceTimersByTimeAsync(50_000);
    expect((await response).status).toBe(504);
    expect(await (await response).json()).toMatchObject({ error: expect.stringContaining("尚未完成") });
    expect(upload.cancel).toHaveBeenCalledOnce();
    expect(pending[route]).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(Object.keys(routes) as Route[])("includes input time in %s's total budget and stops even uncooperative work", async (route) => {
    const { POST } = await routes[route]();
    pending[route].mockImplementation(never);
    if (route === "check") calls.verify.mockImplementation((_refs, onResult) => { onResult(result); return never(); });
    if (route === "agent") calls.agent.mockImplementation((_raw, _index, options) => { options.onStep(step); return never(); });
    const upload = await delayedInput(route, 10_000);
    const response = POST(upload.request);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending[route]).toHaveBeenCalledOnce();
    const signal = workSignal(route);
    await vi.advanceTimersByTimeAsync(39_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    const output = await response;
    if (route === "check" || route === "agent") {
      expect(output.status).toBe(200);
      const events = await frames(output);
      expect(events.at(-1)).toMatchObject({ type: "fatal", message: expect.stringContaining("超时") });
      expect(events.filter((event) => event.type === "fatal")).toHaveLength(1);
      expect(events.some((event) => event.type === "done")).toBe(false);
      if (route === "check") expect(events.find((event) => event.type === "result")?.result).toEqual(result);
      else expect(events.map((event) => event.type)).toEqual(["step", "fatal"]);
    } else {
      expect(output.status).toBe(504);
      expect(await output.json()).toMatchObject({ error: expect.stringContaining("尚未完成"), ...(route === "vision" ? { code: "TIMEOUT" } : {}) });
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(Object.keys(routes) as Route[])("releases both occupied %s reservations after timeout", async (route) => {
    const { POST } = await routes[route]();
    const model = route === "check" ? calls.prepare : pending[route];
    model.mockImplementation(never);
    const first = POST(input(route));
    const second = POST(input(route));
    await vi.advanceTimersByTimeAsync(0);
    expect(model).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50_000);
    const responses = await Promise.all([first, second]);
    await Promise.all(responses.map((response) => response.text()));
    // Two new calls must enter model work; a leaked reservation would reject/fall back.
    const third = POST(input(route));
    const fourth = POST(input(route));
    await vi.advanceTimersByTimeAsync(0);
    expect(model).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(50_000);
    await Promise.all((await Promise.all([third, fourth])).map((response) => response.text()));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(Object.keys(routes) as Route[])("keeps client cancellation distinct from a %s timeout", async (route) => {
    const { POST } = await routes[route]();
    pending[route].mockImplementation(never);
    const client = new AbortController();
    const response = POST(input(route, client.signal));
    await vi.advanceTimersByTimeAsync(0);
    const signal = workSignal(route);
    client.abort();
    const output = await response;
    expect(signal.aborted).toBe(true);
    if (route === "check" || route === "agent") {
      expect((await frames(output)).some((event) => ["fatal", "done", "result"].includes(event.type))).toBe(false);
    } else {
      expect(output.status).toBe(499);
      expect(await output.json()).toMatchObject({ error: expect.stringContaining("取消") });
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["check", "agent"] as const)("reader cancellation promptly releases %s slots even when work ignores abort", async (route) => {
    const { POST } = await routes[route]();
    const model = route === "check" ? calls.prepare : pending[route];
    model.mockImplementation(never);
    const responses = await Promise.all([POST(input(route)), POST(input(route))]);
    expect(model).toHaveBeenCalledTimes(2);
    await Promise.all(responses.map((response) => response.body!.cancel()));
    const retry = await POST(input(route));
    expect(model).toHaveBeenCalledTimes(3);
    await retry.body!.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(Object.keys(routes) as Route[])("clears %s's timer after success", async (route) => {
    const { POST } = await routes[route]();
    const response = await POST(input(route));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("fatal");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it.each(["check", "agent"] as const)("hands %s's 50-second deadline to the Chinese journal lookup, and none elsewhere", async (route) => {
    const { POST } = await routes[route]();
    const started = Date.now();
    await (await POST(input(route))).text();
    expect(pending[route].mock.calls[0][2].deadline).toBe(started + 50_000);
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_TARGET", "");
    vi.resetModules();
    const local = await routes[route]();
    await (await local.POST(input(route))).text();
    expect(pending[route].mock.calls[1][2].deadline).toBeUndefined();
  });

  it.each(Object.keys(routes) as Route[])("does not impose Netlify's deadline on %s outside that deployment", async (route) => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_TARGET", "");
    const { POST } = await routes[route]();
    pending[route].mockImplementation(never);
    const client = new AbortController();
    const response = POST(input(route, client.signal));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(workSignal(route).aborted).toBe(false);
    client.abort();
    await (await response).text();
    expect(vi.getTimerCount()).toBe(0);
  });
});
