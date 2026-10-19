import { describe, expect, it } from "vitest";
import { buildReportMarkdown } from "../report";
import { localDate, localTime, reportHtml } from "../report-html";
import { parseReference } from "../verify/extract";
import type { RefResult } from "../verify/types";

describe("printable HTML report", () => {
  it("renders headings, lists and paragraphs, and links plain URLs", () => {
    const html = reportHtml("# 引用体检报告\n\n结论统计：已核实 1\n\n## 文献 1\n\n- 数据库 DOI：10.1038/x\n- 来源页面：https://example.org/a?b=1&c=2", "引用体检报告");
    expect(html).toContain("<h1>引用体检报告</h1>");
    expect(html).toContain("<h2>文献 1</h2>");
    expect(html).toContain("<ul>\n<li>数据库 DOI：10.1038/x</li>");
    expect(html).toContain('<a href="https://example.org/a?b=1&amp;c=2">https://example.org/a?b=1&amp;c=2</a>');
    expect(html).toContain("<title>引用体检报告</title>");
  });

  it("escapes user text so a reference cannot inject markup", () => {
    const ref = parseReference('<script>alert(1)</script> Smith, J. (2020). <img src=x onerror="y">. Journal, 1, 2.', 1);
    const result: RefResult = { index: 1, raw: ref.raw, parsed: ref, verdict: "unverifiable", confidence: 0, summary: "无法核验", issues: [], notes: [], fields: [], steps: [] };
    const html = reportHtml(buildReportMarkdown([ref], new Map([[1, result]]), true), "引用体检报告");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("uses the local calendar date for file names and a readable local time in the report", () => {
    expect(localDate(new Date(2026, 9, 19, 1, 30))).toBe("2026-10-19");
    expect(localTime(new Date(2026, 9, 19, 1, 30))).toMatch(/^2026-10-19 01:30（UTC[+-]\d{1,2}(?::\d{2})?）$/);
  });
});
