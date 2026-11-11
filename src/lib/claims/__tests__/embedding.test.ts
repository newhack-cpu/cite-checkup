import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hybridRetrieve } from "../assist";
import { checkClaim } from "../index";
import { chunkEvidence, retrieveEvidence } from "../retrieval";
import type { EvidenceChunk } from "../types";

// 向量模型用替身：测试只关心这一路召回怎样并进混合检索，不加载真实模型
const vector = vi.hoisted(() => ({
  available: true,
  rank: undefined as undefined | ((claim: string, chunks: EvidenceChunk[], limit: number) => Promise<EvidenceChunk[] | null>),
}));
vi.mock("../embedding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../embedding")>()),
  embeddingAvailable: () => vector.available,
  rankByEmbedding: (claim: string, chunks: EvidenceChunk[], limit: number) => vector.rank!(claim, chunks, limit),
}));

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-only-secret");
  vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
  vector.available = true;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const call = (name: string, args: unknown) => Response.json({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }] });
function model(handlers: Record<string, (body: { messages: { content: string }[] }) => Response>) {
  const tools: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const tool = body.tool_choice.function.name as string;
    tools.push(tool);
    return handlers[tool](body);
  }));
  return tools;
}

const FILLER = "The archive also lists pottery fragments that staff catalogued each morning in the storage rooms. ";
const RESULT = "Participants who slept more than seven hours recalled more words the next morning than those who slept less than five hours.";
const DOCUMENT = `${FILLER.repeat(40)}\n${RESULT}\n${FILLER.repeat(40)}`;
const chunks = chunkEvidence(DOCUMENT, "source-1");
const target = chunks.find((chunk) => chunk.text.includes(RESULT))!;
const CLAIM = "睡眠时间长的人第二天记住的单词更多";
/** 语义相似度的替身：把目标片段排第一，其余按原顺序 */
const semantic = async (_claim: string, all: EvidenceChunk[], limit: number) =>
  [{ ...target, score: 0.9 }, ...all.filter((chunk) => chunk.id !== target.id).map((chunk) => ({ ...chunk, score: 0.5 }))].slice(0, limit);

describe("vector recall in hybrid retrieval", () => {
  it("still finds the English passage for a Chinese claim when both model steps fail", async () => {
    expect(retrieveEvidence(CLAIM, chunks)).toEqual([]); // 词面检索一个词都对不上
    vector.rank = semantic;
    model({ expand_query: () => new Response("busy", { status: 503 }), rank_evidence: () => new Response("busy", { status: 503 }) });
    const result = await hybridRetrieve(CLAIM, chunks, new AbortController().signal);
    expect(result.method).toBe("hybrid-v2");
    expect(result.embedding).toBe("multilingual-e5-small");
    expect(result.chunks[0].id).toBe(target.id);
    expect(result.warnings.join("")).toMatch(/查询扩展.*未完成/);
  });

  it("merges the vector list with the lexical lists before reranking", async () => {
    vector.rank = semantic;
    let pooled: string[] = [];
    const tools = model({
      expand_query: () => call("expand_query", { terms: ["pottery fragments", "storage rooms"] }), // 扩展词故意带偏，目标片段只能靠向量一路进候选
      rank_evidence: (body) => {
        pooled = (JSON.parse(body.messages[1].content) as { passages: { chunkId: string }[] }).passages.map((p) => p.chunkId);
        return call("rank_evidence", { ranking: pooled.map((id) => ({ chunkId: id, relevance: id === target.id ? 3 : 0 })) });
      },
    });
    const result = await hybridRetrieve(CLAIM, chunks, new AbortController().signal);
    expect(tools).toEqual(["expand_query", "rank_evidence"]);
    expect(pooled).toContain(target.id);
    expect(result.chunks[0].id).toBe(target.id);
    expect(result.method).toBe("hybrid-v2");
  });

  it("carries on without the vector list and says so when embedding fails", async () => {
    vector.rank = async () => { throw new Error("onnx runtime crashed"); };
    model({ expand_query: () => call("expand_query", { terms: ["sleep duration", "words recalled", "next morning"] }), rank_evidence: () => new Response("busy", { status: 503 }) });
    const result = await hybridRetrieve(CLAIM, chunks, new AbortController().signal);
    expect(result.method).toBe("hybrid-v1");
    expect(result.embedding).toBeUndefined();
    expect(result.chunks.map((chunk) => chunk.id)).toContain(target.id);
    expect(result.warnings.join("")).toMatch(/向量召回未完成/);
  });

  it("is skipped silently when no embedding model is installed", async () => {
    vector.available = false;
    vector.rank = async () => { throw new Error("must not be called"); };
    model({ expand_query: () => call("expand_query", { terms: ["sleep duration", "words recalled"] }), rank_evidence: () => new Response("busy", { status: 503 }) });
    const result = await hybridRetrieve(CLAIM, chunks, new AbortController().signal);
    expect(result.method).toBe("hybrid-v1");
    expect(result.warnings.join("")).not.toMatch(/向量/);
  });

  it("is reported in claim coverage", async () => {
    vector.rank = semantic;
    model({
      expand_query: () => call("expand_query", { terms: ["sleep duration"] }),
      rank_evidence: (body) => {
        const ids = (JSON.parse(body.messages[1].content) as { passages: { chunkId: string }[] }).passages.map((p) => p.chunkId);
        return call("rank_evidence", { ranking: ids.map((id) => ({ chunkId: id, relevance: id === target.id ? 3 : 1 })) });
      },
      judge_claim: () => call("judge_claim", { verdict: "supported", explanation: "结果段落说明睡眠更长者次日回忆的单词更多。", citations: [{ sourceId: "source-1", chunkId: target.id, quote: RESULT }] }),
    });
    const result = await checkClaim({ claim: CLAIM, evidenceText: DOCUMENT });
    expect(result).toMatchObject({ status: "complete", verdict: "supported", coverage: { method: "hybrid-v2", embedding: "multilingual-e5-small" } });
  });
});

describe("embedding helpers", () => {
  it("encodes mostly-English passages whole and splits long Chinese passages into overlapping windows", async () => {
    const { embeddingWindows } = await vi.importActual<typeof import("../embedding")>("../embedding");
    const english = RESULT.repeat(9);
    expect(embeddingWindows(english)).toEqual([english]);
    const chinese = "研究发现睡眠时间与次日的词语回忆成绩有关。".repeat(60);
    const windows = embeddingWindows(chinese);
    expect(windows.length).toBeGreaterThan(2);
    expect(Math.max(...windows.map((w) => w.length))).toBeLessThanOrEqual(420);
    expect(windows[0]).toBe(chinese.slice(0, 420));
    expect(chinese.endsWith(windows.at(-1)!)).toBe(true);
  });

  it("reports the model as unavailable when it is switched off", async () => {
    const actual = await vi.importActual<typeof import("../embedding")>("../embedding");
    vi.stubEnv("EMBEDDING_MODEL_DIR", "off");
    expect(actual.embeddingAvailable()).toBe(false);
    expect(await actual.rankByEmbedding("任意论断", chunks, 3, new AbortController().signal)).toBeNull();
  });
});
