import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatGbt } from "../format";
import { parseReference } from "../extract";
import { scoreCandidate } from "../match";
import { clearSearchCache, cnJournalSearch, deepseekSearch, parseCnki, parseCqvip, parseHits, parseWanfang, sameTitle, type SearchHit } from "../sources/cnweb";
import type { WorkRecord } from "../types";

// Synthetic search results in the formats DeepSeek Search returned for CQVIP, CNKI and Wanfang on 2026-10-17;
// titles, authors and journals are invented for the tests.
const hit = (fields: Partial<SearchHit>): SearchHit => ({ title: "", url: "", snippet: "", summary: "", date: null, siteName: null, ...fields });
const cqvipMobile = hit({
  title: "城市绿地降温效应的多尺度研究",
  url: "https://mqikan.cqvip.com/article/ArticleDetail?id=7200000001",
  summary: "# 城市绿地降温效应的多尺度研究\n\n作者：张三 李四\n\n出处：《测试地理学报》2021年第3期12-20,共9页\n\n摘要：（合成摘要）",
  siteName: "维普网",
});
const cqvipDoc = hit({
  title: "城市绿地降温效应的多尺度研究-文献详情-维普官网",
  url: "https://www.cqvip.com/doc/journal/7200000001",
  summary: "城市绿地降温效应的多尺度研究\n...\n来 源：\n\n《测试地理学报》  • 2021年3期 12-20，共9页\n\n关 键 词：\n\n城市绿地;",
});
const cnki = hit({
  title: "城市绿地降温效应的多尺度研究-测试地理学报2021年03期-手机知网",
  url: "https://wap.cnki.net/touch/web/Journal/Article/CSDL202103002.html",
  summary: "城市绿地降温效应的多尺度研究\n\n（合成摘要）\n\n测试地理学报\n\n2021年03期",
  siteName: "手机知网",
});
const wanfang = hit({
  title: "城市绿地降温效应的多尺度研究",
  url: "https://d.wanfangdata.com.cn/periodical/csdlxb202103002",
  summary: "城市绿地降温效应的多尺度研究\n...\n文献发表日期：\n\n2021-03-15",
});

