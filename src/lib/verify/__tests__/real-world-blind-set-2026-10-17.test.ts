// 第四批盲测集（eval/real-world/blind-2026-10-17.json）运行一次后复核出的误报，见 eval/results/real-blind-2026-10-17-adjudication.json。
// 这些文献都真实存在；括号里是条目编号。数据库记录按当时 Crossref / OpenAlex 返回的内容简化而来。
// 每类都配了反例：编造的文献、写错的作者和 DOI 仍要被标出。用这批条目改过规则后，blind-2026-10-17 不再算盲测。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detectKind, extractDoi, guessAuthors, guessTitle, guessVenue, organizationAuthor, parseReference } from "../extract";
import { scoreCandidate } from "../match";
import { deglueNames } from "../normalize";
import type { CrossrefItem } from "../sources/crossref";
import type { WorkRecord } from "../types";

const RAW = {
  B002: "Zhu, Z.; Ding, H.; Wang, Y.; Fan, C.; Tu, Y.; Liu, G.; Pu, S. l P re of. “Journal Photochem. Photobiol. A Chem. 2020, 112657, doi:10.1016/j.jphotochem.2020.112657.",
  B014: "Yahalom R, Dobriyan A, Vered M, Talmi YP, Teicher S, Bedrin L. A prospective study of surgical margin status in oral squamous cell carcinoma; a preliminary report. J Surg Oncol. 2008;98:572–8. https://doi.org/10.1002/jso.21034.",
  B019: "Ibid., fol. 3v: „timiditas, […], mansuetudo, pietas“.",
  B020: "Gallo A. Commentarii ad […] regem Maximilianum de tremore cordis […] in duosque tractatus coacti et descripti a doctore Georgio Handschio. Wien: Österreichische Nationalbibliothek (ÖNB) Cod. 11158; 1555: fol. 3r: „parvitas, raritas & tarditas pulsus“.",
  B028: "van derValk T. M.Manuel T.Marques‐Bonet andK.Guschanski.2019. “Estimates of Genetic Load Suggest Frequent Purging of Deleterious Alleles in Small Populations.” Preprint BioRxiv July 21. 696831.https://doi.org/10.1101/696831.",
  B029: "Jiang H. andX.Wu.2018. “Alligator sinensis.”The IUCN Red List of Threatened Species2018: e.T867A3146005.",
  B036: "PerssonPO PeraireJ.Curved mesh generation and mesh refinement using Lagrangian solid mechanics. 47th AIAA Aerospace Sciences Meeting Including the New Horizons Forum and Aerospace Exposition.2009:949. doi:10.2514/6.2009‐949",
  B040: "Pappalardo D. Hypersonic: Between rhetoric and reality. Vortex: Stud on air and Space Power 2022; 3: 37–48.",
  B037: "Liang H, Chen J. Evolution of blood–brain barrier in brain diseases and related systemic nanoscale brain-targeting drug delivery strategies. Acta Pharm Sin B 2020; 11: 2306–2325.",
  B047: "Wang X, , Zhang C, and Bao N. Molecular mechanism of palmitic acid and its derivatives in tumor progression. Front Oncol, 2023; 13: 1–10. DOI: 10.3389/fonc.2023.1224125.",
  B048: "Leung JCK, , Lai KN, and Tang SCW. Crosstalk between podocytes and tubular epithelial cells. Cell Biol Pathol Podocytes, 2014; 183: 54–63. DOI: 10.1159/000359928.",
  B054: "Ekardt, F. and Sund, L. (2021) Die Bundestags-Wahlprogramme der Parteien – gemessen am Pariser 1,5-Grad-Ziel, dem Klima-Beschluss des BVerfG und der EU-Klimapolitik. Forschungsstelle Nachhaltigkeit und Klimapolitik.",
  B055: "Bundesverfassungsgericht (2022) Erfolgreiche Verfassungsbeschwerde gegen das ausnahmslose Verbot von Windenergieanlagen in Waldgebieten. 1 BvR 2661/21.",
  B056: "Kir94 Kirchberg, E. , The classification of purely infinite C Superscript asterisk ∗ $^*$ -algebras using Kasparov’s theory. Preprint (1994), https://ivv5hpp.uni-muenster.de/u/echters/ekneu1.pdf.",
  B059: "Hoberman, C (1988) Reversibly expandable doubly-curved truss structure. USA.",
  B060: "IHO (2000). IHO Transfer Standard for Digital Hydrographic Data-S57 (3.1). Monaco: International Hydrographic Bureau.",
  B061: "IMO (2006). Revised Performance Standards for Electronic Chart Display and Information Systems (ECDIS). London: International Maritime Organization. MSC.232(82).",
  B079: "J. Project and B. Note, “Federal Democratic Republic of Ethiopia The Project for Rural Water Supply, Sanitation and Livelihood Improvement through Dissemination of Rope Pumps (RPs) for Drinking Water (WAS-RoPSS),” no. 2012, 2016.",
};

