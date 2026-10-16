import { describe, expect, it } from "vitest";
import { buildFixedList, buildReportMarkdown } from "../report";
import { parseReference } from "../verify/extract";
import type { RefResult } from "../verify/types";
const refs = [parseReference("Original reference 2020.", 1), parseReference("Another reference 2021.", 2)];
const base: RefResult = { index: 1, raw: refs[0].raw, parsed: refs[0], verdict: "concern", confidence: 0.9, summary: "期刊发布关注声明", suggestion: "Correct metadata 2020.", issues: [], notes: [], fields: [], steps: [] };
describe("report exports", () => {
  it("keeps the original when a similar candidate has not been confirmed", () => {
    const candidate = { ...base, verdict: "mismatch" as const, matchStatus: "candidate" as const, suggestion: "A different article. DOI: 10.9999/other" };
    const list = buildFixedList(refs.slice(0, 1), new Map([[1, candidate]]));
    expect(list).toContain("Original reference 2020.");
    expect(list).toContain("候选");
    expect(list).not.toContain("10.9999/other");
  });
  it("labels missing entries instead of silently copying them as checked", () => {
    expect(buildFixedList(refs, new Map([[1, base]]))).toContain("[2] Another reference 2021. 【未完成核查】");
  });
  it("does not describe a concern notice as a retraction", () => {
    const list = buildFixedList(refs.slice(0, 1), new Map([[1, base]]));
    expect(list).toContain("关注声明");
    expect(list).not.toContain("已撤稿");
  });
  it("exports completion status, source evidence and unresolved references", () => {
    const r = { ...base, steps: [{ action: "openalex_lookup" as const, detail: "出版社关注声明", ok: true, ms: 50 }] };
    const text = buildReportMarkdown(refs, new Map([[1, r]]), false);
    expect(text).toContain("未完成");
    expect(text).toContain("Original reference 2020.");
    expect(text).toContain("出版社关注声明");
    expect(text).toContain("Another reference 2021.");
    expect(text).not.toContain("健康度：100");
  });
  it("records the AI search plan and states that the rules decided", () => {
    const r: RefResult = {
      ...base, verdict: "verified", summary: "已核实",
      steps: [{ action: "agent_search", reason: "按书名加作者检索", detail: "Crossref 检索「Deep learning」：1 条候选", ok: true, ms: 120 }],
      agent: { model: "m", toolCalls: 1, rounds: 1, outcome: "confirmed", before: { verdict: "unverifiable", summary: "图书类文献不在覆盖范围" }, ms: 900 },
    };
    const text = buildReportMarkdown(refs.slice(0, 1), new Map([[1, r]]), true);
    expect(text).toContain("AI 检索理由：按书名加作者检索");
    expect(text).toContain("AI 检索：AI 检索 1 次找到候选，规则逐字段比对确认是同一篇");
    expect(text).toContain("结论由规则复核给出");
  });
});
