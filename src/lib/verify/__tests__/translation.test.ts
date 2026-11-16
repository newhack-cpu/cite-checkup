import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReference } from "../extract";
import type { CrossrefItem } from "../sources/crossref";
import { splitTrailingGroup, translationAuthorConflict } from "../translation";

const conflict = (raw: string, authors: { family: string; given?: string }[] = []) => translationAuthorConflict(parseReference(raw, 1), authors);

// 开发集双语子集里的写法（中文条目后括号附英文译名）
const CN_PART = "杨敏, 赵现朝, 钟泽杉, 等. 复杂约束下的五轴数控系统自适应速度规划[J]. 机械工程学报, 2020, 56(11): 161-171.";
const EN_TAIL = "Adaptive velocity planning under complex constraints for 5-axis CNC systems[J]. Journal of Mechanical Engineering, 2020, 56(11): 161-171.";

describe("splitTrailingGroup", () => {
  it("finds the matching bracket even with nested parentheses and [J] inside the translation", () => {
    const g = splitTrailingGroup("李春来, 刘建军. 中国月球探测进展(2011–2020)[J]. 空间科学学报, 2021, 41(1): 68-75. (Li C L, Liu J J. Progress of China’s lunar exploration (2011–2020)[J]. Chin J Space Sci, 2021, 41(1): 68-75.)");
    expect(g?.inner).toMatch(/^Li C L, Liu J J\. Progress/);
    expect(g?.outer).toMatch(/68-75\.$/);
  });

  it("returns undefined when the citation does not end with a bracket group", () => {
    expect(splitTrailingGroup(CN_PART)).toBeUndefined();
  });
});

describe("translation authors against the Chinese authors", () => {
  it("passes a faithful translation in initials, full names, or with ü written as Lü", () => {
    expect(conflict(`${CN_PART} (Yang M, Zhao X C, Zhong Z S, et al. ${EN_TAIL})`)).toBeUndefined();
    expect(conflict(`${CN_PART} (Yang Min, Zhao Xianchao, Zhong Zeshan, et al. ${EN_TAIL})`)).toBeUndefined();
    expect(conflict("祝英, 熊俊兰, 吕广超, 等. 丛枝菌根真菌与植物共生对植物水分关系的影响及机理[J]. 生态学报, 2015, 35(8): 2419-2427. (Zhu Y, Xiong J L, Lü G C, et al. Effects of arbuscular mycorrhizal fungi and plant symbiosis on plant water relation and its mechanism[J]. Acta Ecol Sin, 2015, 35(8): 2419-2427.)")).toBeUndefined();
  });

  it("flags a translation whose pinyin authors are another group of people (initials and full names)", () => {
    const initials = conflict(`${CN_PART} (Zhang Z B, Yang Y, Zhang X P, et al. ${EN_TAIL})`);
    expect(initials?.unmatched).toEqual(["Zhang Z B", "Yang Y", "Zhang X P"]);
    expect(initials?.han).toEqual(["杨敏", "赵现朝", "钟泽杉"]);
    // 解析器认不出全拼姓名，作者段取题名前面那段
    expect(conflict(`${CN_PART} (Huang Xiaodong, Ding Wensi, Du Qungui, et al. ${EN_TAIL})`)?.unmatched).toHaveLength(3);
  });

  it("accepts any reading of a polyphonic surname and a given-name-first order", () => {
    const raw = (en: string) => `单雪, 曾明. 复杂约束下的五轴数控系统自适应速度规划[J]. 机械工程学报, 2020, 56(11): 161-171. (${en}. ${EN_TAIL})`;
    expect(conflict(raw("Shan X, Zeng M"))).toBeUndefined();
    expect(conflict(raw("Xue Shan, Ming Zeng"))).toBeUndefined();
  });

  it("does not flag when only a minority of names disagree", () => {
    expect(conflict(`${CN_PART} (Yang M, Zhao X C, Wang Q, et al. ${EN_TAIL})`)).toBeUndefined();
  });

  it("skips non-pinyin romanizations such as Wade–Giles instead of calling them wrong", () => {
    expect(conflict(`张学友, 蔡明. 复杂约束下的五轴数控系统自适应速度规划[J]. 机械工程学报, 2020, 56(11): 161-171. (Chang H Y, Tsai M. ${EN_TAIL})`)).toBeUndefined();
  });

  it("skips a parenthetical that is not this article's translation (different year)", () => {
    expect(conflict(`${CN_PART} (Zhang Z B, Yang Y. ${EN_TAIL.replace(/2020/g, "2019")})`)).toBeUndefined();
  });

  it("also reads the English-first form with the Chinese original in square brackets", () => {
    const raw = `Zhang Z B, Yang Y, Zhang X P, et al. ${EN_TAIL.replace(/\.$/, "")} [${CN_PART.replace(/\.$/, "")}]`;
    expect(conflict(raw)?.unmatched).toHaveLength(3);
    expect(conflict(raw.replace("Zhang Z B, Yang Y, Zhang X P", "Yang M, Zhao X C, Zhong Z S"))).toBeUndefined();
  });

  it("clears a reordered English author list when the record lists those authors (科学通报 2013, 58(21))", () => {
    // 期刊英文著录把徐冠华、葛全胜、宫鹏排在前面，中英两段都只写前三位加“等”
    const raw = "程邦波, 徐冰, 罗勇, 等. 全球变化和人类可持续发展: 挑战与对策[J]. 科学通报, 2013, 58(21): 2100-2106. (Xu G H, Ge Q S, Gong P, et al. Societal response to challenges of global change and human sustainable development[J]. Chin Sci Bull (Chin Ver), 2013, 58(21): 2100-2106.)";
    expect(conflict(raw)?.unmatched).toEqual(["Xu G H", "Ge Q S", "Gong P"]);
    const recorded = [["程", "邦波"], ["徐", "冰"], ["罗", "勇"], ["宫", "鹏"], ["葛", "全胜"], ["徐", "冠华"], ["方", "修琦"], ["何", "斌"]].map(([family, given]) => ({ family, given }));
    expect(conflict(raw, recorded)).toBeUndefined();
    // 记录只登记了拼音也一样
    expect(conflict(raw, [{ family: "Xu", given: "Guanhua" }, { family: "Ge", given: "Quansheng" }, { family: "Gong", given: "Peng" }])).toBeUndefined();
  });

  it("ignores citations without a translation", () => {
    expect(conflict(CN_PART)).toBeUndefined();
    expect(conflict("Zhang Z B, Yang Y. Wind speed changes in Southwestern China (in Chinese)[J]. Acta Ecol Sin, 2014, 34(2): 471-481.")).toBeUndefined();
  });
});

