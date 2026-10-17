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
  const NEAR = "LeCun, Y., et al. (2015). Alpha beta gamma delta. Nature, 521(7553), 436-444.";
  const nearRecord = { ...record, title: ["Alpha beta gamma delta epsilon zeta eta theta"] };

  /** 引文 DOI 的三种情况：Crossref 里是另一篇、doi.org 未注册；整条检索都返回同一篇相近候选 */
  function doiFixture(doiRecord: CrossrefItem | undefined) {
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.crossref.org") {
        if (url.pathname === "/journals") return Response.json({ message: { items: [] } });
        if (url.pathname === "/works") return Response.json({ message: { items: [nearRecord] } });
        return doiRecord ? Response.json({ message: doiRecord }) : new Response("Resource not found.", { status: 404 });
      }
      if (url.hostname === "doi.org") return Response.json([{ DOI: "10.9999/missing", status: "DOI does not exist" }]);
      if (url.hostname === "api.openalex.org") return Response.json({ results: [] });
      throw new Error(`Unexpected fixture request: ${url.hostname}`);
    });
  }

  it.each([20, 0])("reports a nearby record as a near match, not as wrong information (budget %s)", async (budget) => {
    fixture(record, { searchItems: [nearRecord] });
    const result = await check(NEAR, budget);
    expect(result.verdict).toBe("near_match");
    expect(result.matchStatus).toBe("candidate");
    expect(result.issues).toEqual([]);
    expect(result.summary).toContain("不能确认是同一篇");
    expect(result.match?.title).toBe("Alpha beta gamma delta epsilon zeta eta theta");
    expect(result.suggestion).toContain("Alpha beta gamma delta epsilon zeta eta theta");
  });

  it("keeps an unregistered DOI as wrong information even when a near candidate exists", async () => {
    doiFixture(undefined);
    const result = await check(`${NEAR} https://doi.org/10.9999/missing`);
    expect(result.verdict).toBe("mismatch");
    expect(result.matchStatus).toBe("candidate");
    expect(result.issues.join("")).toContain("查无注册记录");
    expect(result.summary).toContain("DOI 不存在");
  });

  it("keeps a DOI that points to another work as wrong information even when a near candidate exists", async () => {
    doiFixture({ ...record, DOI: "10.9999/other", title: ["Soil microbial respiration under drought"], author: [{ family: "Okafor", given: "Chidi" }] });
    const result = await check(`${NEAR} https://doi.org/10.9999/other`);
    expect(result.verdict).toBe("mismatch");
    expect(result.matchStatus).toBe("candidate");
    expect(result.issues.join("")).toContain("实际指向");
    expect(result.summary).toContain("张冠李戴");
  });

  it("keeps a wrong DOI as wrong information when the search was cut short", async () => {
    doiFixture(undefined);
    const result = await check(`${NEAR} https://doi.org/10.9999/missing`, 0);
    expect(result.verdict).toBe("mismatch");
    expect(result.summary).toContain("DOI 有误");
    expect(result.notes.join("")).toContain("额度已用完");
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

describe("upstream failure wording", () => {
  it.each([400, 401, 403])("says the data source rejected the query on HTTP %s instead of suggesting a retry", async (status) => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status }));
    const result = await check(raw("upstream-403-becomes-not-found"));
    expect(result.verdict).toBe("error");
    expect(result.summary).toBe(`查询被数据源拒绝（HTTP ${status}），本条未完成核验，请人工核查`);
  });

  it.each([429, 503])("keeps the retry hint for HTTP %s", async (status) => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status }));
    const { verifyReference } = await import("../verify");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const pending = verifyReference(parseReference(raw("upstream-403-becomes-not-found"), 1), { openalexBudget: { left: 20 } });
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result.verdict).toBe("error");
    expect(result.summary).toBe("数据源暂时不可用（可能被限流），请稍后重试");
  });
});

describe("OpenAlex wildcard characters", () => {
  it("searches a title containing a question mark instead of ending in an error", async () => {
    const filters: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.crossref.org") return Response.json({ message: { items: [] } });
      if (url.hostname === "api.openalex.org" && url.pathname === "/works") {
        const filter = url.searchParams.get("filter") ?? "";
        filters.push(filter);
        // 与 OpenAlex 的实际行为一致：title.search 里有 ? 或 * 就返回 400
        if (/[?*]/.test(filter)) return Response.json({ error: "Invalid query parameters error." }, { status: 400 });
        return Response.json({ results: [{
          id: "https://openalex.org/W9", doi: "https://doi.org/10.9999/bigger", title: "Is bigger always better? Scaling laws for small language models",
          publication_year: 2021, authorships: [{ author: { display_name: "Kyung Lee" } }, { author: { display_name: "Jisoo Park" } }],
          primary_location: { source: { display_name: "Journal of Model Studies", type: "journal" } }, is_retracted: false, type: "article",
          biblio: { volume: "4", issue: "2", first_page: "11", last_page: "19" },
        }] });
      }
      throw new Error(`Unexpected fixture request: ${url.hostname}${url.pathname}`);
    });
    const result = await check('K. Lee and J. Park, "Is bigger always better? Scaling laws for small language models," Journal of Model Studies, vol. 4, no. 2, pp. 11-19, 2021.');
    expect(filters).toEqual(["title.search:Is bigger always better Scaling laws for small language models"]);
    expect(result.verdict).toBe("verified");
    expect(result.match?.source).toBe("openalex");
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
