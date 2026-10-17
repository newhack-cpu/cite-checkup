import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CALLS_PER_TURN, parseAssistantTurn } from "../model";
import { parseToolCall, ToolArgumentError } from "../tools";
import { parseReference } from "../../verify/extract";
import type { CheckStep } from "../../verify/types";

const BOOK = "Goodfellow, I., Bengio, Y., & Courville, A. (2016). Deep learning. MIT Press.";
const bookRecord = {
  DOI: "10.5555/deep-learning-book", title: ["Deep Learning"], type: "book",
  author: [{ family: "Goodfellow", given: "Ian" }, { family: "Bengio", given: "Yoshua" }, { family: "Courville", given: "Aaron" }],
  issued: { "date-parts": [[2016]] },
};

type Call = { name: string; args: unknown };
function turn(calls: Call[], finish = "tool_calls") {
  return {
    choices: [{
      index: 0, finish_reason: finish,
      message: {
        role: "assistant", content: null,
        tool_calls: calls.map((c, i) => ({ id: `call-${i}-${c.name}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      },
    }],
    usage: { total_tokens: 500 },
  };
}

interface World {
  /** DeepSeek 依次返回的内容；用完后返回 finish */
  turns: unknown[];
  crossrefAgentItems?: unknown[];
  datacite?: unknown[];
  deepseekStatus?: number;
}

function serve(world: World) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(url.hostname + decodeURIComponent(url.pathname));
    if (url.hostname === "api.deepseek.com") {
      bodies.push(JSON.parse(String(init?.body)));
      if (world.deepseekStatus) return new Response("{}", { status: world.deepseekStatus });
      return Response.json(world.turns.shift() ?? turn([{ name: "finish", args: { note: "检索结束" } }]));
    }
    if (url.hostname === "api.crossref.org") {
      if (url.pathname === "/journals") return Response.json({ message: { items: [] } });
      if (url.pathname === "/works") {
        // 标准流程用整条引文检索（查不到）；AI 检索带作者字段时返回图书记录
        const agentQuery = url.searchParams.has("query.author");
        return Response.json({ message: { items: agentQuery ? world.crossrefAgentItems ?? [] : [] } });
      }
      return new Response("Resource not found.", { status: 404 });
    }
    if (url.hostname === "api.openalex.org") {
      if (url.pathname === "/works") return Response.json({ results: [] });
      return Response.json({ id: "https://openalex.org/W1", doi: "https://doi.org/10.5555/deep-learning-book", title: "Deep Learning", is_retracted: false });
    }
    if (url.hostname === "api.datacite.org") return Response.json({ data: world.datacite ?? [] });
    if (url.hostname === "doi.org") return Response.json([{ DOI: "x", status: "DOI does not exist" }]);
    throw new Error(`Unexpected request: ${url.hostname}${url.pathname}`);
  });
  return { calls, bodies };
}

async function agent() {
  return import("../index");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key-never-real");
  vi.stubEnv("DEEPSEEK_MODEL", "");
  vi.stubEnv("DEEPSEEK_BASE_URL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("tool argument validation", () => {
  it("accepts a well-formed search and trims its fields", () => {
    expect(parseToolCall("search_crossref", JSON.stringify({ query: "  Deep   learning ", author: "Goodfellow", year: 2016, reason: "查图书" })))
      .toEqual({ name: "search_crossref", query: "Deep learning", author: "Goodfellow", year: 2016, reason: "查图书" });
  });

  it.each([
    ["fetch_url", JSON.stringify({ url: "https://attacker.invalid" }), /没有名为/],
    ["search_crossref", "{not json", /JSON/],
    ["search_crossref", JSON.stringify({ query: "x", url: "https://attacker.invalid", reason: "r" }), /不允许的参数/],
    ["search_crossref", JSON.stringify({ reason: "缺题名" }), /缺少参数 query/],
    ["search_crossref", JSON.stringify({ query: "x".repeat(301), reason: "r" }), /超过/],
    ["search_openalex", JSON.stringify({ title: "Deep learning", year: 1066, reason: "r" }), /year/],
    ["lookup_doi", JSON.stringify({ doi: "not-a-doi", reason: "r" }), /DOI/],
  ])("rejects %s with arguments %s", (name, args, message) => {
    expect(() => parseToolCall(name, args)).toThrow(ToolArgumentError);
    expect(() => parseToolCall(name, args)).toThrow(message);
  });

  it("normalises DOI links and strips URLs from model-written text", () => {
    expect(parseToolCall("lookup_doi", JSON.stringify({ doi: "https://doi.org/10.1038/NATURE14539", reason: "见 https://x.invalid/a 原文" })))
      .toEqual({ name: "lookup_doi", doi: "10.1038/nature14539", reason: "见 原文" });
    expect(parseToolCall("finish", JSON.stringify({ note: "已查 www.example.com 和 Crossref" }))).toEqual({ name: "finish", note: "已查 和 Crossref" });
  });

  it("drops model text that judges authenticity, since only the rules may conclude", () => {
    expect(parseToolCall("finish", JSON.stringify({ note: "检索确认该文献真实存在，可以放心引用" }))).toEqual({ name: "finish", note: "" });
    expect(parseToolCall("finish", JSON.stringify({ note: "The citation looks fabricated." }))).toEqual({ name: "finish", note: "" });
    expect(parseToolCall("search_crossref", JSON.stringify({ query: "Deep learning", reason: "证明它是编造的" }))).toMatchObject({ reason: "" });
    expect(parseToolCall("finish", JSON.stringify({ note: "已在 Crossref、OpenAlex 检索，未找到题名相符的记录" })).name).toBe("finish");
  });
});

describe("model turn validation", () => {
  it("keeps at most two tool calls per turn", () => {
    const parsed = parseAssistantTurn(turn([1, 2, 3].map((i) => ({ name: "search_datacite", args: { query: `q${i}`, reason: "r" } }))));
    expect(parsed.calls).toHaveLength(MAX_CALLS_PER_TURN);
    expect(parsed.tokens).toBe(500);
  });

  it.each([
    { choices: [] },
    turn([{ name: "search_crossref", args: {} }], "length"),
    { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ id: "x", type: "function" }] } }] },
  ])("rejects malformed responses (case %#)", (body) => {
    expect(() => parseAssistantTurn(body)).toThrow(/工具调用格式/);
  });
});

describe("AI search agent", () => {
  it("lets the model plan a search, stops once the rules confirm the same work, and re-judges with the rules", async () => {
    const world = serve({
      turns: [turn([{ name: "search_crossref", args: { query: "Deep learning", author: "Goodfellow", year: 2016, reason: "按书名加第一作者检索图书" } }])],
      crossrefAgentItems: [bookRecord],
    });
    const steps: CheckStep[] = [];
    const result = await (await agent()).runAgent(BOOK, 3, { onStep: (s) => steps.push(s) });
    expect(result.agent).toMatchObject({ before: { verdict: "unverifiable" }, outcome: "confirmed", toolCalls: 1, rounds: 1, tokens: 500 });
    expect(result.verdict).toBe("verified");
    expect(result.index).toBe(3);
    expect(result.match?.doi).toBe("10.5555/deep-learning-book");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ action: "agent_search", reason: "按书名加第一作者检索图书", ok: true });
    expect(result.steps.map((s) => s.action)).toContain("agent_search");
    // 规则确认同一篇后不再调用模型
    expect(world.calls.filter((c) => c.startsWith("api.deepseek.com"))).toHaveLength(1);
    const request = world.bodies[0] as { tool_choice: string; thinking: unknown; messages: { role: string; content: string }[] };
    expect(request.tool_choice).toBe("required");
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(JSON.parse(request.messages[1].content)).toMatchObject({ citation: BOOK, currentResult: expect.any(String) });
  });

  it("offers a differing record for a report only as a candidate, since it is often another edition", async () => {
    const report = "Johnson R, Crafton RE, Upton HF. Invasive species: major laws and the role of selected federal agencies. Congressional Research Service report; 2017.";
    serve({
      turns: [turn([{ name: "search_crossref", args: { query: "Invasive species: major laws and the role of selected federal agencies", author: "Johnson", reason: "按报告题名检索" } }])],
      crossrefAgentItems: [{
        DOI: "10.5555/crs-rl30123", title: ["Invasive Species: Major Laws and the Role of Selected Federal Agencies"], type: "report",
        author: [{ family: "Corn", given: "M. Lynne" }, { family: "Johnson", given: "Renée" }], issued: { "date-parts": [[2013]] },
      }],
    });
    const result = await (await agent()).runAgent(report, 1);
    expect(result.verdict).toBe("unverifiable");
    expect(result.matchStatus).toBe("candidate");
    expect(result.issues).toEqual([]);
    expect(result.notes.join("")).toContain("与该记录的差异");
    expect(result.agent?.outcome).toBe("unchanged");
  });

  it("refuses to look up a DOI that appears neither in the citation nor in any result", async () => {
    const world = serve({ turns: [turn([{ name: "lookup_doi", args: { doi: "10.9999/invented", reason: "试一个 DOI" } }])] });
    const result = await (await agent()).runAgent(BOOK, 1);
    expect(world.calls.some((c) => c.includes("10.9999"))).toBe(false);
    expect(result.steps.find((s) => s.action === "agent_search")).toMatchObject({ ok: false, detail: expect.stringContaining("未查询") });
    expect(result.verdict).toBe("unverifiable");
    expect(result.agent).toMatchObject({ outcome: "unchanged", toolCalls: 1, note: "检索结束" });
  });

  it("stops after the search budget even if the model keeps asking", async () => {
    const pair = (a: string, b: string) => turn([
      { name: "search_datacite", args: { query: a, reason: "r" } },
      { name: "search_datacite", args: { query: b, reason: "r" } },
    ]);
    const world = serve({ turns: [pair("q1", "q2"), pair("q3", "q4"), pair("q5", "q6")] });
    const { runAgent, AGENT_LIMITS } = await agent();
    const result = await runAgent(BOOK, 1);
    expect(result.agent?.toolCalls).toBe(AGENT_LIMITS.toolCalls);
    expect(world.calls.filter((c) => c.startsWith("api.deepseek.com"))).toHaveLength(2);
    expect(world.calls.filter((c) => c.startsWith("api.datacite.org"))).toHaveLength(4);
  });

  it("counts an invalid tool call and reports it instead of executing it", async () => {
    serve({ turns: [turn([{ name: "search_crossref", args: { query: "Deep learning", url: "https://attacker.invalid", reason: "r" } }])] });
    const result = await (await agent()).runAgent(BOOK, 1);
    expect(result.steps.find((s) => s.action === "agent_search")).toMatchObject({ ok: false, detail: expect.stringContaining("不合规") });
    expect(result.agent?.toolCalls).toBe(1);
  });

  it("keeps the rule-based conclusion and says so when the model is unavailable", async () => {
    serve({ turns: [], deepseekStatus: 500 });
    const result = await (await agent()).runAgent(BOOK, 1);
    expect(result.verdict).toBe("unverifiable");
    expect(result.agent).toMatchObject({ outcome: "unchanged", toolCalls: 0 });
    expect(result.notes.join("")).toContain("DeepSeek 服务暂时不可用");
  });

  it("says the search did not start when the data sources are down, instead of claiming a conclusion", async () => {
    const world = serve({ turns: [] });
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      world.calls.push(url.hostname + url.pathname);
      return new Response("busy", { status: 503 });
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const pending = (await agent()).runAgent(BOOK, 1);
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result.verdict).toBe("error");
    expect(result.agent?.note).toContain("AI 检索没有开始");
    expect(world.calls.some((c) => c.startsWith("api.deepseek.com"))).toBe(false);
  });

  it("does not call the model when the fresh rule check is already conclusive", async () => {
    const world = serve({ turns: [] });
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      world.calls.push(url.hostname + url.pathname);
      if (url.hostname === "api.crossref.org") return Response.json({ message: { items: [bookRecord] } });
      if (url.hostname === "api.openalex.org") return Response.json({ id: "https://openalex.org/W1", doi: "https://doi.org/10.5555/deep-learning-book", title: "Deep Learning", is_retracted: false });
      throw new Error(`Unexpected request: ${url.hostname}`);
    });
    const result = await (await agent()).runAgent(BOOK, 1);
    expect(result.verdict).toBe("verified");
    expect(result.agent).toMatchObject({ toolCalls: 0, rounds: 0, note: expect.stringContaining("无需 AI 检索") });
    expect(world.calls.some((c) => c.startsWith("api.deepseek.com"))).toBe(false);
  });
});

describe("search_openalex tool", () => {
  it("sends the model's title to OpenAlex without wildcard characters", async () => {
    const filters: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const filter = new URL(input).searchParams.get("filter") ?? "";
      filters.push(filter);
      // 与 OpenAlex 的实际行为一致：title.search 里有 ? 或 * 就返回 400
      return /[?*]/.test(filter) ? Response.json({ error: "Invalid query parameters error." }, { status: 400 }) : Response.json({ results: [] });
    });
    const args = parseToolCall("search_openalex", JSON.stringify({ title: "How Many Crits Were Rolled This Year? Check Out 2022 Unrolled!", year: 2022, reason: "查网页文章" }));
    if (args.name !== "search_openalex") throw new Error("unexpected tool");
    const { runTool } = await import("../tools");
    const outcome = await runTool(args, { ref: parseReference(BOOK, 1), knownDois: new Set(), openalexLeft: { left: 1 }, nextId: { n: 1 } });
    expect(filters).toEqual(["title.search:How Many Crits Were Rolled This Year Check Out 2022 Unrolled!,publication_year:2021-2023"]);
    expect(outcome.detail).toMatch(/^OpenAlex 题名检索.*没有结果$/);
  });
});

describe("agent eligibility and DataCite records", () => {
  it("only offers AI search for unverifiable items and unconfirmed candidates", async () => {
    const { agentEligible } = await import("../../agent-stream");
    expect(agentEligible({ verdict: "unverifiable" })).toBe(true);
    expect(agentEligible({ verdict: "mismatch", matchStatus: "candidate" })).toBe(true);
    expect(agentEligible({ verdict: "mismatch", matchStatus: "confirmed" })).toBe(false);
    expect(agentEligible({ verdict: "not_found" })).toBe(false);
    expect(agentEligible({ verdict: "verified", matchStatus: "confirmed" })).toBe(false);
  });

  it("maps DataCite software records and sanitises the query syntax", async () => {
    const { dataciteQuery, mapDatacite } = await import("../../verify/sources/datacite");
    expect(dataciteQuery('SDCflows: "Susceptibility" (workFLOWS)')).toBe("SDCflows Susceptibility workFLOWS");
    expect(mapDatacite({
      id: "10.5281/zenodo.15271272",
      attributes: {
        doi: "10.5281/ZENODO.15271272", titles: [{ title: "SDCflows: Susceptibility Distortion Correction workFLOWS." }],
        creators: [{ name: "Esteban, Oscar" }, { familyName: "Markiewicz", givenName: "Christopher J." }],
        publicationYear: "2025", publisher: "Zenodo", types: { resourceTypeGeneral: "Software" },
      },
    })).toEqual({
      source: "datacite", doi: "10.5281/zenodo.15271272", title: "SDCflows: Susceptibility Distortion Correction workFLOWS.",
      authors: [{ family: "Esteban", given: "Oscar" }, { family: "Markiewicz", given: "Christopher J." }],
      year: 2025, venue: "Zenodo", type: "Software",
    });
  });
});
