import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arxivFullText, arxivIdFromDoi, europePmcFullText, jatsToText } from "../fulltext";
import { fetchDoiEvidence } from "../sources";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// A real PDF parse starts a fresh worker that loads PDF.js; under a busy parallel run that can exceed the default 5 s.
// Above parsePdf's own 25 s limit, so a hung parse still fails with its TIMEOUT error rather than a bare test timeout.
const PDF_TIMEOUT = 30_000;

const SECTION = "Participants who slept more than seven hours recalled 18% more words than those who slept less than five hours. ".repeat(6);
const JATS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD v1.2 20190208//EN" "JATS-archivearticle1.dtd">
<article><front><journal-meta><journal-title-group><journal-title>Journal of Tests</journal-title></journal-title-group></journal-meta>
<article-meta><title-group><article-title>Sleep and <italic>recall</italic></article-title></title-group>
<contrib-group><contrib><name><surname>Smith</surname></name></contrib></contrib-group>
<abstract><p>We studied sleep and recall in 240 adults.</p></abstract></article-meta></front>
<body><sec><title>Results</title><p>${SECTION}</p>
<table-wrap><caption><p>Table 1. Recall by sleep group.</p></caption><table><tr><td>99.9 secret cell</td></tr></table></table-wrap>
<p>The effect<xref ref-type="bibr">[3]</xref> was smaller in older adults.</p></sec></body>
<back><ref-list><ref><mixed-citation>Unrelated reference text.</mixed-citation></ref></ref-list></back></article>`;

type Route = [RegExp, () => Response];
function serve(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(`${url.hostname}${url.pathname}`);
    expect(init?.redirect).toBe("error");
    const route = routes.find(([re]) => re.test(`${url.hostname}${url.pathname}${url.search}`));
    if (!route) throw new Error(`Unexpected request: ${url.href}`);
    return route[1]();
  }));
  return calls;
}
const xml = (body: string) => new Response(body, { headers: { "Content-Type": "application/xml" } });
const epmc = (result: Record<string, unknown>) => Response.json({ resultList: { result: [result] } });
const OA = { doi: "10.1234/sleep", pmcid: "PMC123456", isOpenAccess: "Y", inEPMC: "Y" };

describe("JATS full text", () => {
  it("keeps the title, abstract, section headings, paragraphs and captions, but drops references, table cells and authors", () => {
    const { title, text } = jatsToText(JATS);
    expect(title).toBe("Sleep and recall");
    expect(text).toContain("## Abstract\nWe studied sleep and recall in 240 adults.");
    expect(text).toContain("## Results");
    expect(text).toContain("Table 1. Recall by sleep group.");
    expect(text).toContain("The effect[3] was smaller in older adults.");
    for (const dropped of ["secret cell", "Unrelated reference", "Smith", "Journal of Tests"]) expect(text).not.toContain(dropped);
  });

  it("rejects a DOCTYPE with an internal subset", () => {
    expect(() => jatsToText(`<!DOCTYPE article [<!ENTITY x SYSTEM "file:///etc/passwd">]><article><body><p>&x;</p></body></article>`)).toThrow();
  });
});

describe("Europe PMC open full text", () => {
  it("fetches the JATS full text of an open-access record with the same DOI", async () => {
    const calls = serve([
      [/^www\.ebi\.ac\.uk\/europepmc\/webservices\/rest\/search/, () => epmc(OA)],
      [/^www\.ebi\.ac\.uk\/europepmc\/webservices\/rest\/PMC123456\/fullTextXML/, () => xml(JATS)],
    ]);
    const full = await europePmcFullText("10.1234/sleep");
    expect(full).toMatchObject({ kind: "europepmc_fulltext", url: "https://europepmc.org/article/PMC/PMC123456" });
    expect(full!.text).toContain("recalled 18% more words");
    expect(calls).toHaveLength(2);
  });

  it.each([
    [{ ...OA, doi: "10.1234/another" }],
    [{ ...OA, isOpenAccess: "N" }],
    [{ ...OA, pmcid: undefined }],
  ])("returns null instead of another or a closed paper (case %#)", async (hit) => {
    serve([[/search/, () => epmc(hit)]]);
    expect(await europePmcFullText("10.1234/sleep")).toBeNull();
  });
});

describe("arXiv preprint full text", () => {
  it("reads arXiv identifiers only from arXiv DOIs", () => {
    expect(arxivIdFromDoi("10.48550/arxiv.2507.06185")).toBe("2507.06185");
    expect(arxivIdFromDoi("10.48550/arXiv.hep-th/9901001")).toBe("hep-th/9901001");
    expect(arxivIdFromDoi("10.1038/s41598-023-41032-5")).toBeUndefined();
    expect(arxivIdFromDoi("10.48550/arxiv.2507.06185/../x")).toBeUndefined();
  });

  it("parses the PDF with the import pipeline and keeps hidden instructions out of the evidence", async () => {
    const pdf = new Uint8Array(await readFile(new URL("../../documents/__tests__/fixtures/preprint-hidden.pdf", import.meta.url)));
    serve([[/^export\.arxiv\.org\/pdf\/2501\.00001$/, () => new Response(pdf, { headers: { "Content-Type": "application/pdf" } })]]);
    const full = await arxivFullText("2501.00001");
    expect(full!.text).toContain("recalled 18% more words");
    expect(full!.text).not.toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
    expect(full!.warnings.join("")).toMatch(/隐藏文字.*像写给 AI 的指令/);
  }, PDF_TIMEOUT);

  it("refuses responses that are not PDFs", async () => {
    serve([[/^export\.arxiv\.org\/pdf\//, () => new Response("<html>", { headers: { "Content-Type": "text/html" } })]]);
    await expect(arxivFullText("2501.00001")).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
});

describe("DOI evidence with open full text first", () => {
  const crossref = (message: Record<string, unknown>) => Response.json({ message: { DOI: "10.1234/sleep", title: ["Sleep and recall"], ...message } });

  it("prefers Europe PMC full text over the Crossref abstract", async () => {
    serve([
      [/^api\.crossref\.org\/works\//, () => crossref({ abstract: "<jats:p>Short abstract about sleep.</jats:p>" })],
      [/^www\.ebi\.ac\.uk\/.*\/search/, () => epmc(OA)],
      [/^www\.ebi\.ac\.uk\/.*\/fullTextXML/, () => xml(JATS)],
    ]);
    const evidence = await fetchDoiEvidence("10.1234/sleep");
    expect(evidence.source).toMatchObject({ kind: "europepmc_fulltext", scope: "full_text", title: "Sleep and recall", label: "Europe PMC 开放全文" });
    expect(evidence.text).toContain("## Results");
  });

  it("falls back to the abstract when there is no open full text, and says so when the attempt failed", async () => {
    serve([
      [/^api\.crossref\.org\/works\//, () => crossref({ abstract: "<jats:p>Short abstract about sleep and memory.</jats:p>" })],
      [/^www\.ebi\.ac\.uk\/.*\/search/, () => new Response("busy", { status: 503 })],
    ]);
    const evidence = await fetchDoiEvidence("10.1234/sleep");
    expect(evidence.source).toMatchObject({ kind: "crossref_abstract", scope: "abstract" });
    expect(evidence.warnings.join("")).toContain("开放全文获取未完成");
  });

  it("uses the arXiv preprint the publisher registered when the published version has no open full text", async () => {
    const pdf = new Uint8Array(await readFile(new URL("../../documents/__tests__/fixtures/preprint-hidden.pdf", import.meta.url)));
    serve([
      [/^api\.crossref\.org\/works\//, () => crossref({ relation: { "has-preprint": [{ "id-type": "doi", id: "10.48550/arXiv.2501.00001", "asserted-by": "subject" }] } })],
      [/^www\.ebi\.ac\.uk\/.*\/search/, () => Response.json({ resultList: { result: [] } })],
      [/^export\.arxiv\.org\/pdf\/2501\.00001$/, () => new Response(pdf, { headers: { "Content-Type": "application/pdf" } })],
    ]);
    const evidence = await fetchDoiEvidence("10.1234/sleep");
    expect(evidence.source).toMatchObject({ kind: "arxiv_fulltext", scope: "full_text", url: "https://arxiv.org/abs/2501.00001" });
    expect(evidence.warnings.join("")).toContain("预印本 2501.00001");
  }, PDF_TIMEOUT);
});
