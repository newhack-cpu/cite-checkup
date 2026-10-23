import { describe, expect, it } from "vitest";
import { buildFixedList, buildReportMarkdown, buildStandardList, standardEntries } from "../report";
import { parseReference } from "../verify/extract";
import type { RefResult } from "../verify/types";
const refs = [parseReference("Original reference 2020.", 1), parseReference("Another reference 2021.", 2)];
const base: RefResult = { index: 1, raw: refs[0].raw, parsed: refs[0], verdict: "concern", confidence: 0.9, summary: "期刊发布关注声明", suggestion: "Correct metadata 2020.", issues: [], notes: [], fields: [], steps: [] };
describe("report exports", () => {
  it("keeps the original when the DOI is wrong and only a similar candidate was found", () => {
    const candidate = { ...base, verdict: "mismatch" as const, matchStatus: "candidate" as const, suggestion: "A different article. DOI: 10.9999/other" };
    const list = buildFixedList(refs.slice(0, 1), new Map([[1, candidate]]));
    expect(list).toContain("Original reference 2020.");
    expect(list).toContain("候选");
    expect(list).not.toContain("10.9999/other");
  });
  it("keeps the original for a near match and reports it apart from wrong information", () => {
    const near: RefResult = {
      ...base, verdict: "near_match", matchStatus: "candidate", summary: "找到相近文献，但不能确认是同一篇，请人工核对",
      suggestion: "A different article. DOI: 10.9999/other",
    };
    expect(buildFixedList(refs.slice(0, 1), new Map([[1, near]]))).toBe("[1] Original reference 2020. 【仅找到相近候选，请人工确认是否同一篇】");
    const text = buildReportMarkdown(refs.slice(0, 1), new Map([[1, near]]), true);
    expect(text).toContain("结论统计：相近候选 1");
    expect(text).toContain("不算信息有误");
    expect(text).toContain("结论：【相近候选】找到相近文献");
    expect(text).toContain("相近候选写法（待确认，不能直接替换）");
  });
  it("counts confirmed errors and near matches separately in the report", () => {
    const wrong: RefResult = { ...base, verdict: "mismatch", matchStatus: "confirmed", summary: "文献存在，但有 1 处信息与数据库记录不一致" };
    const near: RefResult = { ...base, index: 2, raw: refs[1].raw, parsed: refs[1], verdict: "near_match", matchStatus: "candidate", summary: "找到相近文献" };
    const text = buildReportMarkdown(refs, new Map([[1, wrong], [2, near]]), true);
    expect(text).toContain("结论统计：信息有误 1，相近候选 1");
    expect(text).toContain("结论：【信息有误】文献存在");
  });
  it("does not repeat the verdict when the summary already starts with it", () => {
    const ok: RefResult = { ...base, verdict: "verified", summary: "已核实：与数据库记录一致（来源：Crossref）" };
    const text = buildReportMarkdown(refs.slice(0, 1), new Map([[1, ok]]), true);
    expect(text).toContain("结论：已核实：与数据库记录一致");
    expect(text).not.toContain("【已核实】");
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

describe("standard reference list", () => {
  const record = { source: "crossref" as const, doi: "10.1162/neco.1997.9.8.1735", title: "Long Short-Term Memory", authors: [{ family: "Hochreiter", given: "Sepp" }, { family: "Schmidhuber", given: "Jürgen" }], year: 1997, venue: "Neural Computation", volume: "9", issue: "8", pages: "1735-1780", type: "journal-article" };
  const zhRecord = { source: "crossref" as const, title: "深度学习研究综述", authors: [{ family: "张", given: "三" }], year: 2020, venue: "计算机学报", volume: "43", issue: "1", pages: "1-20", type: "journal-article" };
  const list = [
    parseReference("[1] Hochreiter S. Long short term memory. 1997.", 1),
    parseReference("Wang X. A made-up paper. Journal of Nothing, 2021.", 2),
    parseReference("张三. 深度学习研究综述[J]. 计算机学报, 2020.", 3),
    parseReference("Smith J. Similar title. 2019.", 4),
  ];
  const done = (index: number, extra: Partial<RefResult>): [number, RefResult] => [index, { ...base, index, raw: list[index - 1].raw, parsed: list[index - 1], ...extra }];
  const results = new Map<number, RefResult>([
    done(1, { verdict: "mismatch", matchStatus: "confirmed", match: record, suggestion: "x" }),
    done(2, { verdict: "not_found", suggestion: undefined }),
    done(3, { verdict: "verified", matchStatus: "confirmed", match: zhRecord, suggestion: "y" }),
    done(4, { verdict: "near_match", matchStatus: "candidate", match: record, suggestion: "z" }),
  ]);

  it("rewrites confirmed entries from the database record in GB/T 7714 and keeps the order and numbers", () => {
    const text = buildStandardList(list, results, "gbt").split("\n");
    expect(text[0]).toBe("[1] HOCHREITER S, SCHMIDHUBER J. Long Short-Term Memory[J]. Neural Computation, 1997, 9(8): 1735-1780. DOI: 10.1162/neco.1997.9.8.1735.");
    expect(text[1]).toBe("[2] Wang X. A made-up paper. Journal of Nothing, 2021. 【疑似不存在，请核实或删除】");
    expect(text[2]).toBe("[3] 张三. 深度学习研究综述[J]. 计算机学报, 2020, 43(1): 1-20.");
    expect(text[3]).toBe("[4] Smith J. Similar title. 2019. 【仅找到相近候选，请人工确认是否同一篇】");
  });

  it("sorts APA entries by first author without numbers", () => {
    const text = buildStandardList(list, results, "apa").split("\n");
    expect(text).toHaveLength(4);
    expect(text.some((line) => /^\[\d+\]/.test(line))).toBe(false);
    expect(text.indexOf("Hochreiter, S., & Schmidhuber, J. (1997). Long Short-Term Memory. Neural Computation, 9(8), 1735–1780. https://doi.org/10.1162/neco.1997.9.8.1735")).toBeLessThan(text.findIndex((line) => line.startsWith("Smith J.")));
  });

  it("never rewrites a candidate, and marks unfinished and retracted entries", () => {
    const more = new Map(results);
    more.set(1, { ...results.get(1)!, verdict: "retracted" });
    more.delete(2);
    const entries = standardEntries(list, more, "gbt");
    expect(entries[0]).toMatchObject({ rewritten: true, note: "已撤稿 / 撤回，建议删除或替换" });
    expect(entries[1]).toMatchObject({ rewritten: false, note: "未完成核查" });
    expect(entries[3]).toMatchObject({ rewritten: false, text: "Smith J. Similar title. 2019." });
    // 服务端没给规范写法（记录缺作者等）时，已核实的也保留原文
    more.set(3, { ...results.get(3)!, suggestion: undefined });
    expect(standardEntries(list, more, "gbt")[2]).toMatchObject({ rewritten: false, note: "已核实，数据库记录不全，保留原文" });
  });
});
