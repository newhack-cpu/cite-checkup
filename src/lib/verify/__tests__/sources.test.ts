import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import v6Response from "./fixtures/crossref-v6-2026-10-14.json";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const crossrefWork = { DOI: "10.1111/j.2517-6161.1995.tb02031.x", title: ["Controlling the False Discovery Rate: A Practical and Powerful Approach to Multiple Testing"] };
const openalexWork = { id: "https://openalex.org/W123", doi: "https://doi.org/10.9999/work", title: "A matchable work", is_retracted: false };

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
