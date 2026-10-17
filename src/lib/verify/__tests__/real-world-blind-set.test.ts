// 新盲测集（eval/real-world/blind-2026-10-16.json）运行一次后复核出的误报，见 eval/results/real-blind-2026-10-16-adjudication.json。
// 这些文献都真实存在；括号里是条目编号。数据库记录按当时 Crossref / OpenAlex 返回的内容简化而来。
// 用这批条目改过规则后，blind-2026-10-16 不再算盲测。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detectKind, guessTitle, guessVenue, parseReference } from "../extract";
import { fieldChecks, scoreCandidate } from "../match";
import type { CrossrefItem } from "../sources/crossref";
import type { WorkRecord } from "../types";

const RAW = {
  B003: "Burke, M. (2022). What next for scientific collaboration as stand-off between China and the west heats up? Royal Society of Chemistry. Available at: https://www.chemistryworld.com/news/what-next-for-scientific-collaboration-as-stand-off-between-china-and-the-west-heats-up/4016361.article. Accessed on 31 August, 2023.",
  B011: "A. Dosovitskiy, L. Beyer, A. Kolesnikov, et al., An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale, in: International Conference on Learning Representations, ICLR, 2021.",
  B015: "Keçeci B, Küçük L, Isayev A, Sabah D. Effect of adjuvant therapies on recurrence in aneurysmal bone cysts. Acta Orthop Traumatol Turc. 2014, 48:500-6. 10.3944/AOTT.2014.14.0020",
  B027: "Nakamoto Satoshi.2008. “Bitcoin: A peer‐to‐peer electronic cash system.”https://bitcoin.org/bitcoin.pdf",
  B030: "D&D Beyond.2022.“How Many Crits Were Rolled This Year? Check Out 2022 Unrolled!”D&D Beyond.",
  B054: "Hockings, M , Stolton, S , Dudley, N (2000) Evaluating Effectiveness: A Framework for Assessing the Management of Protected Areas. Gland, Switzerland and Cambridge, UK: IUCN [www document]. URL https://portals.iucn.org/library/efiles/documents/pag-014.pdf",
  B056: "World Health Organization. 1978. Declaration of Alma Ata: International Conference on Primary Health Care, Alma Ata, USSR, 6–12 September.",
  B074: "Strandgard, M. (2019). Mitchell R 2019 Comparison of cost productivity residue yield of cutto-length fuel-adapted harvesting in a Pinus radiata, D. Don final harvest in Western Australia. N. Z. J. For. Sci., 49.",
  B080: "Oksanen J, Blanchet FG, Friendly M, Kindt R, Legendre P, McGlinn D, et al. Package vegan. Community Ecology Package. 2017.",
  B081: "R-Core-Team. R: A language and environment for statistical computing. Vienna, Austria: R Foundation for Statistical Computing; 2015.",
  B084: "Mackay AD, Scobie DR, Rhodes TR, Devantier B. Has progress been made in increasing the eco-efficiency of livestock systems? New Zealand Journal of Animal Science and Production. 2019;79:43–55. http://creativecommons.org.nz/licences/licences-explained/",
};

const ref = (raw: string) => parseReference(raw, 1);
const record = (over: Partial<WorkRecord>): WorkRecord => ({ source: "crossref", title: "", authors: [], ...over });
const field = (raw: string, rec: WorkRecord, name: string) => {
  const r = ref(raw);
  return fieldChecks(r, rec, scoreCandidate(r, rec)).find((f) => f.field === name);
};

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

/** OpenAlex 按 DOI 查询（撤稿交叉核对）的应答 */
const openalexWork = (doi: string, title: string, year?: number) => () =>
  Response.json({ id: "https://openalex.org/W1", doi: `https://doi.org/${doi}`, title, publication_year: year ?? null, is_retracted: false });

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

// ---------- 第 1 类：非期刊文献配到了别的记录 ----------

