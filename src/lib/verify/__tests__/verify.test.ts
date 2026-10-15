import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import audit from "../../../../eval/competition-review-2026-10-14/code-audit/edge-case-results.json";
import { parseReference } from "../extract";
import type { CrossrefItem } from "../sources/crossref";
import v6Response from "./fixtures/crossref-v6-2026-10-14.json";

const authors = [
  { family: "LeCun", given: "Yann" },
  { family: "Bengio", given: "Yoshua" },
  { family: "Hinton", given: "Geoffrey" },
];
const record: CrossrefItem = {
  DOI: "10.9999/regression",
  title: ["Deep learning"],
  author: authors,
  issued: { "date-parts": [[2015]] },
  "container-title": ["Nature"],
  type: "journal-article",
};

function raw(id: string) {
  const item = audit.results.find((r) => r.id === id);
  if (!item) throw new Error(`Missing audit fixture: ${id}`);
  return item.raw;
}

function fixture(
  item = record,
  options: { oaStatus?: number; retracted?: boolean; searchItems?: CrossrefItem[] } = {},
) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    calls.push(url.hostname + url.pathname);
    if (url.hostname === "api.crossref.org") {
      if (url.pathname === "/journals") return Response.json({ message: { items: [] } });
      return Response.json({ message: url.pathname === "/works" ? { items: options.searchItems ?? [] } : item });
    }
    if (url.hostname === "api.openalex.org") {
      if (options.oaStatus) return new Response("{}", { status: options.oaStatus });
      if (url.pathname === "/works") return Response.json({ results: [] });
      return Response.json({
        id: "https://openalex.org/W1", doi: `https://doi.org/${item.DOI}`,
        title: item.title?.[0], is_retracted: options.retracted ?? false,
      });
    }
    throw new Error(`Unexpected fixture request: ${url.hostname}`);
  });
  return calls;
}

async function check(text: string, budget = 20) {
  const { verifyReference } = await import("../verify");
  return verifyReference(parseReference(text, 1), { openalexBudget: { left: budget } });
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("verified requires consistent cited fields", () => {
  it("verifies Benjamini 1995 using the captured Crossref response including an untitled issue", async () => {
    fixture(v6Response.message.items[0], { searchItems: v6Response.message.items });
    const result = await check("Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate: A practical and powerful approach to multiple testing. Journal of the Royal Statistical Society: Series B (Methodological), 57(1), 289–300.");
    expect(result.verdict).toBe("verified");
    expect(result.matchStatus).toBe("confirmed");
    expect(result.match?.doi).toBe("10.1111/j.2517-6161.1995.tb02031.x");
    expect(result.issues).toEqual([]);
  });

  it("does not verify an explicit title mismatch even when the DOI identifies the work", async () => {
    fixture({ ...record, DOI: "10.9999/audit-title", title: ["Alpha beta gamma delta epsilon zeta eta theta iota kappa"] });
    const result = await check(raw("title-mismatch-can-be-verified"));
    expect(result.verdict).toBe("mismatch");
    expect(result.matchStatus).toBe("confirmed");
    expect(result.fields.find((f) => f.field === "title")?.status).toBe("mismatch");
    expect(result.issues.some((i) => i.includes("题名"))).toBe(true);
  });

  it("reports swapping the second and third authors", async () => {
    fixture({ ...record, DOI: "10.9999/audit-order" });
    const result = await check(raw("second-third-author-order-not-detected"));
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.some((i) => i.includes("作者顺序"))).toBe(true);
  });

  it("reports invented coauthors despite a correct first author", async () => {
    fixture({ ...record, DOI: "10.9999/audit-authors" });
    const result = await check(raw("invented-coauthors-not-detected"));
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.some((i) => i.includes("作者"))).toBe(true);
  });

  it("does not find a fake author in the title instead of the author segment", async () => {
    fixture({ ...record, title: ["LeCun method for deep learning"] });
    const result = await check("Smith, J. (2015). LeCun method for deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("mismatch");
    expect(result.fields.find((f) => f.field === "authors")?.status).toBe("mismatch");
  });

  it.each([
    "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444.",
    "LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444.",
    'Y. LeCun, Y. Bengio, and G. Hinton, "Deep learning," Nature, vol. 521, no. 7553, pp. 436-444, 2015.',
    "LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444.",
    "LECUN Y, et al. Deep learning[J]. Nature, 2015, 521(7553): 436-444.",
    'Y. LeCun et al., "Deep learning," Nature, vol. 521, pp. 436-444, 2015.',
  ])("preserves common citation and omitted-author formats: %s", async (text) => {
    fixture();
    const result = await check(`${text} DOI: 10.9999/regression`);
    expect(result.verdict).toBe("verified");
    expect(result.fields.find((f) => f.field === "authors")?.status).toBe("match");
  });
});