const ref = (raw: string) => parseReference(raw, 1);
const record = (over: Partial<WorkRecord>): WorkRecord => ({ source: "crossref", title: "", authors: [], ...over });

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

/** 两个数据源的检索都没有结果，Crossref 期刊目录也没有同名期刊 */
const nothingFound: Route[] = [
  [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [] } })],
  [/^api\.openalex\.org\/works$/, () => Response.json({ results: [] })],
  [/^api\.crossref\.org\/journals$/, () => Response.json({ message: { items: [] } })],
];

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

// ---------- 第 1 类：覆盖范围外的类型被判成疑似不存在 ----------

describe("citations outside database coverage (category 1)", () => {
  it.each(["B054", "B055", "B059", "B079"] as const)(
    "calls %s unverifiable: no journal, conference or DOI to show that the databases should have it",
    async (id) => {
      serve(nothingFound);
      const result = await verify(RAW[id]);
      expect(result.parsed.kind).toBe("unknown");
      expect(result.parsed.venueGuess).toBeUndefined();
      expect(result.verdict).toBe("unverifiable");
      expect(result.summary).toContain("看不出是期刊论文");
      expect(result.issues).toEqual([]);
    },
  );

  it("does not take a report number as the journal (B079)", () => {
    expect(guessVenue(RAW.B079, guessTitle(RAW.B079))).toBeUndefined();
    // 真正的刊名照样识别
    expect(guessVenue("Smith J. A study of things. Nature, 2020, 1: 2-3.", "A study of things")).toBe("Nature");
  });

  it("recognises archival manuscripts by folio and shelfmark (B020, B019)", async () => {
    expect(detectKind(RAW.B020)).toBe("archive");
    expect(detectKind(RAW.B019)).toBe("archive");
    expect(detectKind("Smith J. Notes on a lost play. Unpublished manuscript, University of Leeds; 2019.")).toBe("archive");
    serve(nothingFound);
    const result = await verify(RAW.B020);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toContain("档案 / 手稿");
  });

  it("keeps a journal article about a manuscript, and a shelfmark-like number without a library, out of the archive class", () => {
    expect(detectKind("Smith J. The marginalia of Cod. 2554 in the Austrian National Library. Codices Manuscr. 2019;45:1-10.")).toBe("journal");
    expect(detectKind("Brown K. MS 2019 annual meeting abstracts on demyelination. Mult Scler. 2019;25:1-10.")).toBe("journal");
  });

  it("calls an unnumbered preprint unverifiable and does not take its URL as the title (B056)", async () => {
    expect(detectKind(RAW.B056)).toBe("preprint");
    expect(guessTitle(RAW.B056)).toBeUndefined();
    serve(nothingFound);
    const result = await verify(RAW.B056);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toContain("预印本没有写 arXiv 编号或 DOI");
  });

  it("treats an acronym followed by the year as an institutional author (B060, B061)", () => {
    expect(organizationAuthor(RAW.B060)).toBe(true);
    expect(organizationAuthor(RAW.B061)).toBe(true);
    expect(detectKind(RAW.B060)).toBe("report");
    expect(detectKind(RAW.B061)).toBe("report");
    // 全大写的个人姓氏后面跟的是名的缩写，不是机构
    expect(organizationAuthor("LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444.")).toBe(false);
    expect(organizationAuthor("SILVA, J. A. Modelagem hidrológica de bacias urbanas. Tese de doutorado, 2019.")).toBe(false);
  });

  it("does not compare an IMO resolution with the book appendix that reprints it (B061)", async () => {
    const appendix = record({
      doi: "10.1201/9781439847640-a9", title: "Revised Performance Standards for Electronic Chart Display and Information Systems (ECDIS) MSC.232(82)",
      authors: [{ family: "Weintrit", given: "Adam" }], year: 2009, years: [2010], venue: "The Electronic Chart Display and Information System (ECDIS)",
      pages: "1026-1041", type: "book-chapter",
    });
    expect(scoreCandidate(ref(RAW.B061), appendix).same).toBe(false);
    serve([[/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [{
      DOI: appendix.doi, title: [appendix.title], author: [{ family: "Weintrit", given: "Adam" }], issued: { "date-parts": [[2009, 8, 12]] },
      "published-online": { "date-parts": [[2010, 6]] }, "container-title": [appendix.venue!], page: "1026-1041", type: "book-chapter",
    }] } })]]);
    const result = await verify(RAW.B061);
    expect(result.verdict).toBe("unverifiable");
    expect(result.issues).toEqual([]);
  });

  // ---------- 反例：编造的期刊论文仍要判疑似不存在 ----------

  it("still calls a fabricated article in a real journal non-existent, even when the journal is abbreviated", async () => {
    // Crossref 期刊目录、OpenAlex 期刊库都认不出 "J Surg Oncol" 这类缩写，期刊目录里没有同名期刊不能当作收录缺口（B040 因此没改）
    serve(nothingFound);
    const result = await verify("Smith J, Brown K. Machine learning detection of fabricated surgical margins. J Surg Oncol. 2019;120(3):345-52.");
    expect(result.parsed.kind).toBe("journal");
    expect(result.verdict).toBe("not_found");
  });

  it("keeps calling a citation non-existent when its journal is in neither directory (B040 stays a known false alarm)", async () => {
    // 期刊目录里查不到，既可能是没收录的刊物（法国空天军的 Vortex），也可能是缩写或编造的刊名，现有数据源区分不了；
    // 改判无法核验会连带放过配缩写刊名的编造文献，所以维持疑似不存在，编造的刊名也照样标出
    const calls = serve(nothingFound);
    expect((await verify(RAW.B040)).verdict).toBe("not_found");
    vi.resetModules();
    expect((await verify("Chen Y, Li X. Graph attention for citation screening. J Fake Comput Stud. 2021;7(2):101-9.")).verdict).toBe("not_found");
    expect(calls.filter((c) => c.startsWith("api.openalex.org/sources"))).toEqual([]);
  });

  it("still calls a fabricated article non-existent when only the journal name follows the title", async () => {
    const raw = "Anderson, P. R., & Kim, S. (2019). Measuring citation hallucination in neural text generation systems. Journal of Artificial Intelligence Research.";
    expect(guessVenue(raw, guessTitle(raw))).toBe("Journal of Artificial Intelligence Research");
    serve(nothingFound);
    const result = await verify(raw);
    expect(result.verdict).toBe("not_found");
  });

  it("still calls a preprint with a made-up arXiv number non-existent", async () => {
    serve([
      [/^doi\.org\/ra\//, () => Response.json([{ DOI: "10.48550/arxiv.2305.99999", status: "DOI does not exist" }])],
      ...nothingFound,
    ]);
    const result = await verify("Brown, T., & Lee, K. (2023). Self-verifying citation agents for scholarly writing. arXiv preprint arXiv:2305.99999.");
    expect(result.verdict).toBe("not_found");
    expect(result.summary).toContain("疑似编造");
  });

  it("leaves a bare untyped citation without journal or DOI unverifiable: nothing shows that it should be in the databases", async () => {
    serve(nothingFound);
    const result = await verify("Smith, J. (2020). A completely invented study of citation behaviour among graduate students.");
    expect(result.verdict).toBe("unverifiable");
  });
});