const ssrnBitcoin: CrossrefItem = {
  DOI: "10.2139/ssrn.3440802", title: ["Bitcoin: A Peer-to-Peer Electronic Cash System"],
  author: [{ family: "Nakamoto", given: "Satoshi" }], issued: { "date-parts": [[2019]] }, type: "posted-content",
};
const hockings2004: WorkRecord = record({
  doi: "10.1080/1523908042000320731", title: "Management Effectiveness: Assessing Management of Protected Areas?",
  authors: [{ family: "HOCKINGS", given: "MARC" }, { family: "STOLTON", given: "SUE" }, { family: "DUDLEY", given: "NIGEL" }],
  year: 2004, venue: "Journal of Environmental Policy & Planning", volume: "6", pages: "157-174", type: "journal-article",
});
const iucn2006: WorkRecord = record({
  doi: "10.2305/iucn.ch.2005.pag.14.en", title: "Evaluating effectiveness: a framework for assessing management effectiveness of protected areas",
  authors: [{ family: "Courrau", given: "José" }, { family: "Dudley", given: "Nigel" }, { family: "Hockings", given: "Marc" }, { family: "Leverington", given: "Fiona" }],
  year: 2006, type: "monograph",
});
const almaAtaChapter: WorkRecord = record({
  doi: "10.1163/9789004635753_019", title: "International Conference on Primary Health Care Alma-Ata, USSR, 6-12 September 1978",
  authors: [{ family: "Pannenborg", given: "Charles Olke" }], year: 1978, venue: "A New International Health Order", type: "book-chapter",
});

describe("non-journal works matched to another record (category 1)", () => {
  it("treats a later repost of a cited web document as another version, not a wrong year (B027)", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [ssrnBitcoin] } })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork(ssrnBitcoin.DOI!, ssrnBitcoin.title![0], 2019)],
    ]);
    const result = await verify(RAW.B027);
    expect(result.parsed.kind).toBe("web");
    expect(result.verdict).toBe("verified");
    expect(result.issues).toEqual([]);
    expect(result.notes.join("")).toContain("版本");
    // 年份差得远时，数据库里的 DOI 可能属于转载版本，不直接建议补充
    expect(result.notes.join("")).not.toContain("建议补充 DOI");
  });

  it("does not take the same authors' other article or a later edition with another first author as the cited 2000 edition (B054)", async () => {
    expect(scoreCandidate(ref(RAW.B054), hockings2004).same).toBe(false);
    expect(scoreCandidate(ref(RAW.B054), iucn2006).same).toBe(false);
    serve([[/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [
      { DOI: iucn2006.doi, title: [iucn2006.title], author: iucn2006.authors, issued: { "date-parts": [[2006]] }, type: "monograph" },
      { DOI: hockings2004.doi, title: [hockings2004.title], author: hockings2004.authors, issued: { "date-parts": [[2004, 6]] },
        "container-title": [hockings2004.venue!], volume: "6", page: "157-174", type: "journal-article" },
    ] } })]]);
    const result = await verify(RAW.B054);
    expect(result.verdict).toBe("unverifiable");
    expect(result.match).toBeUndefined();
  });

  it("does not compare an institution's declaration with the author of a book that reprints it (B056)", async () => {
    expect(detectKind(RAW.B056)).toBe("report");
    const s = scoreCandidate(ref(RAW.B056), almaAtaChapter);
    expect(s.same).toBe(false);
    expect(s.partial).toBe(false);
    serve([[/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [
      { DOI: almaAtaChapter.doi, title: [almaAtaChapter.title], author: [{ family: "Pannenborg", given: "Charles Olke" }],
        issued: { "date-parts": [[1978, 1, 1]] }, "container-title": ["A New International Health Order"], type: "book-chapter" },
      { DOI: "10.2307/j.ctt1t893gd.28", title: ["Declaration of Alma-Ata:"], type: "book-chapter" },
    ] } })]]);
    const result = await verify(RAW.B056);
    expect(result.verdict).toBe("unverifiable");
    expect(result.issues).toEqual([]);
  });

  it("only skips the author comparison for an institution-authored journal article whose record lists the writing group", () => {
    // Crossref 记录（10.2337/dc23-S002）列出 ElSayed NA 等 22 位执笔者，医学论文常以学会署名引用
    const ada = record({
      doi: "10.2337/dc23-s002", title: "2. Classification and Diagnosis of Diabetes: Standards of Care in Diabetes—2023",
      authors: [{ family: "ElSayed", given: "Nuha A." }, { family: "Aleppo", given: "Grazia" }, { family: "Aroda", given: "Vanita R." }],
      year: 2022, venue: "Diabetes Care", volume: "46", pages: "S19-S40", type: "journal-article",
    });
    const raw = "American Diabetes Association. 2. Classification and diagnosis of diabetes: Standards of Care in Diabetes—2023. Diabetes Care 2023;46(Suppl 1):S19–S40.";
    expect(scoreCandidate(ref(raw), ada)).toMatchObject({ same: true, firstAuthor: "unknown" });
    expect(field(raw, ada, "authors")?.status).toBe("missing");
  });

  it("still reports a wrong year for a journal article and wrong authors for a personal citation", () => {
    const deep = record({ title: "Deep learning", year: 2015, venue: "Nature", volume: "521", pages: "436-444", type: "journal-article",
      authors: [{ family: "LeCun", given: "Yann" }, { family: "Bengio", given: "Yoshua" }, { family: "Hinton", given: "Geoffrey" }] });
    expect(field("LeCun, Y., Bengio, Y., & Hinton, G. (2017). Deep learning. Nature, 521(7553), 436–444.", deep, "year")?.status).toBe("mismatch");
    // 个人署名的引文照常比对作者，长题名逐字一致时仍认定为同一篇（作者写错）
    const s = scoreCandidate(ref("Smith J. 1978. International Conference on Primary Health Care Alma-Ata, USSR, 6-12 September 1978."), almaAtaChapter);
    expect(s).toMatchObject({ same: true, firstAuthor: "mismatch" });
  });
});

