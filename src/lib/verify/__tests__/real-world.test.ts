// 真实论文参考文献的回归样例，取自 eval/real-world/dev-2026-10-14.json（括号里是条目编号）。
// 这些文献都真实存在，改动前会被误判为"信息有误"、"疑似不存在"或"出错"。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectKind, extractDoi, extractYear, guessAuthors, guessTitle, guessVenue, parseReference } from "../extract";
import { fieldChecks, scoreCandidate, venueSimilarity } from "../match";
import type { WorkRecord } from "../types";

const RAW = {
  D003: "Council, E. (2002). Council Directive 2001/110/EC of 20 December 2001 relating to honey. In (pp. p. 47–52). Official Journal of the European Communities: Official Journal of the European Communities.",
  D005: "Onenerk AM, Ozdemir HG, Ozkara S, Aker Vardar F, Ustaalioglu Oven B. KRAS/NRAS mutational analysis and clinicopathologic correlation of colorectal carcinoma: a single institute experience from Turkey. J Med Surg Res 2021;VIII:1022–9.",
  D008: "D. Africa, Development News, Research, World Bank, kernel description, Accessed 2023.",
  D009: "Belzer C, de Vos WM, Microbes inside--from diversity to function: the case of Akkermansia. ISME J. 6 (8) (2012) 1449–58. (PubMed: 22437156).",
  D010: "Yuan J, Wang Y, Huang Y, Study on microwave extraction and antioxidant activity of total polysaccharides from Radix Hedysari, applied Chemistry 48 (02) (2019) 373–375+379. doi: 10.16581/j.cnki.issn1671-3206.2019.02.014.",
  D014: "Vilardi, G., Verdone, N., 2020. Exergy Analysis of Waste Incineration Plant: Flue Gas Recirculation and Process Optimization. Proceedings 2020, Vol. 58, Page 29 58, 29. 〈https://doi.org/10.3390/WEF-06923〉.",
  D023: "Xu W, Lu G, Gong L, Tang W, Lu J. Endoscopic parathyroidectomy versus open parathyroidectomy for patients with refractory secondary hyperparathyroidism: a meta-analysis. Wideochir Inne Tech Maloinwazyjne. 2023 Dec;18(4):578–587. https://doi.org/10.5114/wiitm.2023.132439. Epub 2023 Oct 27. PMID: 38239584; PMCID: PMC10793148.",
  D027: "Ostolaza, M., Arrizubieta, J.I., Lamikiz, A., Cortina, M.: Functionally graded AISI 316L and AISI H13 manufactured by L-DED for die and mould applications. Appl. Sci. 11, 1–11 (2021). https://doi.org/10.3390/app11020771",
  D031: "A. Meftahi, R. Khajavi, A. Rashidi, M. Rahimi, A. Bahador, J. Nanostruct. Chem. 8, 311 (2018). https://doi.org/10.1007/s40097-018-0275-4",
  D032: "S. Chokshi, V. Parmar, P. Gohil, V. Chaudhary, Journal of Natural Fibers 19, 3942 (2022). https://doi.org/10.1080/15440478.2020.1848738",
  D044: "Pew Research Center.2014a.Religion in Latin America.Pew.",
  D048: "EstebanO MarkiewiczCJ GoncalvesM.SDCflows: Susceptibility Distortion Correction workFLOWS. April2025. doi:10.5281/zenodo.15271272",
  D051: "AdamsB(2018)The biological significance and utility of feeding byDermestes maculatus. M.Sc. Thesis in University of Nebraska‐Lincoln Lincoln NE.",
  D059: "Hassan, M., Li, P.P., Lin, J., Li, Z.H., Javed, M.S., Peng, Z.C., and Celebi, K. (2024). Smart energy storage: W18O49 NW/Ti3C2Tx composite-enabled all solid state flexible electrochromic supercapacitors. Small, e2400278.",
  D067: "Li, R.L., Zhu, J.F., Liu, Y.H., Li, Z.B., Fan, X.P., Leng, Q.L., and Zhang, T.T. (2022). Volcanic rock reservoir characteristics and hydrocarbon accumulation factors of rift unit in southern area, Songliao Basin. Earth Sci. Front.",
  D077: "Shan H Y, Zu S, Fang Z Y. Research progress in ultrafast dynamics of plasmonic hot electrons (in Chinese). Laser Optoelectron Prog, 2017, 54: 20–30 [单杭永, 祖帅, 方哲宇. 表面等离激元热电子超快动力学研究进展. 激光与光电子学进展, 2017, 54: 20–30].",
};

