import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReference } from "../extract";
import { citedNameOrder } from "../match";
import type { CrossrefItem } from "../sources/crossref";
import type { Author, WorkRecord } from "../types";

const CITED = "杨敏, 赵现朝, 钟泽杉, 等. 复杂约束下的五轴数控系统自适应速度规划[J]. 机械工程学报, 2020, 56(11): 161-171.";
// 机械工程学报 10.3901/JME.2020.11.161 在 Crossref 的实际登记（2026-11-16 查）：姓写在 given、名写在 family
const SWAPPED: Author[] = [["Min", "YANG"], ["Xianchao", "ZHAO"], ["Zeshan", "ZHONG"], ["Yi", "YUE"], ["Peng", "GAO"], ["Qiankun", "LI"]].map(([family, given]) => ({ family, given }));
const rec = (authors: Author[]): WorkRecord => ({ source: "crossref", title: "Adaptive Velocity Planning", authors, year: 2020 }) as WorkRecord;
const reorder = (authors: Author[], cited = CITED) => citedNameOrder(parseReference(cited, 1), rec(authors));

describe("citedNameOrder", () => {
  it("swaps family and given back when every cited author only fits reversed", () => {
    expect(reorder(SWAPPED)?.authors.slice(0, 4)).toEqual([
      { family: "Yang", given: "Min" }, { family: "Zhao", given: "Xianchao" }, { family: "Zhong", given: "Zeshan" }, { family: "Yue", given: "Yi" },
    ]);
  });

  it("leaves a correctly ordered record alone", () => {
    expect(reorder([{ family: "Yang", given: "Min" }, { family: "Zhao", given: "Xianchao" }, { family: "Zhong", given: "Zeshan" }])).toBeUndefined();
    expect(reorder([{ family: "Yang", given: "M." }, { family: "Zhao", given: "X." }])).toBeUndefined();
  });

  it("does not swap on mixed evidence, initials only, Han records, or a single cited author", () => {
    expect(reorder([SWAPPED[0], { family: "Zhao", given: "Xianchao" }, SWAPPED[2]])).toBeUndefined();
    expect(reorder([{ family: "Min", given: "Y" }, { family: "Xianchao", given: "Z" }])).toBeUndefined();
    expect(reorder([{ family: "杨", given: "敏" }, { family: "赵", given: "现朝" }])).toBeUndefined();
    expect(reorder(SWAPPED, CITED.replace("杨敏, 赵现朝, 钟泽杉, 等", "杨敏"))).toBeUndefined();
    expect(reorder([{ family: "Wang", given: "Fang" }, { family: "Li", given: "Lei" }])).toBeUndefined();
  });
});

const item: CrossrefItem = {
  DOI: "10.9999/name-order-fixture",
  title: ["复杂约束下的五轴数控系统自适应速度规划"],
  author: SWAPPED,
  issued: { "date-parts": [[2020]] },
  "container-title": ["机械工程学报"],
  volume: "56",
  issue: "11",
  page: "161-171",
  type: "journal-article",
};

beforeAll(async () => { await import("../verify"); }, 30_000);
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("verifyReference suggestion with a reversed pinyin registration", () => {
  it("builds the suggested citation with the cited name order and says so", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.crossref.org") {
        if (url.pathname === "/journals") return Response.json({ message: { items: [] } });
        return Response.json({ message: url.pathname === "/works" ? { items: [item] } : item });
      }
      if (url.hostname === "api.openalex.org") return new Response("{}", { status: 404 });
      throw new Error(`Unexpected request: ${url.hostname}`);
    });
    const { verifyReference } = await import("../verify");
    const r = await verifyReference(parseReference(CITED.replace(/\.$/, `. DOI: ${item.DOI}.`), 1), { openalexBudget: { left: 0 } });
    expect(r.verdict).toBe("verified");
    expect(r.suggestion).toMatch(/^YANG M, ZHAO X, ZHONG Z, et al\./);
    expect(r.notes.join("")).toContain("数据库登记的拼音作者姓和名顺序颠倒（登记为 Min Y, Xianchao Z, Zeshan Z 等），规范写法已按引文的汉字作者调回");
    // 数据库记录一栏仍是原登记；调回的作者另外带给前端（规范参考文献面板、BibTeX 导出用）
    expect(r.match?.authors[0]).toEqual({ family: "Min", given: "YANG" });
    expect(r.suggestionAuthors?.slice(0, 2)).toEqual([{ family: "Yang", given: "Min" }, { family: "Zhao", given: "Xianchao" }]);
  });
});