// ---------- 第 2 类：软件没识别出来 ----------

const veganPackage: CrossrefItem = {
  DOI: "10.32614/CRAN.package.vegan", title: ["vegan: Community Ecology Package"], type: "dataset",
  author: [
    { family: "Oksanen", given: "Jari" }, { family: "Simpson", given: "Gavin L." }, { family: "Blanchet", given: "F. Guillaume" },
    { family: "Kindt", given: "Roeland" }, { family: "Legendre", given: "Pierre" }, { family: "Minchin", given: "Peter R." },
  ],
  issued: { "date-parts": [[2001, 9, 6]] }, "container-title": ["CRAN: Contributed Packages"],
};

describe("software citations (category 2)", () => {
  it.each(["B080", "B081"] as const)("recognises %s as software", (id) => {
    expect(detectKind(RAW[id])).toBe("software");
  });

  it("keeps ordinary uses of the word package out of the software class", () => {
    expect(detectKind("Smith J. A package of care for stroke survivors. Stroke. 2019;50(3):100-110.")).toBe("journal");
    expect(detectKind("Brown K. Package design and consumer choice. London: Routledge; 2015.")).toBe("book");
  });

  it("treats the package-level DOI's first release and current authors as version differences (B080)", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [veganPackage] } })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork("10.32614/cran.package.vegan", "vegan: Community Ecology Package", 2001)],
    ]);
    const result = await verify(RAW.B080);
    expect(result.verdict).toBe("verified");
    expect(result.issues).toEqual([]);
    expect(result.notes.join("")).toMatch(/版本/);
  });

  it("does not offer an unrelated book chapter as a near match for R itself (B081)", async () => {
    serve([[/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [
      { DOI: "10.32614/R.manuals", title: ["R: A Language and Environment for Statistical Computing"], author: [{ name: "R Core Team" }],
        issued: { "date-parts": [[2000]] }, "published-online": { "date-parts": [[2026]] }, type: "database" },
      { DOI: "10.1201/b17972-15", title: ["Statistical computing"], issued: { "date-parts": [[2014, 12, 17]] },
        "container-title": ["Statistical Computing in Nuclear Imaging"], type: "book-chapter" },
    ] } })]]);
    const result = await verify(RAW.B081);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toContain("软件");
  });
});

// ---------- 第 3 类：题名边界切错 ----------

