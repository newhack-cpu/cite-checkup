import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expandQuery, hybridRetrieve, rerankEvidence } from "../assist";
import { checkClaim } from "../index";
import { chunkEvidence, retrieveEvidence } from "../retrieval";

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-only-secret");
  vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const call = (name: string, args: unknown) => Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });

/** 按请求里强制调用的工具名分发模拟回复，并记下每次请求 */
function model(handlers: Record<string, (body: { messages: { content: string }[]; tools: { function: { parameters: unknown } }[] }) => Response>) {
  const requests: { tool: string; user: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const tool = body.tool_choice.function.name as string;
    requests.push({ tool, user: body.messages[1].content });
    const handler = handlers[tool];
    if (!handler) throw new Error(`unexpected tool ${tool}`);
    return handler(body);
  }));
  return requests;
}

// 12 段左右的英文材料：中间一段是要找的结果，其余是无关内容（都带 "morning"，所以候选会超过 6 段、需要重排）
const FILLER = "The archive also lists pottery fragments that staff catalogued each morning in the storage rooms. ";
const RESULT = "Participants who slept more than seven hours recalled more words the next morning than those who slept less than five hours.";
const DOCUMENT = `${FILLER.repeat(40)}\n${RESULT}\n${FILLER.repeat(40)}`;
const chunks = chunkEvidence(DOCUMENT, "source-1");
const target = chunks.find((chunk) => chunk.text.includes(RESULT))!;
const CLAIM = "睡眠时间长的人第二天记住的单词更多";

describe("model-assisted retrieval steps", () => {
  it("uses only validated search terms from query expansion", async () => {
    model({ expand_query: () => call("expand_query", { terms: ["sleep duration", "word recall", "睡眠时长", "word recall", "  next   morning "] }) });
    expect(await expandQuery(CLAIM, new AbortController().signal)).toEqual(["sleep duration", "word recall", "睡眠时长", "next morning"]);
  });

  it.each([
    [{ terms: ["https://evil.invalid"] }],
    [{ terms: ["sleep"], verdict: "supported" }],
    [{ terms: [] }],
  ])("rejects malformed or out-of-scope expansions (case %#)", async (args) => {
    model({ expand_query: () => call("expand_query", args) });
    await expect(expandQuery(CLAIM, new AbortController().signal)).rejects.toThrow();
  });

  it("rejects reranking that invents or repeats passage ids", async () => {
    const candidates = chunks.slice(0, 3);
    for (const ranking of [[{ chunkId: "source-1-c99", relevance: 3 }], [{ chunkId: candidates[0].id, relevance: 3 }, { chunkId: candidates[0].id, relevance: 1 }], [{ chunkId: candidates[0].id, relevance: 7 }]]) {
      model({ rank_evidence: () => call("rank_evidence", { ranking }) });
      await expect(rerankEvidence(CLAIM, candidates, new AbortController().signal)).rejects.toThrow();
    }
  });
});

describe("hybrid retrieval", () => {
  it("finds an English passage for a Chinese claim through expansion, then lets reranking order the pool", async () => {
    expect(retrieveEvidence(CLAIM, chunks)).toEqual([]); // 纯词面检索对跨语言论断无能为力
    const requests = model({
      expand_query: () => call("expand_query", { terms: ["sleep duration", "words recalled", "next morning", "睡眠时长"] }),
      rank_evidence: (body) => {
        const ids = (JSON.parse(body.messages[1].content) as { passages: { chunkId: string }[] }).passages.map((p) => p.chunkId);
        return call("rank_evidence", { ranking: ids.map((id) => ({ chunkId: id, relevance: id === target.id ? 3 : 0 })) });
      },
    });
    const result = await hybridRetrieve(CLAIM, chunks, new AbortController().signal);
    expect(result.method).toBe("hybrid-v1");
    expect(result.chunks[0].id).toBe(target.id);
    expect(result.expansion).toContain("sleep duration");
    expect(requests.map((r) => r.tool)).toEqual(["expand_query", "rank_evidence"]);
    expect(requests[1].user).not.toContain("test-only-secret");
  });

  it("falls back to plain BM25 order and says so when both model steps fail", async () => {
    model({ expand_query: () => new Response("busy", { status: 503 }), rank_evidence: () => call("rank_evidence", { ranking: [{ chunkId: "made-up", relevance: 3 }] }) });
    const result = await hybridRetrieve("Participants slept more than seven hours and recalled more words.", chunks, new AbortController().signal);
    expect(result.method).toBe("bm25-en-zh-v1");
    expect(result.chunks[0].id).toBe(target.id);
    expect(result.warnings.join("")).toMatch(/查询扩展.*未完成/);
  });

  it("is used by claim checking for long material and is reported in coverage", async () => {
    const requests = model({
      expand_query: () => call("expand_query", { terms: ["sleep duration", "words recalled", "next morning"] }),
      rank_evidence: (body) => {
        const ids = (JSON.parse(body.messages[1].content) as { passages: { chunkId: string }[] }).passages.map((p) => p.chunkId);
        return call("rank_evidence", { ranking: ids.map((id) => ({ chunkId: id, relevance: id === target.id ? 3 : 1 })) });
      },
      judge_claim: () => call("judge_claim", { verdict: "supported", explanation: "结果段落说明睡眠更长者次日回忆的单词更多。", citations: [{ sourceId: "source-1", chunkId: target.id, quote: RESULT }] }),
    });
    const result = await checkClaim({ claim: CLAIM, evidenceText: DOCUMENT });
    expect(result).toMatchObject({ status: "complete", verdict: "supported", coverage: { method: "hybrid-v1", expansion: ["sleep duration", "words recalled", "next morning"] } });
    expect(result.chunks[0].id).toBe(target.id);
    expect(requests.map((r) => r.tool)).toEqual(["expand_query", "rank_evidence", "judge_claim"]);
  });
});
