// test 集（eval/real-world/test-2026-10-14.json）盲测后剩下的误报，以及图片评测里发现的一条（宫鹏 2010）。
// 这些文献都真实存在；括号里是条目编号。数据库记录按当时 Crossref / OpenAlex 返回的内容简化而来。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detectKind, guessAuthors, guessTitle, guessVenue, parseReference, splitReferences } from "../extract";
import { scoreCandidate } from "../match";
import type { Author, WorkRecord } from "../types";

const RAW = {
  T006: "Ohm, D., Fiedler, F., Zimmermann, F., Kraxenberger, T., Maier, R., Hantschel, S., & Otto, M. (2015). Anlagen und Anlagenverzeichnis: FE 77.0496/2010: Führung des Radverkehrs im Mischverkehr. [Facility and facility inventory: FE 77.0496/2010: Guidance of cyclists in mixed traffic]. Berichte der Bundesanstalt für Straßenwesen V, Verkehrstechnik: Vol. 52. Bremen, Germany: Fachverlag NW.",
  T007: "Anderberg Y, Thelandersson S. Stress and deformation characteristics of concrete at high temperature: 2. Experimental investigation and material behaviour model. Bull. No. 46, Lund; 1976, p. 86.",
  T019: "Esper RC, Bustos EP, Arroyo SO, et al.. Liver involvement in severe human influenza A H1N1. Ann Hepatol. 2013, 9:107-11. 10.1016/S1665-2681(19)31691-6",
  T038: "Chiliveri S, Grandhi J, Patil MU, Pr LE, Ethirajan M. ProveDoc: a blockchain based proof of existence with proof of storage. In: 2019 International Conference on Information Technology (ICIT), Bhubaneswar, India; 2019. IEEE; p. 239–244.",
  T046: "A. Esme, “Quantum Chemical Calculations on the Geometrical, Conformational, Spectroscopic (FTIR, FT-Raman) Analysis and NLO Activity of Milrinone [5-Cyano-2-Methyl-(3, 4'-Bipyridin)-6 (1h)-One] by Using Hartree-Fock and Density Functional Methods,” Indian Journal of Pure & Applied Physics (IJPAP) 55, no. 7 (2017): 478–489.",
  T050: "Taconet, M., Kroodsma, D., and Fernandes, J.A. (2019). Global Atlas of AIS-Based Fishing Activity—Challenges and Opportunities, FAO.",
  T066: "Nutrition landscape information system (NLiS)",
  T072: "Beltran WA. On the Role of CNTF as a Pontential Therapy for Retinal Degeneration: Dr. Jekyll or Mr. Hyde? Recent Advances in Retinal Degeneration: Springer; 2008. p. 45–51.",
  T075: "McMillan B, Bentley SV, Haslam SA, Peters K, Steffens NK, Modderman T. Report on the Mackay trial of the 5R Leadership Development Program. Paper presented at: Leading Well conference; November 27, 2018; Brisbane.",
  T091: "Silverman, B. W. Density Estimation For Statistics and Data Analysis; Chapman & Hall/CRC: 1986; p 45.",
  T095: "aSundberg, R. J. Indoles; Elsevier, 1996.",
  T096: "冉祥滨, 车宏, 臧家业, 于永贵, 刘森, 郑莉莉. 2015. 黄河流域硅的组成与输出. 中国科学: 地球科学, 45: 982–993.",
  T117: "窦杰，向子林，许强，等. 机器学习在滑坡智能防灾减灾中的应用与发展趋势[J]. 地球科学，2023，48(5)：1 657–1 675.",
  GONG: "宫鹏, 牛振国, 程晓, 等. 中国1990和2000基准年湿地变化遥感[J]. 中国科学: 地球科学, 2010, 40(6): 768-775.",
};

const ref = (raw: string) => parseReference(raw, 1);
const han = (...names: string[]): Author[] => names.map((n) => ({ family: n[0], given: n.slice(1) }));
const record = (over: Partial<WorkRecord>): WorkRecord => ({ source: "crossref", title: "", authors: [], ...over });

