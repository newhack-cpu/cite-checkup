import { describe, expect, it } from "vitest";
import { buildClaimReport } from "../claim-report";
import type { ClaimResult } from "../claims/types";

const result: ClaimResult = {
  status: "complete", claim: "研究观察到改善。", verdict: "supported", explanation: "提供的片段支持该说法。",
  citations: [{ sourceId: "source-1", chunkId: "chunk-1", quote: "观察到改善", start: 3, end: 8 }],
  chunks: [{ id: "chunk-1", sourceId: "source-1", text: "研究中观察到改善。", start: 0, end: 10, score: 1 }],
  source: { id: "source-1", kind: "crossref_abstract", label: "Crossref 摘要", scope: "abstract", retrievedAt: "2026-10-14T00:00:00Z", totalChars: 10 },
  coverage: { scope: "abstract", totalChunks: 1, retrievedChunks: 1, retrievedChars: 10, method: "bm25-en-zh-v1" }, warnings: [], model: "deepseek-flash",
};

describe("论断报告的判断和来源边界", () => {
  it("摘要证据不冒充全文，并带回可定位的引句与片段", () => {
    const report = buildClaimReport(result);
    expect(report).toContain("数据库摘要，未核查全文");
    expect(report).toContain("[chunk-1] 观察到改善（文本位置 4–8）");
    expect(report).toContain("研究中观察到改善");
  });
  it("未完成结果即使带有过时的verdict也不导出成功判断", () => {
    const report = buildClaimReport({ ...result, status: "incomplete", citations: [] });
    expect(report).toContain("核查状态：未完成");
    expect(report).toContain("本次未形成判断");
    expect(report).not.toContain("判断：证据支持");
  });
  it("用户来源明确未认证，HTML与伪造Markdown标题以文字导出", () => {
    const report = buildClaimReport({ ...result, claim: "<script>bad</script>\n# 假标题", source: { ...result.source!, kind: "user_provided", scope: "user_provided_text" } });
    expect(report).toContain("用户提供的文本，未独立认证来源");
    expect(report).not.toContain("<script>");
    expect(report).not.toContain("\n# 假标题");
  });
});