describe("parsing Chinese journal article pages", () => {
  it("reads authors, journal, year, issue and pages from a CQVIP result", () => {
    expect(parseCqvip(cqvipMobile)).toMatchObject({
      source: "web", site: "维普", title: "城市绿地降温效应的多尺度研究",
      authors: [{ family: "张三" }, { family: "李四" }], venue: "测试地理学报", year: 2021, issue: "3", pages: "12-20",
    });
  });

  it("reads the journal from a “来 源” value on the next line and strips the CQVIP title suffix", () => {
    expect(parseCqvip(cqvipDoc)).toMatchObject({ title: "城市绿地降温效应的多尺度研究", authors: [], venue: "测试地理学报", year: 2021, issue: "3", pages: "12-20" });
  });

  it("reads title, journal, year and issue from a CNKI page title, without authors", () => {
    expect(parseCnki(cnki)).toMatchObject({ site: "知网", title: "城市绿地降温效应的多尺度研究", authors: [], venue: "测试地理学报", year: 2021, issue: "3" });
  });

  it("strips the site suffixes of CNKI reader and CQVIP document pages", () => {
    expect(parseCnki({ ...cnki, title: "城市绿地降温效应的多尺度研究-测试地理学报2021年03期-知网阅读", url: "https://read.cnki.net/web/Journal/Article/CSDL202103002.html" }))
      .toMatchObject({ title: "城市绿地降温效应的多尺度研究", venue: "测试地理学报", year: 2021, issue: "3" });
    expect(parseCqvip({ ...cqvipDoc, title: "城市绿地降温效应的多尺度研究-文献详情-维普官网 - - 首页" })).toMatchObject({ title: "城市绿地降温效应的多尺度研究" });
    expect(parseCqvip({ ...cqvipMobile, summary: cqvipMobile.summary.replace("作者：", "作 者：") })?.authors).toHaveLength(2);
  });

  it("falls back to the CNKI summary lines, then to the article code in the URL", () => {
    expect(parseCnki({ ...cnki, title: "城市绿地降温效应的多尺度研究" })).toMatchObject({ venue: "测试地理学报", year: 2021, issue: "3" });
    expect(parseCnki({ ...cnki, title: "城市绿地降温效应的多尺度研究", summary: "（合成摘要）" })).toMatchObject({ venue: undefined, year: 2021, issue: "3" });
  });

  it("takes year and issue from a Wanfang periodical URL and ignores thesis pages", () => {
    expect(parseWanfang(wanfang)).toMatchObject({ site: "万方", title: "城市绿地降温效应的多尺度研究", authors: [], year: 2021, issue: "3" });
    expect(parseWanfang({ ...wanfang, url: "https://d.wanfangdata.com.cn/thesis/Ch1UaGVzaXM" })).toBeUndefined();
  });

  it("reads CNKI Space and Xuewen pages, taking year and issue from the article code", () => {
    expect(parseCnki({ ...cnki, title: "城市绿地降温效应的多尺度研究 - 城市绿地降温效应的多尺度研究", url: "https://www.cnki.com.cn/Article/CJFDTOTAL-CSDL202103002.htm#1", summary: "" }))
      .toMatchObject({ site: "知网", title: "城市绿地降温效应的多尺度研究", year: 2021, issue: "3" });
    expect(parseCnki({ ...cnki, title: "城市绿地降温效应的多尺度研究", url: "https://xuewen.cnki.net/CJFD-CSDL202103002.html", summary: "" }))
      .toMatchObject({ year: 2021, issue: "3" });
    // 知网空间的百科、学者页不是论文页
    expect(parseCnki({ ...cnki, url: "https://wiki.cnki.com.cn/HotWord/5624395.htm" })).toBeUndefined();
  });

  it("reads the volume when CQVIP writes it without 第", () => {
    const rec = parseCqvip({ ...cqvipDoc, summary: "来源：《测试地理学报》 • 2025年26卷 4期84-92 ，共9页" });
    expect(rec).toMatchObject({ venue: "测试地理学报", year: 2025, volume: "26", issue: "4", pages: "84-92" });
  });

  it("keeps only article pages of the three sites", () => {
    const other = hit({ title: "城市绿地降温效应的多尺度研究", url: "https://example.org/blog", summary: "作者：张三\n出处：《测试地理学报》2021年第3期" });
    expect(parseHits([other, cqvipMobile, cqvipMobile, wanfang]).map((r) => r.site)).toEqual(["维普", "万方"]);
  });

  it("treats title punctuation and subtitle separators as the same title, but not a different title", () => {
    expect(sameTitle("城市绿地降温效应——多尺度研究", "城市绿地降温效应:多尺度研究")).toBe(true);
    expect(sameTitle("城市绿地降温效应的多尺度研究", "城市绿地降温效应")).toBe(false);
  });
});

describe("rules for Chinese web records", () => {
  const cited = "张三, 李四. 城市绿地降温效应的多尺度研究[J]. 测试地理学报, 2021(3): 12-20.";
  const fake = "王五, 赵六. 城市绿地降温效应的多尺度研究[J]. 测试地理学报, 2021(3): 12-20.";
  const withAuthors = parseCqvip(cqvipMobile)!;
  const withoutAuthors = parseCnki(cnki)!;

  it("confirms a CQVIP record whose authors, journal and year match", () => {
    expect(scoreCandidate(parseReference(cited, 1), withAuthors)).toMatchObject({ same: true, firstAuthor: "match" });
  });

  it("never confirms a record without authors, however well the title, journal and year match", () => {
    const score = scoreCandidate(parseReference(cited, 1), withoutAuthors);
    expect(score.same).toBe(false);
    expect(score.partial).toBe(true);
  });

  it("still treats a real title with invented authors as the same work, so the authors are reported as wrong", () => {
    expect(scoreCandidate(parseReference(fake, 1), withAuthors)).toMatchObject({ same: true, firstAuthor: "mismatch" });
  });

  it("formats a journal issue without a volume the way GB/T 7714 allows", () => {
    expect(formatGbt(withAuthors as WorkRecord)).toBe("张三, 李四. 城市绿地降温效应的多尺度研究[J]. 测试地理学报, 2021(3): 12-20.");
  });
});