const ref = (raw: string) => parseReference(raw, 1);
const field = (raw: string, rec: WorkRecord, name: string) => {
  const r = ref(raw);
  return fieldChecks(r, rec, scoreCandidate(r, rec)).find((f) => f.field === name);
};

describe("parsing real-world citation styles", () => {
  it("drops a full-width bracket glued to the DOI (D014)", () => {
    expect(extractDoi(RAW.D014)).toBe("10.3390/wef-06923");
  });

  it("reads a year glued to the preceding word (D048)", () => {
    expect(extractYear(RAW.D048)).toBe(2025);
  });

  it.each([
    ["D003", "legal"], ["D048", "software"], ["D051", "thesis"], ["D044", "report"], ["D008", "web"],
  ] as const)("recognises %s as %s, which open databases do not cover", (id, kind) => {
    expect(detectKind(RAW[id])).toBe(kind);
  });

  it.each([
    ["D009", "Belzer C, de Vos WM"],
    ["D027", "Ostolaza, M., Arrizubieta, J.I., Lamikiz, A., Cortina, M"],
    ["D005", "Onenerk AM, Ozdemir HG, Ozkara S, Aker Vardar F, Ustaalioglu Oven B"],
  ] as const)("stops the author segment before the title (%s)", (id, authors) => {
    expect(guessAuthors(RAW[id])).toBe(authors);
  });

  it("gives no author segment when the end of the author list is ambiguous", () => {
    // 截成 "LeCun Y" 会漏掉后面编造的合著者；返回空让比对退回整条原文
    expect(guessAuthors("LeCun Y, Counterfeit X | 2015 | Deep learning | Nature")).toBeUndefined();
    expect(guessAuthors(RAW.D031)).toBeUndefined();
  });

  it("reads an abbreviated journal at the very end of the citation (D067)", () => {
    expect(guessVenue(RAW.D067, guessTitle(RAW.D067))).toBe("Earth Sci. Front");
    expect(guessVenue("Smith J. A study of things. Springer Nature.", "A study of things")).toBeUndefined();
  });
});

const meftahi: WorkRecord = {
  source: "crossref", doi: "10.1007/s40097-018-0275-4",
  title: "Preventing the collapse of 3D bacterial cellulose network via citric acid",
  authors: [
    { family: "Meftahi", given: "Amin" }, { family: "Khajavi", given: "Ramin" }, { family: "Rashidi", given: "Alimorad" },
    { family: "Rahimi", given: "Mohammad" }, { family: "Bahador", given: "Abbas" },
  ],
  year: 2018, venue: "Journal of Nanostructure in Chemistry", volume: "8", pages: "311-322",
};

describe("citations that do not state a title", () => {
  it("matches by DOI, first author and year (D031)", () => {
    const r = ref(RAW.D031);
    const s = scoreCandidate(r, meftahi);
    expect(s.titleMissing).toBe(true);
    expect(s.same).toBe(true);
    expect(fieldChecks(r, meftahi, s).find((f) => f.field === "title")?.status).toBe("missing");
  });

  it("still rejects a title-less citation whose authors do not match the DOI", () => {
    const s = scoreCandidate(ref("J. Smith, K. Brown, J. Nanostruct. Chem. 8, 311 (2018). https://doi.org/10.1007/s40097-018-0275-4"), meftahi);
    expect(s.same).toBe(false);
  });

  it("without a DOI requires authors, year, journal, volume and page to agree", () => {
    expect(scoreCandidate(ref("A. Meftahi, R. Khajavi, A. Rashidi, J. Nanostruct. Chem. 8, 311 (2018)."), meftahi).same).toBe(true);
    expect(scoreCandidate(ref("A. Meftahi, R. Khajavi, A. Rashidi, J. Nanostruct. Chem. 8, 999 (2018)."), meftahi).same).toBe(false);
  });

  it("accepts the print year when the record's main year is the online year (D032)", () => {
    const rec: WorkRecord = {
      source: "crossref", doi: "10.1080/15440478.2020.1848738",
      title: "Chemical Composition and Mechanical Properties of Natural Fibers",
      authors: [{ family: "Chokshi", given: "Sunil" }, { family: "Parmar", given: "Vijay" }, { family: "Gohil", given: "Piyush" }],
      year: 2020, years: [2022], venue: "Journal of Natural Fibers", volume: "19", pages: "3942-3956",
    };
    const r = ref(RAW.D032);
    const s = scoreCandidate(r, rec);
    expect(s.yearDiff).toBe(0);
    expect(s.same).toBe(true);
    expect(fieldChecks(r, rec, s).find((f) => f.field === "year")).toMatchObject({ status: "match", actual: "2020 / 2022" });
  });
});