describe("parsing the remaining test-set false alarms", () => {
  it("does not end a title at Dr. or at a numbered part such as ': 2.' (T072, T007)", () => {
    expect(guessTitle(RAW.T072)).toBe("On the Role of CNTF as a Pontential Therapy for Retinal Degeneration: Dr. Jekyll or Mr. Hyde");
    expect(guessTitle(RAW.T007)).toBe("Stress and deformation characteristics of concrete at high temperature: 2. Experimental investigation and material behaviour model");
  });

  it.each([
    ["T006", "report"], ["T007", "report"], ["T050", "report"], ["T075", "presentation"],
    ["T072", "book"], ["T091", "book"], ["T095", "book"],
  ] as const)("recognises %s as %s, which open databases cover poorly", (id, kind) => {
    expect(detectKind(RAW[id])).toBe(kind);
  });

  it("keeps the journal-article reading when a publisher name is only part of a journal citation", () => {
    expect(detectKind("Smith J. A study of things. Springer Nature Reviews. 2020;12(3):45-60.")).toBe("journal");
  });

  it("drops a footnote letter glued to the first surname (T095)", () => {
    expect(guessAuthors(RAW.T095)).toBe("Sundberg, R. J");
  });

  it("reads the journal after an IEEE-style closing quote (T046)", () => {
    expect(guessVenue(RAW.T046, guessTitle(RAW.T046))).toBe("Indian Journal of Pure & Applied Physics");
  });

  it("strips the number of a single pasted entry", () => {
    expect(splitReferences(`[1] ${RAW.GONG}`)).toEqual([RAW.GONG]);
    expect(guessAuthors(splitReferences(`[1] ${RAW.GONG}`)[0])).toBe("宫鹏, 牛振国, 程晓, 等");
  });
});

describe("author comparison on the remaining test-set false alarms", () => {
  it("accepts compound surnames cited by one surname plus initials (T038, T019)", () => {
    const provedoc = record({
      title: "ProveDoc: A Blockchain Based Proof of Existence with Proof of Storage", year: 2019,
      authors: [{ family: "Chiliveri", given: "S" }, { family: "Grandhi", given: "J" }, { family: "Uttam Patil", given: "M" }, { family: "P.R. LE" }, { family: "Ethirajan", given: "M" }],
    });
    expect(scoreCandidate(ref(RAW.T038), provedoc)).toMatchObject({ firstAuthor: "match", authorListMismatch: false });
    const liver = record({
      title: "Liver involvement in severe human influenza A H1N1", year: 2010,
      authors: [{ family: "Carrillo Esper", given: "Raúl" }, { family: "Pérez Bustos", given: "Eduardo" }, { family: "Ornelas Arroyo", given: "Sara" }],
    });
    expect(scoreCandidate(ref(RAW.T019), liver)).toMatchObject({ firstAuthor: "match", authorListMismatch: false });
  });

  it("compares Chinese-character authors with a pinyin record, and pinyin authors with a Chinese record (T117)", () => {
    const pinyinRecord = record({
      title: "机器学习在滑坡智能防灾减灾中的应用与发展趋势", year: 2023,
      authors: [{ family: "Dou", given: "Jie" }, { family: "Xiang", given: "Zilin" }, { family: "Xu", given: "Qiang" }, { family: "Zheng", given: "Peng" }],
    });
    expect(scoreCandidate(ref(RAW.T117), pinyinRecord)).toMatchObject({ authorRatio: 1, firstAuthor: "match", authorOrderOk: true, authorListMismatch: false });
    // 张冠李戴的作者照样查得出来
    const wrong = scoreCandidate(ref("王明，李华，等. 机器学习在滑坡智能防灾减灾中的应用与发展趋势[J]. 地球科学，2023，48(5)：1657–1675."), pinyinRecord);
    expect(wrong.firstAuthor).toBe("mismatch");

    const hanRecord = record({ title: "Remote sensing of wetland change in China", year: 2010, authors: han("宫鹏", "牛振国", "程晓") });
    expect(scoreCandidate(ref("Gong P, Niu Z, Cheng X. Remote sensing of wetland change in China. Sci China Earth Sci. 2010;53(7):1036-42."), hanRecord))
      .toMatchObject({ firstAuthor: "match", authorOrderOk: true, authorListMismatch: false });
  });

  it("treats a different author order in a Chinese record as a note, not an error (T096, Gong 2010)", () => {
    const silicon = record({ title: "黄河流域硅的组成与输出", year: 2015, authors: han("冉祥滨", "车宏", "臧家业", "郑莉莉", "于永贵", "刘森") });
    expect(scoreCandidate(ref(RAW.T096), silicon).authorsReordered).toBe(true);
    // Crossref 记录里宫鹏排在第 14 位
    const wetland = record({
      title: "中国1990和2000基准年湿地变化遥感", year: 2010,
      authors: han("赵魁义", "王晓风", "杨镇钟", "李丹丹", "王坤", "迟耀斌", "庄大方", "周德民", "程晓", "周会珍", "王毅", "李文宁", "王显威", "宫鹏", "叶玉芳", "应清", "闫军", "牛振国"),
    });
    expect(scoreCandidate(ref(RAW.GONG), wetland)).toMatchObject({ authorsReordered: true, same: true });
    // 引文里有数据库没有的作者时，仍按作者不符处理
    expect(scoreCandidate(ref("宫鹏, 张三, 等. 中国1990和2000基准年湿地变化遥感[J]. 中国科学: 地球科学, 2010, 40(6): 768-775."), wetland).authorsReordered).toBe(false);
  });

  it("still reports a wrong author order in an English record", () => {
    const deep = record({ title: "Deep learning", year: 2015, venue: "Nature", authors: [{ family: "LeCun", given: "Yann" }, { family: "Bengio", given: "Yoshua" }, { family: "Hinton", given: "Geoffrey" }] });
    const score = scoreCandidate(ref("Bengio, Y., LeCun, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444."), deep);
    expect(score.authorOrderOk).toBe(false);
    expect(score.authorsReordered).toBeUndefined();
  });
});

