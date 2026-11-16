import { describe, expect, it } from "vitest";
import { buildBibtex } from "../bibtex";
import { standardEntries } from "../report";
import { parseReference } from "../verify/extract";
import type { RefResult, Verdict, WorkRecord } from "../verify/types";

const nature: WorkRecord = {
  source: "crossref",
  doi: "10.1038/nature14539",
  title: "Deep learning",
  authors: [{ family: "LeCun", given: "Yann" }, { family: "Bengio", given: "Yoshua" }, { family: "Hinton", given: "Geoffrey" }],
  year: 2015,
  venue: "Nature",
  volume: "521",
  issue: "7553",
  pages: "436-444",
  type: "journal-article",
};

function result(index: number, verdict: Verdict, match?: WorkRecord, extra: Partial<RefResult> = {}): RefResult {
  return {
    index, raw: `[${index}] x`, verdict, confidence: 0.9, summary: "", issues: [], notes: [], fields: [], steps: [],
    parsed: parseReference(`[${index}] x`, index), match, matchStatus: match ? "confirmed" : undefined, suggestion: match ? "s" : undefined, ...extra,
  };
}

const refs = [1, 2, 3, 4].map((i) => parseReference(`[${i}] 引文 ${i}`, i));

describe("buildBibtex", () => {
  it("exports confirmed records with database fields and lists the rest by number", () => {
    const results = new Map<number, RefResult>([
      [1, result(1, "verified", nature)],
      [2, result(2, "near_match", nature, { matchStatus: "candidate" })],
      [3, result(3, "not_found")],
      [4, result(4, "mismatch", { ...nature, doi: "10.1/x", title: "Deep learning: a review & outlook_100%", year: 2015, type: "proceedings-article", venue: "Proc. CVPR" })],
    ]);
    const out = buildBibtex(refs, results, "2026-11-16");
    expect(out.exported).toBe(2);
    expect(out.skipped).toEqual([2, 3]);
    expect(out.text).toContain("% 引用体检导出（2026-11-16）：只含数据库确认是同一篇的 2 条");
    expect(out.text).toContain("第 2、3 条");
    expect(out.text).toContain(`@article{lecun2015,
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  title = {Deep learning},
  journal = {Nature},
  year = {2015},
  volume = {521},
  number = {7553},
  pages = {436--444},
  doi = {10.1038/nature14539}
}`);
    // 同一作者同一年第二条加后缀；会议论文用 booktitle；特殊字符转义
    expect(out.text).toContain("@inproceedings{lecun2015a,");
    expect(out.text).toContain("booktitle = {Proc. CVPR}");
    expect(out.text).toContain("title = {Deep learning: a review \\& outlook\\_100\\%}");
  });

  it("keeps Chinese names whole, keys them by number, and marks retractions", () => {
    const zh: WorkRecord = { source: "web", site: "知网", title: "金砖国家科学数据发展政策与规划", authors: [{ family: "张", given: "耀南" }, { family: "中国科学院" }], year: 2024, venue: "中国科学数据", url: "https://example.cn/a", type: "journal-article" };
    const out = buildBibtex(refs.slice(0, 1), new Map([[1, result(1, "retracted", zh)]]), "2026-11-16");
    expect(out.text).toContain("@article{ref12024,");
    expect(out.text).toContain("author = {{张耀南} and {中国科学院}}");
    expect(out.text).toContain("url = {https://example.cn/a}");
    expect(out.text).toContain("note = {已撤稿 / 撤回}");
  });

  it("uses the server-corrected author order when the registration swapped family and given", () => {
    const swapped: WorkRecord = { ...nature, title: "Adaptive Velocity Planning", authors: [{ family: "Min", given: "YANG" }, { family: "Xianchao", given: "ZHAO" }] };
    const r = result(1, "verified", swapped, { suggestionAuthors: [{ family: "Yang", given: "Min" }, { family: "Zhao", given: "Xianchao" }] });
    const results = new Map([[1, r]]);
    expect(buildBibtex(refs.slice(0, 1), results).text).toContain("author = {Yang, Min and Zhao, Xianchao}");
    // 规范参考文献面板同一份作者
    expect(standardEntries(refs.slice(0, 1), results, "gbt")[0].text).toMatch(/^YANG M, ZHAO X\. /);
  });

  it("produces only the header when nothing is confirmed", () => {
    const out = buildBibtex(refs.slice(0, 2), new Map([[1, result(1, "unverifiable")]]), "2026-11-16");
    expect(out.exported).toBe(0);
    expect(out.text).not.toContain("@");
  });
});