describe("DeepSeek Search client", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key-never-real");
    vi.stubEnv("DEEPSEEK_BASE_URL", "");
    // 成功的搜索结果会缓存 6 小时，各测试之间要清掉
    clearSearchCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const api = (h: SearchHit) => ({ title: h.title, url: h.url, snippet: h.snippet, summary: h.summary, date: h.date, site_name: h.siteName });

  /** 依次返回各次搜索的结果；数字表示这次返回该 HTTP 状态码 */
  function serve(...responses: (SearchHit[] | number)[]) {
    const bodies: { query: string; count: number }[] = [];
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      urls.push(input);
      bodies.push(JSON.parse(String(init?.body)));
      const next = responses.shift() ?? [];
      if (typeof next === "number") return new Response("{}", { status: next });
      return Response.json({ results: next.map(api) });
    });
    return { bodies, urls };
  }

  it("searches the three sites, then CQVIP alone when the matching pages carry no authors", async () => {
    const { bodies, urls } = serve([cnki, wanfang], [cqvipMobile]);
    const { records, searches } = await cnJournalSearch("城市绿地降温效应的多尺度研究");
    expect(searches).toBe(2);
    expect(urls).toEqual(["https://api.deepseek.com/v1/tools/search", "https://api.deepseek.com/v1/tools/search"]);
    expect(bodies[0].query).toBe("城市绿地降温效应的多尺度研究 site:cnki.net OR site:wanfangdata.com.cn OR site:cqvip.com");
    expect(bodies[1].query).toBe("城市绿地降温效应的多尺度研究 site:cqvip.com");
    expect(records.map((r) => r.site)).toEqual(["维普", "知网", "万方"]);
  });

  it.each([[429, /频繁/], [402, /余额不足/], [503, /暂时不可用/]])("keeps the first search's records when the CQVIP follow-up gets HTTP %s", async (status, message) => {
    serve([cnki, wanfang], status);
    const { records, searches, supplementError } = await cnJournalSearch("城市绿地降温效应的多尺度研究");
    expect(records.map((r) => r.site)).toEqual(["知网", "万方"]);
    expect(searches).toBe(2);
    expect(supplementError).toMatch(message);
  });

  it("keeps the first search's records when the CQVIP follow-up cannot connect", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      if (n++ === 0) return Response.json({ results: [api(cnki)] });
      throw new TypeError("fetch failed");
    });
    const { records, supplementError } = await cnJournalSearch("城市绿地降温效应的多尺度研究");
    expect(records.map((r) => r.site)).toEqual(["知网"]);
    expect(supplementError).toMatch(/连接失败/);
  });

  it("still stops when the check is cancelled during the CQVIP follow-up", async () => {
    const controller = new AbortController();
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      if (n++ === 0) return Response.json({ results: [api(cnki)] });
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await expect(cnJournalSearch("城市绿地降温效应的多尺度研究", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports a failed first search as an unavailable source", async () => {
    serve(429);
    await expect(cnJournalSearch("城市绿地降温效应的多尺度研究")).rejects.toMatchObject({ message: expect.stringMatching(/频繁/), status: 429 });
  });

  it("does not search again when a matching page already has authors", async () => {
    serve([cnki, cqvipMobile]);
    expect((await cnJournalSearch("城市绿地降温效应的多尺度研究")).searches).toBe(1);
  });

  it("keeps the query within the 128-character limit, site filters included", async () => {
    const { bodies } = serve([]);
    await cnJournalSearch("很长的题名".repeat(30));
    expect(bodies[0].query.length).toBeLessThanOrEqual(128);
    expect(bodies[0].query.endsWith("site:cqvip.com")).toBe(true);
  });

  it("uses /v1/tools/search under the configured base, with or without a /v1 suffix", async () => {
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://gateway.example/v1/");
    const { urls } = serve([]);
    await deepseekSearch("测试", 5);
    expect(urls).toEqual(["https://gateway.example/v1/tools/search"]);
  });

  it.each([[402, /余额不足/], [429, /频繁/], [500, /暂时不可用/]])("reports HTTP %s as an unavailable source, not as no results", async (status, message) => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status }));
    await expect(deepseekSearch("测试", 5)).rejects.toMatchObject({ message: expect.stringMatching(message), status });
  });

  it("retries once after a connection timeout, but not twice", async () => {
    const timeoutError = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      if (n++ === 0) throw timeoutError();
      return Response.json({ results: [api(cnki)] });
    });
    expect((await deepseekSearch("重试一次", 5)).map((h) => h.url)).toEqual([cnki.url]);
    expect(n).toBe(2);
    vi.stubGlobal("fetch", async () => { throw timeoutError(); });
    await expect(deepseekSearch("一直连不上", 5)).rejects.toThrow(/连接失败/);
  });

  it("refuses to run without a key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    await expect(deepseekSearch("测试", 5)).rejects.toThrow(/尚未配置/);
  });
});
