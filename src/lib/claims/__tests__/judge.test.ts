import { describe, expect, it } from "vitest";
import { validateJudgment } from "../judge";
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

  it.each(["supported", "partially_supported", "contradicted"])("rejects %s without a verifiable citation", (verdict) => {
    expect(() => validateJudgment({ verdict, explanation: "模型声称支持。", citations: [] }, chunks)).toThrow();
    expect(() => validateJudgment({ ...judgment, verdict }, [])).toThrow();
  });

  it("accepts a clearly limited insufficient-evidence result", () => {
    expect(validateJudgment({ verdict: "insufficient_evidence", explanation: "片段未报告该结局。", citations: [] }, []).verdict).toBe("insufficient_evidence");
  });
});
