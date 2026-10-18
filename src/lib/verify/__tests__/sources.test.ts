import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import v6Response from "./fixtures/crossref-v6-2026-10-14.json";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const crossrefWork = { DOI: "10.1111/j.2517-6161.1995.tb02031.x", title: ["Controlling the False Discovery Rate: A Practical and Powerful Approach to Multiple Testing"] };
const openalexWork = { id: "https://openalex.org/W123", doi: "https://doi.org/10.9999/work", title: "A matchable work", is_retracted: false };

describe("OpenAlex DOI lookup", () => {
  it("separates a merged record registered under another DOI from a record of this DOI", async () => {
    vi.stubGlobal("fetch", async (input: string) => Response.json(new URL(input).pathname.includes("10.48550")
      ? { ...openalexWork, doi: "https://doi.org/10.65215/2q58a426" }
      : { ...openalexWork, doi: "https://doi.org/10.9999/WORK" }));
    const { openalexByDoi } = await import("../sources/openalex");
    const merged = await openalexByDoi("10.48550/arxiv.1706.03762");
    expect(merged.record).toBeUndefined();
    expect(merged.merged?.doi).toBe("10.65215/2q58a426");
    const same = await openalexByDoi("10.9999/Work");
    expect(same.record?.doi).toBe("10.9999/work");
    expect(same.merged).toBeUndefined();
  });
});

describe("search results with incomplete records", () => {
  it("preserves the real Benjamini search results alongside an untitled journal issue", async () => {
    vi.stubGlobal("fetch", async () => Response.json(v6Response));
    const { crossrefSearch } = await import("../sources/crossref");
    const result = await crossrefSearch("Controlling the false discovery rate");
    expect(result.records).toHaveLength(4);
    expect(result.records[0].doi).toBe("10.1111/j.2517-6161.1995.tb02031.x");
    expect(result.records.map((r) => r.doi)).not.toContain("10.1111/rssb.1995.57.issue-4");
  });

  it.each([undefined, [], [""]].map((title) => ({ title })))("keeps matchable Crossref records when another record has title $title", async ({ title }) => {
    vi.stubGlobal("fetch", async () => Response.json({ message: { items: [
      { DOI: "10.9999/title-unavailable", title }, crossrefWork,
    ] } }));
    const { crossrefSearch } = await import("../sources/crossref");
    const result = await crossrefSearch("Controlling the false discovery rate");
    expect(result.records).toHaveLength(1);
    expect(result.records[0].doi).toBe("10.1111/j.2517-6161.1995.tb02031.x");
  });

  it.each([undefined, null, ""])("keeps matchable OpenAlex records when another record has title %j", async (title) => {
    vi.stubGlobal("fetch", async () => Response.json({ results: [
      { id: "https://openalex.org/W456", title }, openalexWork,
    ] }));
    const { openalexSearchTitle } = await import("../sources/openalex");
    const result = await openalexSearchTitle("A matchable work");
    expect(result.records).toHaveLength(1);
    expect(result.records[0].doi).toBe("10.9999/work");
  });

  it.each([
    [{ DOI: "10.9999/title-unavailable" }],
    [{}],
    [crossrefWork, { DOI: "10.9999/broken", title: 42 }],
    [crossrefWork, { DOI: "10.9999/broken", title: [42] }],
  ].map((items) => ({ items })))("does not turn malformed or entirely unmatchable Crossref metadata into an empty search: $items", async ({ items }) => {
    vi.stubGlobal("fetch", async () => Response.json({ message: { items } }));
    const { crossrefSearch } = await import("../sources/crossref");
    await expect(crossrefSearch("A work")).rejects.toMatchObject({ status: 200 });
  });

  it.each([
    [{ id: "https://openalex.org/W456", title: null }],
    [{}],
    [openalexWork, { id: "https://openalex.org/W456", title: 42 }],
  ].map((results) => ({ results })))("does not turn malformed or entirely unmatchable OpenAlex metadata into an empty search: $results", async ({ results }) => {
    vi.stubGlobal("fetch", async () => Response.json({ results }));
    const { openalexSearchTitle } = await import("../sources/openalex");
    await expect(openalexSearchTitle("A work")).rejects.toMatchObject({ status: 200 });
  });
});

// 2026-10-16 实测：title.search 的值里有 ? 或 * 就返回 400（不计费），去掉后正常返回
function rejectWildcards(requests: URL[]) {
  return async (input: string) => {
    const url = new URL(input);
    requests.push(url);
    const value = url.searchParams.get("filter")?.match(/^title\.search:([^,]*)/)?.[1] ?? "";
    if (!/[?*]/.test(value)) return Response.json({ results: [openalexWork] });
    return Response.json({
      error: "Invalid query parameters error.",
      message: `Wildcards (* or ?) require the exact (no-stem) field. "title.search" is stemmed, so the literal text before the wildcard is removed when the work is indexed and the search returns wrong results. Use "title.search.exact" instead, e.g. title.search.exact:${value}.`,
    }, { status: 400 });
  };
}

describe("OpenAlex title search query", () => {
  it.each([
    // 新盲测集 B030 的题名，问号在中间
    { title: "How Many Crits Were Rolled This Year? Check Out 2022 Unrolled!", year: undefined, filter: "title.search:How Many Crits Were Rolled This Year Check Out 2022 Unrolled!" },
    { title: "An improved A* algorithm for mobile robot path planning", year: 2020, filter: "title.search:An improved A algorithm for mobile robot path planning,publication_year:2019-2021" },
  ])("replaces wildcard characters before searching: $title", async ({ title, year, filter }) => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", rejectWildcards(requests));
    const { openalexSearchTitle } = await import("../sources/openalex");
    const result = await openalexSearchTitle(title, 5, undefined, year);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("filter")).toBe(filter);
    expect(requests[0].search.slice(1)).not.toMatch(/\*|%3F|%2A/i);
    expect(result.records.map((r) => r.doi)).toEqual(["10.9999/work"]);
  });
});