describe("field comparison with real metadata quirks", () => {
  it("matches a chemical-formula title that the database spells with spaces (D059)", () => {
    const rec: WorkRecord = {
      source: "crossref", doi: "10.1002/smll.202400278",
      title: "Smart Energy Storage: W 18 O 49 NW/Ti 3 C 2 T x Composite‐Enabled All Solid State Flexible Electrochromic Supercapacitors",
      authors: [{ family: "Hassan", given: "Muhammad" }, { family: "Li", given: "Pingping" }, { family: "Lin", given: "Ju" }],
      year: 2024, venue: "Small", volume: "20", pages: "2400278",
    };
    expect(scoreCandidate(ref(RAW.D059), rec).same).toBe(true);
    expect(field(RAW.D059, rec, "title")?.status).toBe("match");
  });

  it("finds authors when the record swaps family and given names (D005)", () => {
    const rec: WorkRecord = {
      source: "crossref", doi: "10.46327/msrjg.1.000000000000207",
      title: "KRAS/NRAS Mutational Analysis and Clinicopathologic Correlation of Colorectal Carcinoma: A Single Institute Experience from Turkey",
      authors: [
        { family: "A. Mine", given: "Onenerk" }, { family: "Hanif Gulnihal", given: "Ozdemir" }, { family: "Selvinaz", given: "Ozkara" },
        { family: "Aker Vardar Fugen", given: "Aker" }, { family: "Oven Basak", given: "Ustaalioglu" },
      ],
      year: 2021, venue: "Journal of Medical and Surgical Research",
    };
    expect(field(RAW.D005, rec, "authors")?.status).toBe("match");
  });

  it("finds pinyin authors when the record stores the full name as family (D077)", () => {
    const rec: WorkRecord = {
      source: "crossref", doi: "10.3788/lop54.030002",
      title: "Research Progress in Ultrafast Dynamics of Plasmonic Hot Electrons",
      authors: [{ family: "Shan Hangyong", given: "单杭永" }, { family: "Zu Shuai", given: "祖 帅" }, { family: "Fang Zheyu", given: "方哲宇" }],
      year: 2017, venue: "Laser & Optoelectronics Progress", volume: "54",
    };
    expect(field(RAW.D077, rec, "authors")?.status).toBe("match");
  });

  it("separates glued initials before locating authors (D048)", () => {
    const rec: WorkRecord = {
      source: "doi-csl", doi: "10.5281/zenodo.15271272", title: "SDCflows: Susceptibility Distortion Correction workFLOWS.",
      authors: [{ family: "Oscar Esteban" }, { family: "Christopher J. Markiewicz" }, { family: "Mathias Goncalves" }], year: 2025,
    };
    const s = scoreCandidate(ref(RAW.D048), rec);
    expect(s.same).toBe(true);
    expect(s.firstAuthor).toBe("match");
    expect(s.authorRatio).toBe(1);
  });

  it("accepts a journal name followed by its subtitle, but not a different journal (D034)", () => {
    expect(venueSimilarity("Clin Infect Dis Off Publ Infect Dis Soc Am", "Clinical Infectious Diseases")).toBe(1);
    expect(venueSimilarity("Nature Medicine", "Nature")).toBeLessThan(0.6);
    expect(venueSimilarity("Neural Networks", "Neural Computation")).toBeLessThan(0.6);
  });
});

type Route = [RegExp, () => Response];

