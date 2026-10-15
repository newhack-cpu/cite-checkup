import { describe, expect, it } from "vitest";
import { chunkEvidence, normalizeEvidence, retrieveEvidence } from "../retrieval";

describe("local evidence retrieval", () => {
  it("preserves exact normalized offsets while bounding every chunk", () => {
    const source = normalizeEvidence("  Trial\r\nresults.\r\n\r\n" + "长期随访发现无显著改善。".repeat(400));
    const chunks = chunkEvidence(source, "source-1");
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(source.length);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(source.slice(chunk.start, chunk.end));
      expect(chunk.text.length).toBeLessThanOrEqual(1_200);
    }
  });

  it("retrieves a late English trial passage instead of the first page", () => {
    const source = "Historical background about pottery and ceramics. ".repeat(300) +
      "A randomized trial found exercise reduced fatigue in adult participants after twelve weeks.";
    const result = retrieveEvidence("Exercise reduced fatigue in the randomized trial.", chunkEvidence(source, "s"));
    expect(result[0].text).toContain("exercise reduced fatigue");
    expect(result[0].start).toBeGreaterThan(10_000);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("retrieves Chinese evidence using bigrams without an external embedding service", () => {
    const source = "本节讨论陶瓷材料的历史。".repeat(300) + "随机对照试验发现，运动干预并未显著改善参与者的睡眠质量。";
    const result = retrieveEvidence("运动干预改善睡眠质量", chunkEvidence(source, "s"));
    expect(result[0].text).toContain("并未显著改善");
    expect(result[0].start).toBeGreaterThan(1_000);
  });

  it("returns no evidence for unrelated tokens and breaks score ties deterministically", () => {
    const chunks = chunkEvidence("The pottery was painted blue.", "s");
    expect(retrieveEvidence("randomized exercise trial", chunks)).toEqual([]);
    expect(retrieveEvidence("pottery", chunks)).toEqual(retrieveEvidence("pottery", chunks));
  });
});
