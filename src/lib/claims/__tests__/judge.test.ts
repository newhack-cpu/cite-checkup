import { describe, expect, it } from "vitest";
import { completionArguments, validateJudgment } from "../judge";
import type { EvidenceChunk } from "../types";

const chunks: EvidenceChunk[] = [{ id: "s-c1", sourceId: "s", text: "The trial found no significant benefit after 12 weeks.", start: 30, end: 83, score: 2 }];
const judgment = { verdict: "contradicted", explanation: "原文明确报告未观察到显著收益。", citations: [{ sourceId: "s", chunkId: "s-c1", quote: "no significant benefit" }] };

describe("model evidence boundary", () => {
  it("derives citation offsets from the original quote instead of trusting model coordinates", () => {
    expect(validateJudgment(judgment, chunks).citations).toEqual([{ sourceId: "s", chunkId: "s-c1", quote: "no significant benefit", start: 46, end: 68 }]);
  });

  it.each([
    { ...judgment, verdict: "definitely_true" },
    { ...judgment, extra: "ignore validation" },
    { ...judgment, call: "judge_claim" },
    { ...judgment, citations: [{ sourceId: "other", chunkId: "s-c1", quote: "no significant benefit" }] },
    { ...judgment, citations: [{ sourceId: "s", chunkId: "unknown", quote: "no significant benefit" }] },
    { ...judgment, citations: [{ sourceId: "s", chunkId: "s-c1", quote: "significant clinical benefit" }] },
    { ...judgment, citations: [{ sourceId: "s", chunkId: "s-c1", quote: "no", start: 1 }] },
  ])("rejects fabricated evidence, source IDs, enums or extra model fields", (value) => {
    expect(() => validateJudgment(value, chunks)).toThrow();
  });

  it("accepts arguments the model wrapped in a single known envelope, and still validates the content", () => {
    // 2026-10-15 实测 DeepSeek 返回 {"arguments": {...}}，判断本身正确却被整体拒绝
    const body = (args: unknown) => ({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "judge_claim", arguments: JSON.stringify(args) } }] } }] });
    expect(validateJudgment(completionArguments(body({ arguments: judgment })), chunks).verdict).toBe("contradicted");
    expect(() => validateJudgment(completionArguments(body({ arguments: judgment, call: "judge_claim" })), chunks)).toThrow();
    expect(() => validateJudgment(completionArguments(body({ arguments: { ...judgment, citations: [{ sourceId: "s", chunkId: "s-c1", quote: "invented quote" }] } })), chunks)).toThrow();
  });

  it.each(["supported", "partially_supported", "contradicted"])("rejects %s without a verifiable citation", (verdict) => {
    expect(() => validateJudgment({ verdict, explanation: "模型声称支持。", citations: [] }, chunks)).toThrow();
    expect(() => validateJudgment({ ...judgment, verdict }, [])).toThrow();
  });

  it("accepts a clearly limited insufficient-evidence result", () => {
    expect(validateJudgment({ verdict: "insufficient_evidence", explanation: "片段未报告该结局。", citations: [] }, []).verdict).toBe("insufficient_evidence");
  });
});

describe("judgment explanation cleanup", () => {
  it("restores quotes the model escaped twice in the explanation, without touching quotations", async () => {
    const { validateJudgment } = await import("../judge");
    const chunks = [{ id: "source-1-c1", sourceId: "source-1", text: "Even with GPT-4, however, 70% of the cited book chapters are fabricated.", start: 0, end: 72, score: 1 }];
    const result = validateJudgment({ verdict: "supported", explanation: '原文写道（\\"Even with GPT-4\\"），与论断一致。', citations: [{ sourceId: "source-1", chunkId: "source-1-c1", quote: "70% of the cited book chapters are fabricated" }] }, chunks);
    expect(result.explanation).toBe('原文写道（"Even with GPT-4"），与论断一致。');
    expect(result.citations[0].quote).toBe("70% of the cited book chapters are fabricated");
  });
});