function serve(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    const path = url.hostname + decodeURIComponent(url.pathname);
    calls.push(path);
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

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("verification flows on real citations", () => {
  it("checks the journal's registered alternate titles before reporting a journal-name error (D023)", async () => {
    const item = {
      DOI: "10.5114/wiitm.2023.132439",
      title: ["Endoscopic parathyroidectomy versus open parathyroidectomy for patients with refractory secondary hyperparathyroidism: a meta-analysis."],
      author: [
        { family: "Xu", given: "Wei" }, { family: "Lu", given: "Guoqing" }, { family: "Gong", given: "Lin" },
        { family: "Tang", given: "Wei" }, { family: "Lu", given: "Jun" },
      ],
      issued: { "date-parts": [[2023]] }, "container-title": ["Videosurgery and Other Miniinvasive Techniques"],
      ISSN: ["1895-4588", "2299-0054"], volume: "18", page: "578-587",
    };
    const calls = serve([
      [/^api\.crossref\.org\/works\/10\.5114/, () => Response.json({ message: item })],
      [/^api\.openalex\.org\/sources\/issn:1895-4588$/, () => Response.json({
        display_name: "Videosurgery and Other Miniinvasive Techniques",
        alternate_titles: ["Wideochirurgia i Inne Techniki Mało Inwazyjne", "Videosurgery and Other Miniinvasive Techniques"],
      })],
      [/^api\.openalex\.org\/works\/doi:/, () => Response.json({
        id: "https://openalex.org/W1", doi: "https://doi.org/10.5114/wiitm.2023.132439", title: item.title[0], is_retracted: false,
      })],
    ]);
    const result = await verify(RAW.D023);
    expect(result.verdict).toBe("verified");
    expect(result.notes.join("")).toContain("另一名称");
    expect(calls).toContain("api.openalex.org/sources/issn:1895-4588");
  });

  it("does not call a citation non-existent when the journal's Crossref coverage ended before that year (D067)", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [] } })],
      [/^api\.openalex\.org\/works$/, () => Response.json({ results: [] })],
      [/^api\.crossref\.org\/journals$/, () => Response.json({ message: { items: [
        { title: "Earth Science Frontiers", ISSN: ["1872-5791"], breakdowns: { "dois-by-issued-year": [[2008, 71], [2007, 59], [2009, 53]] } },
        { title: "Frontiers in Earth Science", ISSN: ["2296-6463"], breakdowns: { "dois-by-issued-year": [[2022, 3200], [2014, 90]] } },
      ] } })],
    ]);
    const result = await verify(RAW.D067);
    expect(result.verdict).toBe("unverifiable");
    expect(result.notes.join("")).toContain("2007–2009");
  });

  it("keeps not-found when the cited journal is covered in that year", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [] } })],
      [/^api\.openalex\.org\/works$/, () => Response.json({ results: [] })],
      [/^api\.crossref\.org\/journals$/, () => Response.json({ message: { items: [
        { title: "Journal of Artificial Intelligence Research", ISSN: ["1076-9757"], breakdowns: { "dois-by-issued-year": [[2019, 75], [2020, 85]] } },
        // 同名的新刊从 2024 年才有记录，不能据此认为 2019 年的论文查不到不算数
        { title: "Journal of Artificial Intelligence Research", ISSN: ["3078-5529"], breakdowns: { "dois-by-issued-year": [[2024, 7]] } },
      ] } })],
    ]);
    const result = await verify("Anderson, P. R., & Kim, S. (2019). Measuring citation hallucination in neural text generation systems. Journal of Artificial Intelligence Research, 64, 1123–1150.");
    expect(result.verdict).toBe("not_found");
  });

  it("treats a registered CNKI DOI without content negotiation as unverifiable, not an error (D010)", async () => {
    serve([
      [/^api\.crossref\.org\/works\/10\.16581/, () => new Response("Resource not found.", { status: 404 })],
      [/^doi\.org\/ra\//, () => Response.json([{ DOI: "10.16581/j.cnki.issn1671-3206.2019.02.014", RA: "CNKI" }])],
      [/^(?:doi|www\.chndoi)\.org\//, () => new Response("<html>CNKI</html>", { status: 200, headers: { "Content-Type": "text/html" } })],
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [] } })],
      [/^api\.openalex\.org\/works$/, () => Response.json({ results: [] })],
    ]);
    const result = await verify(RAW.D010);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toContain("DOI 已注册");
  });
});

describe("source metadata clean-up", () => {
  it("collects print and online years, decodes entities and keeps ISSNs", async () => {
    const { mapCrossref } = await import("../sources/crossref");
    const rec = mapCrossref({
      DOI: "10.1080/15440478.2020.1848738", title: ["Natural fibers"],
      issued: { "date-parts": [[2020, 12, 1]] }, "published-print": { "date-parts": [[2022, 10, 3]] },
      "published-online": { "date-parts": [[2020, 12, 1]] },
      "container-title": ["The First World Energies Forum&amp;mdash;Current and Future Energy Issues"],
      ISSN: ["1544-0478", "bogus"],
    });
    expect(rec.year).toBe(2020);
    expect(rec.years).toEqual([2022]);
    expect(rec.venue).toBe("The First World Energies Forum—Current and Future Energy Issues");
    expect(rec.issn).toEqual(["1544-0478"]);
  });

  it("reads journal coverage years from the Crossref journal list", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: { items: [
      { title: "Earth Science Frontiers", ISSN: ["1872-5791"], breakdowns: { "dois-by-issued-year": [[2008, 71], [2007, 59], [2009, 53]] } },
      { title: "No ISSN journal" },
    ] } }));
    const { crossrefJournals } = await import("../sources/crossref");
    const { journals } = await crossrefJournals("Earth Sci. Front");
    expect(journals).toEqual([{ title: "Earth Science Frontiers", issn: ["1872-5791"], firstYear: 2007, lastYear: 2009 }]);
  });
});