describe("title boundaries (category 3)", () => {
  it("ends the title before ', in:' and the conference name (B011)", () => {
    expect(guessTitle(RAW.B011)).toBe("An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale");
  });

  it("does not end the title at the botanical authority 'D. Don' (B074)", () => {
    const title = guessTitle(RAW.B074);
    expect(title).toMatch(/Pinus radiata, D\. Don final harvest in Western Australia$/);
    expect(guessVenue(RAW.B074, title)).toBe("N. Z. J. For. Sci");
    const rec = record({
      doi: "10.33494/nzjfs492019x37x", year: 2019, volume: "49", venue: "New Zealand Journal of Forestry Science", type: "journal-article",
      title: "Comparison of cost, productivity and residue yield of cut-to-length and fuel-adapted harvesting in a <i>Pinus radiata</i> D.Don final harvest in Western Australia",
      authors: [{ family: "Strandgard", given: "Martin" }, { family: "Mitchell", given: "Rick" }],
    });
    expect(field(RAW.B074, rec, "venue")?.status).toBe("match");
  });

  it("still ends a title at a single capital letter that closes it, and keeps species abbreviations", () => {
    expect(guessTitle("Brown K. The role of vitamin D. Nutrients. 2020;12(3):100-110.")).toBe("The role of vitamin D");
    expect(guessTitle("Smith J. Survival of E. coli in raw milk cheese. J Dairy Sci. 2019;102(1):1-10.")).toBe("Survival of E. coli in raw milk cheese");
  });
});

// ---------- 第 4 类：带网址的新闻网页被当成期刊论文 ----------

describe("web pages (category 4)", () => {
  it("does not read the year of an access date as a volume number (B003)", () => {
    expect(detectKind(RAW.B003)).toBe("web");
    // MDPI 写法末尾的卷号照样按期刊论文识别
    expect(detectKind("Gan, B.-R., and Zhou, J.-W. (2020). Flood routing process of the Baige landslide-dammed lake. Water, 12.")).toBe("journal");
  });

  it("recognises a page whose publisher is the same name as its author (B030)", () => {
    expect(detectKind(RAW.B030)).toBe("web");
  });

  it("calls a news page outside database coverage instead of non-existent (B003)", async () => {
    const calls = serve([[/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [] } })]]);
    const result = await verify(RAW.B003);
    expect(result.verdict).toBe("unverifiable");
    expect(calls).not.toContain("api.openalex.org/works");
  });
});

// ---------- 第 5 类：数据库记录本身有差异 ----------

const kececi: CrossrefItem = {
  DOI: "10.3944/AOTT.2014.14.0020", title: ["Effect of adjuvant therapies on recurrence in aneurysmal bone cysts"],
  author: [{ family: "Kececi", given: "Burcin" }, { family: "Kucuk", given: "Levent" }, { family: "Isayev", given: "Alovsat" }, { family: "Sabah", given: "Dundar" }],
  issued: { "date-parts": [[2020, 2, 7]] }, "published-online": { "date-parts": [[2020, 2, 7]] },
  "container-title": ["Acta Orthopaedica et Traumatologica Turcica"], volume: "48", page: "500-506", type: "journal-article",
};

describe("database records that disagree with each other (category 5)", () => {
  it("accepts the cited year when OpenAlex records it and Crossref has a later date (B015)", async () => {
    serve([
      [/^api\.crossref\.org\/works\/10\.3944/, () => Response.json({ message: kececi })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork("10.3944/aott.2014.14.0020", kececi.title![0], 2014)],
    ]);
    const result = await verify(RAW.B015);
    expect(result.verdict).toBe("verified");
    expect(result.notes.join("")).toContain("OpenAlex");
    expect(result.fields.find((f) => f.field === "year")?.status).toBe("match");
  });

  it("still reports the wrong year when OpenAlex agrees with Crossref", async () => {
    serve([
      [/^api\.crossref\.org\/works\/10\.3944/, () => Response.json({ message: kececi })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork("10.3944/aott.2014.14.0020", kececi.title![0], 2020)],
    ]);
    const result = await verify(RAW.B015);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("年份不符");
  });

  it("accepts a middle initial that the repository record leaves out (B084)", () => {
    const figshare = record({
      source: "openalex", title: "Has progress been made in increasing the eco-efficiency of livestock systems?", year: 2019, type: "conference-paper",
      authors: [{ family: "Mackay", given: "Alec D." }, { family: "Scobie", given: "David R." }, { family: "Rhodes", given: "Tim" }, { family: "Devantier", given: "B.P." }],
    });
    expect(scoreCandidate(ref(RAW.B084), figshare).authorListMismatch).toBe(false);
    expect(field(RAW.B084, figshare, "authors")?.status).toBe("match");
    // 首字母对不上的仍然算不符
    expect(scoreCandidate(ref(RAW.B084.replace("Rhodes TR", "Rhodes XR")), figshare).authorListMismatch).toBe(true);
  });
});