// ---------- 第 2 类：引文格式解析 ----------

const photochem: CrossrefItem = {
  DOI: "10.1016/j.jphotochem.2020.112657",
  title: ["A ratiometric and colorimetric fluorescent probe for the detection of mercury ion based on rhodamine and quinoline–benzothiazole conjugated dyad"],
  author: [
    { family: "Zhu", given: "Zifan" }, { family: "Ding", given: "Haichang" }, { family: "Wang", given: "Yuesong" }, { family: "Fan", given: "Congbin" },
    { family: "Tu", given: "Yayi" }, { family: "Liu", given: "Gang" }, { family: "Pu", given: "Shouzhi" },
  ],
  issued: { "date-parts": [[2020, 9]] }, "container-title": ["Journal of Photochemistry and Photobiology A: Chemistry"],
  ISSN: ["1010-6030"], volume: "400", page: "112657", type: "journal-article",
};
const surgOncol: CrossrefItem = {
  DOI: "10.1002/jso.21034", title: ["A prospective study of surgical margin status in oral squamous cell carcinoma: A preliminary report"],
  author: [
    { family: "Yahalom", given: "Ran" }, { family: "Dobriyan", given: "Alex" }, { family: "Vered", given: "Marilena" },
    { family: "Talmi", given: "Yoav P." }, { family: "Teicher", given: "Shlomo" }, { family: "Bedrin", given: "Lev" },
  ],
  issued: { "date-parts": [[2008, 12, 12]] }, "container-title": ["Journal of Surgical Oncology"], volume: "98", issue: "8", page: "572-578",
  type: "journal-article",
};
const geneticLoad: CrossrefItem = {
  DOI: "10.1101/696831", title: ["Estimates of genetic load suggest frequent purging of deleterious alleles in small populations"],
  author: [{ family: "van der Valk", given: "Tom" }, { family: "de Manuel", given: "Marc" }, { family: "Marques-Bonet", given: "Tomas" }, { family: "Guschanski", given: "Katerina" }],
  issued: { "date-parts": [[2019, 7, 9]] }, type: "posted-content",
};
const palmitic: CrossrefItem = {
  DOI: "10.3389/fonc.2023.1224125", title: ["Molecular mechanism of palmitic acid and its derivatives in tumor progression"],
  author: [{ family: "Wang", given: "Xitan" }, { family: "Zhang", given: "Chaonan" }, { family: "Bao", given: "Na" }],
  issued: { "date-parts": [[2023, 8, 9]] }, "container-title": ["Frontiers in Oncology"], "short-container-title": ["Front. Oncol."],
  volume: "13", "article-number": "1224125", type: "journal-article",
};
const podocytes: CrossrefItem = {
  DOI: "10.1159/000359928", title: ["Crosstalk between Podocytes and Tubular Epithelial Cells"],
  author: [{ family: "Leung", given: "Joseph C.K." }, { family: "Lai", given: "Kar Neng" }, { family: "Tang", given: "Sydney C.W." }],
  issued: { "date-parts": [[2014]] }, "container-title": ["Contributions to Nephrology", "Podocytopathy"], ISSN: ["0302-5144"], page: "54-63",
  type: "book-chapter",
};
const curvedMesh: CrossrefItem = {
  DOI: "10.2514/6.2009-949", title: ["Curved Mesh Generation and Mesh Refinement using Lagrangian Solid Mechanics"],
  author: [{ family: "Persson", given: "Per-Olof" }, { family: "Peraire", given: "Jaime" }],
  issued: { "date-parts": [[2009, 1, 5]] }, "container-title": ["47th AIAA Aerospace Sciences Meeting including The New Horizons Forum and Aerospace Exposition"],
  type: "proceedings-article",
};

