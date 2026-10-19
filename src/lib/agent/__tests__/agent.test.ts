import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  /** DeepSeek Search（/v1/tools/search）依次返回的结果；数字表示这次返回该 HTTP 状态码 */
  search?: (unknown[] | number)[];
}

function serve(world: World) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(url.hostname + decodeURIComponent(url.pathname));
    if (url.hostname === "api.deepseek.com" && url.pathname === "/v1/tools/search") {
      const next = world.search?.shift() ?? [];
      if (typeof next === "number") return new Response("{}", { status: next });
      return Response.json({ results: next });
    }
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

// The first import has Vite transform the agent's whole dependency graph; under a busy parallel run that can exceed the default 5 s.
// Load it once up front with a longer limit; each test's re-import after vi.resetModules() then reuses the transformed code.
const IMPORT_TIMEOUT = 30_000;
beforeAll(async () => { await agent(); }, IMPORT_TIMEOUT);

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

  const REPORT = "Johnson R, Crafton RE, Upton HF. Invasive species: major laws and the role of selected federal agencies. Congressional Research Service report; 2017.";
  const crsRecord = (authors: { family: string; given: string }[]) => ({
    DOI: "10.5555/crs-rl30123", title: ["Invasive Species: Major Laws and the Role of Selected Federal Agencies"], type: "report",
    author: authors, issued: { "date-parts": [[2013]] },
  });
  const searchReport = turn([{ name: "search_crossref", args: { query: "Invasive species: major laws and the role of selected federal agencies", author: "Johnson", reason: "按报告题名检索" } }]);

  it("offers a differing record for a report only as a candidate, since it is often another edition", async () => {
    // 第一作者相同、合著者和年份不同：规则认定是同一份报告的另一版本
    serve({ turns: [searchReport], crossrefAgentItems: [crsRecord([{ family: "Johnson", given: "Renée" }, { family: "Corn", given: "M. Lynne" }])] });
    const result = await (await agent()).runAgent(REPORT, 1);
    expect(result.verdict).toBe("unverifiable");
    expect(result.matchStatus).toBe("candidate");
    expect(result.issues).toEqual([]);
    expect(result.notes.join("")).toContain("与该记录的差异");
    expect(result.agent?.outcome).toBe("unchanged");
  });

  it("does not take a report record whose year and first author both differ as the cited report", async () => {
    serve({ turns: [searchReport], crossrefAgentItems: [crsRecord([{ family: "Corn", given: "M. Lynne" }, { family: "Johnson", given: "Renée" }])] });
    const result = await (await agent()).runAgent(REPORT, 1);
    expect(result.verdict).toBe("unverifiable");
    expect(result.matchStatus).not.toBe("confirmed");
    expect(result.issues).toEqual([]);
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
    expect(agentEligible({ verdict: "near_match", matchStatus: "candidate" })).toBe(true);
    // DOI 写错、另有相近候选：可以继续查那篇候选是不是同一篇
    expect(agentEligible({ verdict: "mismatch", matchStatus: "candidate" })).toBe(true);
    expect(agentEligible({ verdict: "mismatch", matchStatus: "confirmed" })).toBe(false);
    // 粘进来的是一段正文时不交给模型去查
    const { parseReference } = await import("../../verify/extract");
    expect(agentEligible({ verdict: "unverifiable", parsed: parseReference("本研究采用问卷调查法，对 300 名大学生进行了测量。结果表明，内在动机与成绩显著正相关。", 1) })).toBe(false);
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

describe("Chinese journal search (DeepSeek Search over CNKI, Wanfang and CQVIP)", () => {
  // Invented title, authors and journal in the result formats DeepSeek Search returned on 2026-10-17
  const CN = "张三, 李四. 城市绿地降温效应的多尺度研究[J]. 测试地理学报, 2021(3): 12-20.";
  const searchCn = turn([{ name: "search_cn_journals", args: { title: "城市绿地降温效应的多尺度研究", reason: "到中文期刊库按题名检索" } }]);
  const cnkiHit = {
    title: "城市绿地降温效应的多尺度研究-测试地理学报2021年03期-手机知网", url: "https://wap.cnki.net/touch/web/Journal/Article/CSDL202103002.html",
    snippet: "", summary: "城市绿地降温效应的多尺度研究\n\n测试地理学报\n\n2021年03期", date: null, site_name: "手机知网",
  };
  const cqvipHit = {
    title: "城市绿地降温效应的多尺度研究", url: "https://mqikan.cqvip.com/article/ArticleDetail?id=7200000001", snippet: "",
    summary: "# 城市绿地降温效应的多尺度研究\n\n作者：张三 李四\n\n出处：《测试地理学报》2021年第3期12-20,共9页", date: null, site_name: "维普网",
  };

  it("confirms a Chinese journal article through a CQVIP page that lists the authors", async () => {
    const world = serve({ turns: [searchCn], search: [[cnkiHit, cqvipHit]] });
    const steps: CheckStep[] = [];
    const result = await (await agent()).runAgent(CN, 1, { onStep: (s) => steps.push(s) });
    expect(result.agent).toMatchObject({ before: { verdict: "unverifiable" }, outcome: "confirmed", toolCalls: 1 });
    expect(result.verdict).toBe("verified");
    expect(result.summary).toContain("（来源：维普）");
    expect(result.match).toMatchObject({ source: "web", site: "维普", url: cqvipHit.url });
    expect(result.suggestion).toBe("张三, 李四. 城市绿地降温效应的多尺度研究[J]. 测试地理学报, 2021(3): 12-20.");
    expect(steps[0].detail).toMatch(/^中文期刊检索（知网、万方、维普）.*维普/);
    expect(world.calls.filter((c) => c === "api.deepseek.com/v1/tools/search")).toHaveLength(1);
  });

  it("offers a CNKI page without authors only as a candidate, with its link", async () => {
    serve({ turns: [searchCn], search: [[cnkiHit], []] });
    const result = await (await agent()).runAgent(CN, 1);
    expect(result.verdict).toBe("near_match");
    expect(result.matchStatus).toBe("candidate");
    expect(result.summary).toBe("在知网找到题名、刊名、年份一致的文章，但没有作者信息，请打开链接核对作者");
    expect(result.match).toMatchObject({ site: "知网", url: cnkiHit.url });
    expect(result.agent?.outcome).toBe("unchanged");
    // 没有作者的记录拼不出完整写法，不给规范写法
    expect(result.suggestion).toBeUndefined();
  });

  it("keeps the CNKI candidate when the CQVIP follow-up search fails", async () => {
    const steps: CheckStep[] = [];
    serve({ turns: [searchCn], search: [[cnkiHit], 429] });
    const result = await (await agent()).runAgent(CN, 1, { onStep: (s) => steps.push(s) });
    expect(result.verdict).toBe("near_match");
    expect(result.match).toMatchObject({ site: "知网", url: cnkiHit.url });
    expect(steps[0]).toMatchObject({ ok: true, detail: expect.stringContaining("补查维普作者未完成（DeepSeek 联网搜索请求过于频繁）") });
  });

  it("reports invented authors on a real Chinese title as an error, not as verified", async () => {
    serve({ turns: [searchCn], search: [[cqvipHit]] });
    const result = await (await agent()).runAgent("王五, 赵六. 城市绿地降温效应的多尺度研究[J]. 测试地理学报, 2021(3): 12-20.", 1);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("作者");
  });

  it("sends back a first finish once when a Chinese journal article was never searched in the Chinese journal sites", async () => {
    const finish = turn([{ name: "finish", args: { note: "开放数据库不收录，结束" } }]);
    const world = serve({ turns: [finish, searchCn], search: [[cnkiHit], []] });
    const result = await (await agent()).runAgent(CN, 1);
    expect(result.verdict).toBe("near_match");
    expect(result.match).toMatchObject({ site: "知网" });
    expect(world.calls.filter((c) => c === "api.deepseek.com/v1/tools/search").length).toBeGreaterThanOrEqual(1);
    const second = world.bodies[1] as { messages: { role: string; content: string }[] };
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("search_cn_journals has not been tried") });
  });

  it("accepts the second finish, and an immediate finish on an English citation", async () => {
    const finish = turn([{ name: "finish", args: { note: "结束" } }]);
    const world = serve({ turns: [finish, finish] });
    expect((await (await agent()).runAgent(CN, 1)).agent).toMatchObject({ rounds: 2, toolCalls: 0 });
    expect(world.calls).not.toContain("api.deepseek.com/v1/tools/search");
    serve({ turns: [finish] });
    expect((await (await agent()).runAgent(BOOK, 1)).agent).toMatchObject({ rounds: 1, toolCalls: 0 });
  });

  it("accepts only a title for search_cn_journals", () => {
    expect(parseToolCall("search_cn_journals", JSON.stringify({ title: " 城市绿地降温效应 ", reason: "查中文期刊" })))
      .toEqual({ name: "search_cn_journals", title: "城市绿地降温效应", reason: "查中文期刊" });
    expect(() => parseToolCall("search_cn_journals", JSON.stringify({ title: "城市绿地", site: "cnki.net", reason: "r" }))).toThrow(/不允许的参数/);
  });
});