describe("candidate identity", () => {
  it.each([20, 0])("marks a nearby record as an unconfirmed candidate with budget %s", async (budget) => {
    fixture(record, { searchItems: [{ ...record, title: ["Alpha beta gamma delta epsilon zeta eta theta"] }] });
    const result = await check("LeCun, Y., et al. (2015). Alpha beta gamma delta. Nature, 521(7553), 436-444.", budget);
    expect(result.verdict).toBe("mismatch");
    expect(result.matchStatus).toBe("candidate");
    expect(result.match?.title).toBe("Alpha beta gamma delta epsilon zeta eta theta");
    expect(result.suggestion).toContain("Alpha beta gamma delta epsilon zeta eta theta");
  });

  it("marks a verified record as confirmed", async () => {
    fixture();
    const result = await check("LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("verified");
    expect(result.matchStatus).toBe("confirmed");
  });
});

describe("retraction evidence", () => {
  it("recognizes a Crossref RETRACTED prefix without update metadata", async () => {
    fixture({ ...record, DOI: "10.9999/audit-retraction", title: ["RETRACTED: Deep learning"] });
    const result = await check(raw("crossref-retracted-prefix-without-update-metadata"));
    expect(result.verdict).toBe("retracted");
    expect(result.match?.retraction?.source).toBe("crossref-title");
  });

  it("checks OpenAlex retraction evidence even when Crossref found the DOI", async () => {
    fixture(record, { retracted: true });
    const result = await check("LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("retracted");
    expect(result.match?.retraction?.source).toBe("openalex");
  });

  it("keeps matched bibliographic evidence when the supplementary source is unavailable", async () => {
    fixture(record, { oaStatus: 403 });
    const result = await check("LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("verified");
    expect(result.match?.title).toBe("Deep learning");
    expect(result.notes.some((i) => /撤稿.*未完成/.test(i))).toBe(true);
    expect(result.summary).toMatch(/撤稿.*未完成/);
    expect(result.steps.some((s) => s.action === "openalex_lookup" && !s.ok)).toBe(true);
  });

  it("marks a missing supplementary record as incomplete retraction verification", async () => {
    fixture(record, { oaStatus: 404 });
    const result = await check("LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("verified");
    expect(result.notes.some((i) => /撤稿.*未完成/.test(i))).toBe(true);
  });

  it("keeps an expression of concern separate from a retraction", async () => {
    fixture({ ...record, "updated-by": [{ type: "expression_of_concern", DOI: "10.9999/notice", source: "publisher" }] });
    const result = await check("LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("concern");
    expect(result.summary).not.toContain("已被撤稿");
  });

  it("does not label a study about retractions as retracted", async () => {
    fixture({ ...record, title: ["Retraction practices in scientific publishing"] });
    const result = await check("LeCun, Y., et al. (2015). Retraction practices in scientific publishing. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("verified");
  });

  it("does not adopt a retraction flag from another DOI", async () => {
    vi.stubGlobal("fetch", async (input: string) => new URL(input).hostname === "api.crossref.org"
      ? Response.json({ message: record })
      : Response.json({ title: "Another work", doi: "https://doi.org/10.9999/another", is_retracted: true }));
    const result = await check("LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("verified");
    expect(result.notes.some((i) => /撤稿.*未完成/.test(i))).toBe(true);
  });

  it("does not treat an omitted retraction status as a negative retraction check", async () => {
    vi.stubGlobal("fetch", async (input: string) => new URL(input).hostname === "api.crossref.org"
      ? Response.json({ message: record })
      : Response.json({ title: "Deep learning", doi: "https://doi.org/10.9999/regression" }));
    const result = await check("LeCun, Y., et al. (2015). Deep learning. Nature, 521(7553), 436-444. DOI: 10.9999/regression");
    expect(result.verdict).toBe("verified");
    expect(result.notes.some((i) => /撤稿.*未完成/.test(i))).toBe(true);
  });
});

describe("incomplete evidence is not absence", () => {
  it.each([403, 401, 400])("treats upstream HTTP %s as unavailable", async (status) => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status }));
    const result = await check(raw("upstream-403-becomes-not-found"));
    expect(result.verdict).toBe("error");
  });

  it.each(["<html>blocked</html>", "{}", '{"message":{}}'])
    ("rejects malformed success responses: %s", async (body) => {
      vi.stubGlobal("fetch", async () => new Response(body, { status: 200 }));
      const result = await check(raw("upstream-403-becomes-not-found"));
      expect(result.verdict).toBe("error");
    });

  it("does not declare a missing work when the second search was skipped for budget", async () => {
    const calls = fixture();
    const result = await check(raw("budget-zero-single-source-becomes-not-found"), 0);
    expect(result.verdict).toBe("unverifiable");
    expect(result.notes.some((i) => i.includes("额度"))).toBe(true);
    expect(calls).toEqual(["api.crossref.org/works"]);
  });

  it("still reports no match when both sources successfully returned empty search results", async () => {
    fixture();
    const result = await check(raw("budget-zero-single-source-becomes-not-found"));
    expect(result.verdict).toBe("not_found");
    expect(result.steps.filter((s) => s.action.endsWith("search"))).toHaveLength(2);
  });

  it("does not declare an unregistered-DOI citation fabricated before completing the fallback search", async () => {
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "doi.org") return Response.json([{ status: "DOI does not exist" }]);
      if (url.pathname !== "/works") return new Response("Not Found", { status: 404 });
      return Response.json({ message: { items: [] } });
    });
    const result = await check(raw("budget-zero-single-source-becomes-not-found") + " DOI: 10.9999/nonexistent", 0);
    expect(result.verdict).toBe("unverifiable");
    expect(result.issues.some((i) => i.includes("DOI"))).toBe(true);
    expect(result.notes.some((i) => i.includes("额度"))).toBe(true);
  });

  it("does not interpret a missing search endpoint as an empty result set", async () => {
    vi.stubGlobal("fetch", async () => new Response("Not Found", { status: 404 }));
    const result = await check(raw("upstream-403-becomes-not-found"));
    expect(result.verdict).toBe("error");
  });
});

describe("request cancellation", () => {
  it("does not schedule any references when cancelled before verification", async () => {
    const calls = fixture();
    const { verifyAll } = await import("../verify");
    const onResult = vi.fn();
    await verifyAll([parseReference(raw("budget-zero-single-source-becomes-not-found"), 1)], onResult, {
      signal: AbortSignal.abort(),
    });
    expect(calls).toHaveLength(0);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("stops subsequent references when the current result cancels the request", async () => {
    const calls = fixture();
    const controller = new AbortController();
    const { verifyAll } = await import("../verify");
    const onResult = vi.fn(() => controller.abort());
    const text = raw("budget-zero-single-source-becomes-not-found");
    await verifyAll([parseReference(text, 1), parseReference(text + " Second.", 2)], onResult, {
      concurrency: 1, signal: controller.signal,
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    // 只有第一条的检索：两个数据源的题名检索，加上下"查无此文"结论前的期刊收录范围确认
    expect(calls).toEqual(["api.crossref.org/works", "api.openalex.org/works", "api.crossref.org/journals"]);
  });
});