/** 按 DOI 查到 Crossref 记录，OpenAlex 交叉核对没有撤稿 */
const byDoi = (item: CrossrefItem): Route[] => [
  [new RegExp(`^api\\.crossref\\.org/works/${item.DOI!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), () => Response.json({ message: item })],
  [/^api\.openalex\.org\/works\/doi:/, openalexWork(item.DOI!.toLowerCase(), item.title![0])],
];

describe("citation format parsing (category 2)", () => {
  it("does not take the remains of a 'Journal Pre-proof' watermark as the title (B002)", async () => {
    expect(guessTitle(RAW.B002)).toBeUndefined();
    serve(byDoi(photochem));
    const result = await verify(RAW.B002);
    expect(result.verdict).toBe("verified");
    expect(result.notes.join("")).toContain("没有写题名");
  });

  it("still calls a real DOI with an invented title a mismatch of contents (B002 counter-example)", async () => {
    const raw = RAW.B002.replace("l P re of. “Journal", "Smart polymer nanocarriers for targeted gene delivery in solid tumours. Journal");
    expect(guessTitle(raw)).toBe("Smart polymer nanocarriers for targeted gene delivery in solid tumours");
    serve([...byDoi(photochem), ...nothingFound]);
    const result = await verify(raw);
    expect(result.verdict).toBe("not_found");
    expect(result.summary).toContain("DOI 指向的是另一篇文献");
  });

  it("does not end the title at a semicolon followed by a lower-case word (B014)", async () => {
    expect(guessTitle(RAW.B014)).toBe("A prospective study of surgical margin status in oral squamous cell carcinoma; a preliminary report");
    expect(guessVenue(RAW.B014, guessTitle(RAW.B014))).toBe("J Surg Oncol");
    serve(byDoi(surgOncol));
    const result = await verify(RAW.B014);
    expect(result.verdict).toBe("verified");
  });

  it("still ends the title at a semicolon before a publisher or a year", () => {
    expect(guessTitle("Silverman, B. W. Density Estimation For Statistics and Data Analysis; Chapman & Hall/CRC: 1986; p 45.")).toBe("Density Estimation For Statistics and Data Analysis");
    expect(guessTitle("Deckmyn A, Minka TP, Becker RA, Wilks AR, Brownrigg R. Maps: Draw Geographical Maps; 2022. Available from: https://cran.r-project.org/web/packages/maps/.")).toBe("Maps: Draw Geographical Maps");
  });

  it.each([
    ["B047", "Wang X, , Zhang C, and Bao N", "Molecular mechanism of palmitic acid and its derivatives in tumor progression", "Front Oncol"],
    ["B048", "Leung JCK, , Lai KN, and Tang SCW", "Crosstalk between podocytes and tubular epithelial cells", "Cell Biol Pathol Podocytes"],
  ] as const)("reads past an empty comma between authors (%s)", (id, authors, title, venue) => {
    expect(guessAuthors(RAW[id])).toBe(authors);
    expect(guessTitle(RAW[id])).toBe(title);
    expect(guessVenue(RAW[id], title)).toBe(venue);
  });

  it("verifies B047 and reports the source that B048 really gets wrong", async () => {
    serve(byDoi(palmitic));
    expect((await verify(RAW.B047)).verdict).toBe("verified");
    vi.resetModules();
    serve([
      ...byDoi(podocytes),
      [/^api\.openalex\.org\/sources\/issn:/, () => Response.json({ display_name: "Contributions to Nephrology", alternate_titles: [] })],
    ]);
    // 出处写成了 "Cell Biol Pathol Podocytes"，这本书其实是 Contributions to Nephrology 第 183 卷
    const result = await verify(RAW.B048);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues).toEqual(["期刊名不符：引用写「Cell Biol Pathol Podocytes」，数据库记录为「Contributions to Nephrology」"]);
  });

  it("still reports an invented co-author hidden behind an empty comma", async () => {
    serve(byDoi(palmitic));
    const result = await verify(RAW.B047.replace("Zhang C", "Smith J"));
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("作者");
  });

  it("splits a surname particle glued to the surname (B028)", async () => {
    expect(deglueNames("van derValk T. M.Manuel")).toBe("van der Valk T. M.Manuel");
    serve(byDoi(geneticLoad));
    const result = await verify(RAW.B028);
    expect(result.verdict).toBe("verified");
  });

  it("still reports a wrong first author written in the same glued style", async () => {
    serve(byDoi(geneticLoad));
    const result = await verify(RAW.B028.replace("van derValk", "van derBerg"));
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("第一作者不符");
  });

  it("keeps Unicode hyphens inside a DOI (B036)", async () => {
    expect(extractDoi(RAW.B036)).toBe("10.2514/6.2009-949");
    expect(extractDoi("doi:10.1002/jso.21034\u00ad")).toBe("10.1002/jso.21034");
    serve(byDoi(curvedMesh));
    const result = await verify(RAW.B036);
    expect(result.verdict).toBe("verified");
  });

  it("still reports a DOI with a Unicode hyphen that is not registered", async () => {
    serve([
      [/^api\.crossref\.org\/works\/10\.2514\/6\.2009-999$/, () => new Response("Resource not found.", { status: 404 })],
      [/^doi\.org\/ra\//, () => Response.json([{ DOI: "10.2514/6.2009-999", status: "DOI does not exist" }])],
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [curvedMesh] } })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork("10.2514/6.2009-949", curvedMesh.title![0])],
    ]);
    const result = await verify(RAW.B036.replace("2009‐949", "2009‐999"));
    expect(result.parsed.doi).toBe("10.2514/6.2009-999");
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("10.2514/6.2009-999 并不存在");
  });
});

// ---------- 第 3 类：数据库记录把机构登记为作者 ----------

const iucn2018: CrossrefItem = {
  DOI: "10.2305/IUCN.UK.2018-1.RLTS.T867A3146005.en", title: ["Alligator sinensis: Jiang, H. &amp; Wu, X."],
  subtitle: ["The IUCN Red List of Threatened Species 2018: e.T867A3146005"], author: [{ name: "IUCN" }],
  issued: { "date-parts": [[2017, 7, 31]] }, "container-title": ["IUCN Red List of Threatened Species"], type: "dataset",
};

describe("records that list an institution as the author (category 3)", () => {
  it("skips the author comparison when the record's only author is an acronym such as IUCN (B029)", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [iucn2018] } })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork(iucn2018.DOI!.toLowerCase(), "Alligator sinensis: Jiang, H. & Wu, X.", 2017)],
    ]);
    const result = await verify(RAW.B029);
    expect(result.verdict).toBe("verified");
    expect(result.notes.join("")).toContain("年份相差一年");
  });

  it("still compares the authors when the record lists people", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [{ ...iucn2018, author: [{ family: "Smith", given: "John" }] }] } })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork(iucn2018.DOI!.toLowerCase(), "Alligator sinensis: Jiang, H. & Wu, X.", 2017)],
    ]);
    const result = await verify(RAW.B029);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("作者与数据库记录不符");
  });
});

// ---------- 真实错误仍要标出 ----------

describe("real errors in the same batch", () => {
  it("still reports given names written as surnames (B037)", async () => {
    serve([
      [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: [{
        DOI: "10.1016/j.apsb.2020.11.023", title: ["Evolution of blood–brain barrier in brain diseases and related systemic nanoscale brain-targeting drug delivery strategies"],
        author: [{ family: "Han", given: "Liang" }, { family: "Jiang", given: "Chen" }], issued: { "date-parts": [[2021, 8]] },
        "container-title": ["Acta Pharmaceutica Sinica B"], volume: "11", page: "2306-2325", type: "journal-article",
      }] } })],
      [/^api\.openalex\.org\/works\/doi:/, openalexWork("10.1016/j.apsb.2020.11.023", "Evolution of blood–brain barrier")],
    ]);
    const result = await verify(RAW.B037);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("作者与数据库记录不符");
  });
});