// 接进核验流程：有已确认的同一篇记录时，已核实改成信息有误；记录里查得到译名作者时不改
const item: CrossrefItem = {
  DOI: "10.9999/translation-fixture",
  title: ["复杂约束下的五轴数控系统自适应速度规划"],
  author: [{ family: "杨", given: "敏" }, { family: "赵", given: "现朝" }, { family: "钟", given: "泽杉" }, { family: "王", given: "宇晗" }],
  issued: { "date-parts": [[2020]] },
  "container-title": ["机械工程学报"],
  volume: "56",
  issue: "11",
  page: "161-171",
  type: "journal-article",
};

function serve() {
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "api.crossref.org") {
      if (url.pathname === "/journals") return Response.json({ message: { items: [] } });
      return Response.json({ message: url.pathname === "/works" ? { items: [item] } : item });
    }
    if (url.hostname === "api.openalex.org") return new Response("{}", { status: 404 });
    throw new Error(`Unexpected request: ${url.hostname}`);
  });
}

async function check(raw: string) {
  const { verifyReference } = await import("../verify");
  return verifyReference(parseReference(raw, 1), { openalexBudget: { left: 0 } });
}

const WITH_DOI = CN_PART.replace(/\.$/, `. DOI: ${item.DOI}.`);

beforeAll(async () => { await import("../verify"); }, 30_000);
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("verifyReference with a translated citation", () => {
  it("keeps a faithful translation verified", async () => {
    serve();
    const r = await check(`${WITH_DOI} (Yang M, Zhao X C, Zhong Z S, et al. ${EN_TAIL})`);
    expect(r.verdict).toBe("verified");
  });

  it("turns verified into mismatch when the translation names another group of people", async () => {
    serve();
    const r = await check(`${WITH_DOI} (Zhang Z B, Yang Y, Zhang X P, et al. ${EN_TAIL})`);
    expect(r.verdict).toBe("mismatch");
    expect(r.summary).toMatch(/^文献存在，但引文附的英文译名里作者与中文作者不是同一批人（来源：Crossref）/);
    expect(r.issues.join("")).toContain("Zhang Z B、Yang Y、Zhang X P 在中文作者（杨敏、赵现朝、钟泽杉）和数据库登记的作者里都找不到对应的人");
    expect(r.match).toBeTruthy();
  });

  it("does not flag translation authors that the record lists beyond the cited ones", async () => {
    serve();
    // 英文著录换了顺序、只写了第 4 位作者：记录里有王宇晗，算对上
    const r = await check(`${WITH_DOI} (Wang Y H, Yang M, Zhao X C, et al. ${EN_TAIL})`);
    expect(r.verdict).toBe("verified");
  });
});