type Route = [RegExp, () => Response];

function serve(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    const path = url.hostname + decodeURIComponent(url.pathname);
    calls.push(`${path}${url.search}`);
    const route = routes.find(([re]) => re.test(path));
    if (!route) throw new Error(`Unexpected request: ${path}`);
    return route[1]();
  });
  return calls;
}

async function verify(raw: string) {
  const { verifyReference } = await import("../verify");
  return verifyReference(parseReference(raw, 1), { openalexBudget: { left: 5 } });
}

// The first import has Vite transform the engine's whole dependency graph; under a busy parallel run that can exceed the default 5 s.
// Load it once up front with a longer limit; each test's re-import after vi.resetModules() then reuses the transformed code.
const IMPORT_TIMEOUT = 30_000;
beforeAll(async () => { await import("../verify"); }, IMPORT_TIMEOUT);

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("verification flows on the remaining test-set false alarms", () => {
  it("does not call a 2017 paper non-existent when the journal only has DOIs from 2020 on (T046)", async () => {
    const calls = serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [] } })],
      [/^api\.openalex\.org\/works$/, () => Response.json({ results: [] })],
      [/^api\.crossref\.org\/journals$/, () => Response.json({ message: { items: [
        { title: "Indian Journal of Pure & Applied Physics", ISSN: ["0019-5596", "0975-1041"], breakdowns: { "dois-by-issued-year": [[2020, 112], [2021, 103], [2026, 86]] } },
      ] } })],
    ]);
    const result = await verify(RAW.T046);
    expect(result.verdict).toBe("unverifiable");
    expect(result.notes.join("")).toContain("2020–2026");
    // 期刊目录检索去掉了 "&"，否则 Crossref 一条都查不到
    expect(calls.find((c) => c.startsWith("api.crossref.org/journals"))).not.toMatch(/%26|&query=[^&]*\band\b/);
  });

  it("does not turn a bare name into a near-miss candidate (T066)", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [
        { DOI: "10.1007/978-3-540-76435-9_7055", title: ["3124 landscape information system [n]"], issued: { "date-parts": [[2010]] }, type: "reference-entry" },
      ] } })],
      [/^api\.openalex\.org\/works$/, () => Response.json({ results: [] })],
    ]);
    const result = await verify(RAW.T066);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toContain("信息不足");
  });

  it("does not use a repository name from OpenAlex as the journal (T007)", async () => {
    const { openalexSearchTitle } = await import("../sources/openalex");
    serve([[/^api\.openalex\.org\/works$/, () => Response.json({ results: [{
      id: "https://openalex.org/W1", doi: null, title: "Stress and Deformation Characteristics of Concrete at High Temperatures. 2. Experimental Investigation and Material Behaviour Model",
      publication_year: 1976, authorships: [], type: "report",
      primary_location: { source: { display_name: "Lund University Publications (Lund University)", type: "repository" } },
    }] })]]);
    const { records } = await openalexSearchTitle("Stress and deformation characteristics of concrete at high temperature");
    expect(records[0].venue).toBeUndefined();
  });
});
