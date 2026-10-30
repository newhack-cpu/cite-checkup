import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chineseJournalView, citedVolumePage, CN_LIMITS, lookupChineseJournal } from "../cnjournal";
import { parseReference } from "../extract";
import { scoreCandidate } from "../match";
import {
  clearPageCache, cnkiJournalCode, officialCandidate, parseArticleMeta, parseCnkiArticle, parseCnkiJournalIssn, reprintSite,
} from "../sources/cnpage";
import { clearSearchCache, cnkiArticleCode, parseHits, type SearchHit } from "../sources/cnweb";
import { Gate } from "../throttle";
import type { CheckStep, RefResult } from "../types";
import { verifyAll, verifyReference } from "../verify";

// 请求页面前会做 DNS 解析，确认是公网地址；测试不联网，一律解析到文档用的公网地址
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));

// 题名、作者、刊名都是编的；页面结构照 2026-10-19 实测的手机知网文章页、知网期刊页和期刊官网文章页
const TITLE = "城市绿地降温效应的多尺度研究";
const CITED = `张三, 李四. ${TITLE}[J]. 测试地理学报, 2021, 41(3): 12-20.`;
const CITED_VOLUME_PAGES = `张三, 李四. 2021. ${TITLE}. 测试地理学报, 41: 412–420.`;
const FAKE_AUTHORS = `王五, 赵六. ${TITLE}[J]. 测试地理学报, 2021, 41(3): 12-20.`;
const CODE = "CSDL202103002";
const CNKI_URL = `https://wap.cnki.net/touch/web/Journal/Article/${CODE}.html`;
const OFFICIAL_URL = "https://www.csdl-journal.example/CN/10.99999/j.csdl.2021.03.002";

/** Nuxt 的压缩格式：对象和数组里存的是元素下标 */
function nuxt(info: Record<string, string | string[]>): string {
  const list: unknown[] = [["Reactive", 1], { data: 2 }, { getArticleDetail: 3 }, { info: 4 }];
  const obj: Record<string, number> = {};
  list.push(obj);
  for (const [key, value] of Object.entries(info)) {
    if (Array.isArray(value)) {
      const at = list.length;
      list.push([]);
      obj[key] = at;
      (list[at] as number[]).push(...value.map((v) => list.push(v) - 1));
    } else {
      obj[key] = list.push(value) - 1;
    }
  }
  return `<!DOCTYPE html><html><head><title>t</title></head><body><script type="application/json" id="__NUXT_DATA__" data-ssr="true">${JSON.stringify(list)}</script></body></html>`;
}
const cnkiPage = (fields: Partial<Record<string, string | string[]>> = {}) => nuxt({
  fileName: CODE, title: TITLE, author: ["张三", "李四"], publishName: "测试地理学报", year: "2021", period: "03", page: "22-30", ...fields,
} as Record<string, string | string[]>);
const journalPage = (issn = "1000-0000") => {
  const list = [{ data: 1 }, { code: 2, name: 3, issn: 4 }, "CSDL", "测试地理学报", issn];
  return `<html><head></head><body><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(list)}</script></body></html>`;
};
const officialPage = (meta: [string, string][]) =>
  `<html><head>${meta.map(([n, c]) => `<meta name="${n}" content="${c}">`).join("\n")}</head><body>文章页</body></html>`;
const fullMeta: [string, string][] = [
  ["citation_title", TITLE], ["citation_authors", "张三1，2，李四2"], ["citation_title", "Multiscale study of cooling by urban green space"],
  ["citation_authors", "ZHANG San1，2，LI Si2"], ["citation_journal_title", "测试地理学报"], ["citation_issn", "1000-0000"],
  ["citation_volume", "41"], ["citation_issue", "3"], ["citation_firstpage", "12"], ["citation_lastpage", "20"],
  ["citation_date", "2021-03-15"], ["citation_doi", "10.99999/j.csdl.2021.03.002"],
];

const hit = (fields: Partial<SearchHit>): SearchHit => ({ title: "", url: "", snippet: "", summary: "", date: null, siteName: null, ...fields });
const cnkiHit = hit({ title: `${TITLE}-测试地理学报2021年03期-手机知网`, url: CNKI_URL, summary: `${TITLE}\n\n测试地理学报\n\n2021年03期` });
const wanfangHit = hit({ title: TITLE, url: "https://d.wanfangdata.com.cn/periodical/csdlxb202103002" });
const cqvipHit = hit({
  title: TITLE, url: "https://mqikan.cqvip.com/article/ArticleDetail?id=7200000001",
  summary: `# ${TITLE}\n\n作者：张三 李四\n\n出处：《测试地理学报》2021年第3期12-20,共9页`,
});
const officialHit = hit({ title: `${TITLE} - 测试地理学报`, url: OFFICIAL_URL });
const vpnHit = hit({ title: `${TITLE}-测试地理学报2021年03期-手机知网`, url: `https://wap-cnki-net-443.webvpn.example.edu.cn/touch/web/Journal/Article/${CODE}.html` });

interface World {
  /** 按检索词的结尾区分：三站、只查维普、不限站点 */
  sites?: SearchHit[] | number;
  cqvip?: SearchHit[] | number;
  open?: SearchHit[] | number;
  pages?: Record<string, string | number>;
  crossref?: (url: URL) => unknown;
  /** 让某类请求一直挂着，直到被取消 */
  hang?: "search" | "page";
}

function serve(world: World) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push(`${url.hostname}${url.pathname}`);
    const hangUntilAborted = () => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    if (url.hostname === "api.deepseek.com") {
      if (world.hang === "search") return hangUntilAborted();
      const query = String(JSON.parse(String(init?.body)).query);
      const reply = query.endsWith("site:cqvip.com") && !query.includes(" OR ") ? world.cqvip : query.includes(" OR ") ? world.sites : world.open;
      if (typeof reply === "number") return new Response("{}", { status: reply });
      const results = (reply ?? []).map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, summary: h.summary, date: h.date, site_name: h.siteName }));
      return Response.json({ results });
    }
    if (url.hostname === "api.crossref.org") {
      const custom = world.crossref?.(url);
      if (custom !== undefined) return custom instanceof Response ? custom : Response.json(custom);
      if (url.pathname === "/works") return Response.json({ message: { items: [] } });
      return new Response("Resource not found.", { status: 404 });
    }
    const page = world.pages?.[input];
    if (page !== undefined) {
      if (world.hang === "page") return hangUntilAborted();
      if (typeof page === "number") return new Response("", { status: page });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    throw new TypeError(`fetch failed: ${input}`);
  });
  return calls;
}

const searches = (calls: string[]) => calls.filter((c) => c === "api.deepseek.com/v1/tools/search").length;

async function check(raw: string, cn: { left: number; deadline?: number } | undefined = { left: 5 }, signal?: AbortSignal): Promise<RefResult> {
  return verifyReference(parseReference(raw, 1), { openalexBudget: { left: 0 }, signal, cn });
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "fixture-key-never-real");
  vi.stubEnv("DEEPSEEK_BASE_URL", "");
  clearSearchCache();
  clearPageCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("completing authors for Chinese journal articles in the standard check", () => {
  it("a. uses a CQVIP result that already lists the authors, without reading any page", async () => {
    const calls = serve({ sites: [cnkiHit, cqvipHit] });
    const result = await check(CITED);
    expect(result).toMatchObject({ verdict: "verified", matchStatus: "confirmed", summary: "已核实：与维普记录一致（来源：维普）" });
    expect(result.match).toMatchObject({ site: "维普", url: cqvipHit.url });
    expect(searches(calls)).toBe(1);
    expect(calls).not.toContain(`wap.cnki.net/touch/web/Journal/Article/${CODE}.html`);
  });

  it("b. reads the authors from the CNKI mobile article page when the search result has none", async () => {
    const calls = serve({ sites: [cnkiHit, wanfangHit], pages: { [CNKI_URL]: cnkiPage() } });
    const result = await check(CITED);
    expect(result).toMatchObject({ verdict: "verified", summary: "已核实：与知网记录一致（来源：知网）" });
    expect(result.match).toMatchObject({ site: "知网", authors: [{ family: "张三" }, { family: "李四" }], issue: "3", url: CNKI_URL });
    // 知网页面的页码是期内页码，不取；没有印刷页码时不给规范写法
    expect(result.match?.pages).toBeUndefined();
    expect(result.suggestion).toBeUndefined();
    expect(result.steps.find((s) => s.action === "cn_page")?.detail).toContain("作者 张三, 李四");
    expect(searches(calls)).toBe(1);
  });

  it("c. reads volume, issue and pages from the journal's own article page", async () => {
    serve({ sites: [wanfangHit], cqvip: [], open: [officialHit], pages: { [OFFICIAL_URL]: officialPage(fullMeta) } });
    const result = await check(CITED_VOLUME_PAGES.replace("41: 412–420", "41: 12–20"));
    expect(result).toMatchObject({ verdict: "verified", summary: "已核实：与期刊官网记录一致（来源：期刊官网）" });
    expect(result.match).toMatchObject({ site: "期刊官网", volume: "41", issue: "3", pages: "12-20", doi: "10.99999/j.csdl.2021.03.002", authors: [{ family: "张三" }, { family: "李四" }] });
    expect(result.suggestion).toContain("测试地理学报, 2021, 41(3): 12-20");
  });

  it("d. takes the year from Crossref by DOI when the journal page leaves it out", async () => {
    const noDate = fullMeta.filter(([n]) => n !== "citation_date");
    serve({
      sites: [], open: [officialHit], pages: { [OFFICIAL_URL]: officialPage(noDate) },
      crossref: (url) => url.pathname === "/works/10.99999/j.csdl.2021.03.002" ? {
        message: {
          DOI: "10.99999/j.csdl.2021.03.002", title: ["Multiscale study of cooling by urban green space"], issued: { "date-parts": [[2021, 3]] },
          author: [{ family: "ZHANG", given: "San" }, { family: "LI", given: "Si" }], volume: "41", issue: "3", page: "12-20", "container-title": ["Acta Test Geographica"],
        },
      } : undefined,
    });
    const result = await check(CITED);
    expect(result).toMatchObject({ verdict: "verified", summary: "已核实：与期刊官网、Crossref 记录一致（来源：期刊官网、Crossref）" });
    expect(result.match).toMatchObject({ year: 2021, volume: "41" });
  });

  it("d. locates the volume and printed pages in Crossref by the journal's ISSN when CNKI only gives the issue", async () => {
    const issn = "1000-0000";
    const calls = serve({
      sites: [cnkiHit], open: [], pages: { [CNKI_URL]: cnkiPage(), "https://wap.cnki.net/touch/web/Journal/Index/CSDL.html": journalPage(issn) },
      crossref: (url) => url.pathname === `/journals/${issn}/works` ? {
        message: {
          items: [
            { DOI: "10.99999/other", title: ["Another paper"], issued: { "date-parts": [[2021]] }, author: [{ family: "WANG", given: "Wu" }], volume: "41", page: "300-311" },
            { DOI: "10.99999/csdl.2021.412", title: ["Multiscale study of cooling by urban green space"], issued: { "date-parts": [[2021]] }, author: [{ family: "ZHANG", given: "San" }, { family: "LI", given: "Si" }], volume: "41", issue: "3", page: "412-420" },
          ],
        },
      } : undefined,
    });
    const result = await check(CITED_VOLUME_PAGES);
    expect(result).toMatchObject({ verdict: "verified", summary: "已核实：与知网、Crossref 记录一致（来源：知网、Crossref）" });
    expect(result.match).toMatchObject({ authors: [{ family: "张三" }, { family: "李四" }], volume: "41", pages: "412-420", doi: "10.99999/csdl.2021.412" });
    expect(calls).toContain(`api.crossref.org/journals/${issn}/works`);
  });
});

describe("strict judgement of Chinese web records", () => {
  it("keeps a CNKI page without readable authors as a near match with its link", async () => {
    serve({ sites: [cnkiHit], cqvip: [], open: [], pages: { [CNKI_URL]: 403 } });
    const result = await check(CITED);
    expect(result).toMatchObject({ verdict: "near_match", matchStatus: "candidate", summary: "在知网找到题名、刊名、年份一致的文章，但没有作者信息，请打开链接核对作者" });
    expect(result.match?.url).toBe(CNKI_URL);
    expect(result.steps.some((s) => s.action === "cn_page" && s.detail.includes("HTTP 403"))).toBe(true);
  });

  it("reports a real title with invented authors as wrong authors, never as verified", async () => {
    serve({ sites: [cnkiHit], pages: { [CNKI_URL]: cnkiPage() } });
    const result = await check(FAKE_AUTHORS);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("作者与知网记录不符，知网记录的作者为 张三, 李四");
    expect(result.summary).toContain("（来源：知网）");
  });

  it("reports a real first author with an invented coauthor", async () => {
    serve({ sites: [cqvipHit] });
    const result = await check(`张三, 王五. ${TITLE}[J]. 测试地理学报, 2021, 41(3): 12-20.`);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("作者");
  });

  it("does not verify when only the volume and pages are cited and CNKI has neither", async () => {
    serve({ sites: [cnkiHit], cqvip: [], open: [], pages: { [CNKI_URL]: cnkiPage(), "https://wap.cnki.net/touch/web/Journal/Index/CSDL.html": 404 } });
    const result = await check(CITED_VOLUME_PAGES);
    expect(result).toMatchObject({ verdict: "near_match", matchStatus: "candidate" });
    expect(result.summary).toBe("在知网找到题名、作者、刊名、年份一致的文章，但卷期页码没能核对（知网记录为 2021 年第 3 期，没有卷号），请打开链接核对卷期页码");
  });

  it("does not verify when the year is one off", async () => {
    serve({ sites: [cnkiHit], pages: { [CNKI_URL]: cnkiPage({ year: "2020" }) }, cqvip: [], open: [] });
    const result = await check(CITED);
    expect(result.verdict).toBe("near_match");
    expect(result.summary).toContain("年份相差一年");
  });

  it("does not take a same-titled article in another journal as the cited one", async () => {
    serve({ sites: [cnkiHit], pages: { [CNKI_URL]: cnkiPage({ publishName: "另一本期刊", author: ["钱七"] }) }, cqvip: [], open: [] });
    const result = await check(CITED);
    expect(result.verdict).not.toBe("verified");
    expect(result.verdict).not.toBe("mismatch");
  });

  it("does not compare an institutional byline with the article's writers", async () => {
    serve({ sites: [cnkiHit], pages: { [CNKI_URL]: cnkiPage({ author: ["钱七"] }) }, cqvip: [], open: [] });
    const result = await check(`测试大学地理研究所, 测试省文物局. ${TITLE}[J]. 测试地理学报, 2021(3): 12-20.`);
    expect(result.verdict).toBe("near_match");
    expect(result.summary).toContain("引文署名是单位");
  });

  it("treats spaces inside Chinese names as part of the name", () => {
    const rec = parseCnkiArticle(cnkiPage({ author: ["王韦韦", "朱存玺"] }), CODE, CNKI_URL).value!;
    const score = scoreCandidate(parseReference(`王 韦韦, 朱 存玺. ${TITLE}. 测试地理学报, 2021, 41(3): 12-20.`, 1), rec);
    expect(score).toMatchObject({ firstAuthor: "match", authorListMismatch: false });
  });

  it("never turns a failed Chinese search into a claim that the work does not exist", async () => {
    serve({ sites: [], cqvip: [], open: [] });
    const result = await check(CITED);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toBe("开放数据库和知网、万方、维普联网检索都没能核对到这篇文章；查不到不代表不存在，请人工核查");
  });
});

describe("reprint sites are never sources", () => {
  it("ignores WebVPN mirrors of CNKI in search results and when reading pages", async () => {
    expect(reprintSite(vpnHit.url)).toBe(true);
    expect(cnkiArticleCode(vpnHit.url)).toBeUndefined();
    expect(parseHits([vpnHit])).toEqual([]);
    expect(officialCandidate(vpnHit.url)).toBe(false);
    const calls = serve({ sites: [vpnHit], cqvip: [], open: [vpnHit] });
    const result = await check(CITED);
    expect(result.verdict).toBe("unverifiable");
    expect(calls.some((c) => c.includes("webvpn"))).toBe(false);
  });

  it.each([
    "https://xueshu.baidu.com/usercenter/paper/show?paperid=1",
    "https://max.book118.com/html/2024/0401/1.shtm",
    "https://ir.example.edu.cn/handle/123/456",
    "https://faculty.example.edu.cn/zh_CN/lwcg/1/content/2.htm",
    "https://data.hnstl.cn:8081/S/Paper.aspx?q=1",
  ])("treats %s as a reprint site", (url) => {
    expect(officialCandidate(url)).toBe(false);
  });

  it("accepts journal platforms and keeps the three databases on their own parsers", () => {
    expect(officialCandidate("https://pubs.cstam.org.cn/em/article/Y2021/I9/146")).toBe(true);
    expect(officialCandidate(CNKI_URL)).toBe(false);
    expect(officialCandidate(wanfangHit.url)).toBe(false);
  });
});

describe("without a DeepSeek key the check is unchanged", () => {
  it("skips the Chinese search and keeps the previous conclusion", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const calls = serve({ sites: [cqvipHit] });
    const results: RefResult[] = [];
    await verifyAll([parseReference(CITED, 1)], (r) => results.push(r), { openalexBudget: 0 });
    expect(results[0]).toMatchObject({ verdict: "unverifiable", summary: "开放数据库对中文文献收录有限，未检索到不代表不存在，请到知网 / 万方核查" });
    expect(searches(calls)).toBe(0);
    expect(results[0].steps.map((s) => s.action)).toEqual(["crossref_search"]);
  });

  it("can be switched off explicitly", async () => {
    const calls = serve({ sites: [cqvipHit] });
    const results: RefResult[] = [];
    await verifyAll([parseReference(CITED, 1)], (r) => results.push(r), { openalexBudget: 0, cn: false });
    expect(results[0].verdict).toBe("unverifiable");
    expect(searches(calls)).toBe(0);
  });

  it("does not search English references", async () => {
    const calls = serve({ sites: [cqvipHit] });
    await check("Smith J. Urban green space cooling at multiple scales. J Test Geogr, 2021, 41(3): 12-20.");
    expect(searches(calls)).toBe(0);
  });
});

describe("time limits, budget and cancellation", () => {
  it("skips the search when the request deadline is close", async () => {
    const calls = serve({ sites: [cqvipHit] });
    const result = await check(CITED, { left: 5, deadline: Date.now() + 1_000 });
    expect(result.verdict).toBe("unverifiable");
    expect(result.notes.join("")).toContain("时间快用完了");
    expect(searches(calls)).toBe(0);
  });

  it("skips the search when this request's budget is used up", async () => {
    const calls = serve({ sites: [cqvipHit] });
    const result = await check(CITED, { left: 0 });
    expect(result.notes.join("")).toContain("条数已用完");
    expect(searches(calls)).toBe(0);
  });

  it("stops one reference at its time limit and keeps the candidates already found", async () => {
    const saved = CN_LIMITS.itemMs;
    CN_LIMITS.itemMs = 1_000;
    try {
      serve({ sites: [cnkiHit], pages: { [CNKI_URL]: cnkiPage() }, hang: "page" });
      const result = await check(CITED);
      expect(result).toMatchObject({ verdict: "near_match", summary: "在知网找到题名、刊名、年份一致的文章，但没有作者信息，请打开链接核对作者" });
      expect(result.notes.join("")).toContain("中文期刊联网检索没有全部完成（1 秒内没有查完）");
    } finally {
      CN_LIMITS.itemMs = saved;
    }
  });

  it("keeps the previous conclusion when the first search times out", async () => {
    const saved = CN_LIMITS.itemMs;
    CN_LIMITS.itemMs = 1_000;
    try {
      serve({ hang: "search" });
      const result = await check(CITED);
      expect(result).toMatchObject({ verdict: "unverifiable", summary: "开放数据库对中文文献收录有限，未检索到不代表不存在，请到知网 / 万方核查" });
      expect(result.notes.join("")).toContain("没能到知网、万方、维普核对");
    } finally {
      CN_LIMITS.itemMs = saved;
    }
  });

  it("does not turn an unavailable search service into an error", async () => {
    serve({ sites: 429 });
    const result = await check(CITED);
    expect(result.verdict).toBe("unverifiable");
    expect(result.notes.join("")).toContain("DeepSeek 联网搜索请求过于频繁");
  });

  it("stops at once when the check is cancelled", async () => {
    serve({ hang: "search" });
    const controller = new AbortController();
    const pending = check(CITED, { left: 5 }, controller.signal);
    setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 50);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates cancellation from inside the lookup", async () => {
    serve({ sites: [cnkiHit], pages: { [CNKI_URL]: cnkiPage() }, hang: "page" });
    const controller = new AbortController();
    const steps: CheckStep[] = [];
    const pending = lookupChineseJournal(parseReference(CITED, 1), steps, controller.signal, { left: 5 });
    setTimeout(() => controller.abort(new DOMException("cancelled", "AbortError")), 50);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("spaces DeepSeek searches and limits how many run at once", async () => {
    // 用假时钟：全部测试并行、机器繁忙时，真实计时器会差十几毫秒（10-29 量到间隔 89 毫秒）
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const gate = new Gate(2, 100);
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const task = () => gate.run(async () => {
      starts.push(Date.now());
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
    });
    const all = Promise.all([task(), task(), task(), task()]);
    await vi.runAllTimersAsync();
    await all;
    vi.useRealTimers();
    expect(peak).toBeLessThanOrEqual(2);
    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(100);
  });

  it("lets a queued request be cancelled", async () => {
    const gate = new Gate(1, 0);
    let release = () => {};
    const first = gate.run(() => new Promise<void>((r) => { release = r; }));
    const controller = new AbortController();
    const second = gate.run(async () => "ran", controller.signal);
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    release();
    await first;
    await expect(gate.run(async () => "next")).resolves.toBe("next");
  });
});

describe("parsing article pages", () => {
  it("decodes the CNKI page's embedded data and rejects a page for another article", () => {
    expect(parseCnkiArticle(cnkiPage({ author: ["张三,李四"] }), CODE, CNKI_URL).value).toMatchObject({
      site: "知网", title: TITLE, authors: [{ family: "张三" }, { family: "李四" }], venue: "测试地理学报", year: 2021, issue: "3",
    });
    expect(parseCnkiArticle(cnkiPage({ fileName: "OTHER202101001" }), CODE, CNKI_URL)).toEqual({ reason: "页面上的文献编号与链接不一致" });
    expect(parseCnkiArticle(cnkiPage({ author: [] }), CODE, CNKI_URL)).toEqual({ reason: "页面上没有作者信息" });
  });

  it("falls back to the CNKI page title and author links", () => {
    const html = `<html><head><title>${TITLE}-测试地理学报2021年03期-手机知网</title></head><body>
      <a href="//wap.cnki.net/touch/web/Scholar/Index/?code=1&amp;name=张三">张三 </a><a href="//wap.cnki.net/touch/web/Scholar/Index/?code=2&amp;name=李四">李四 </a></body></html>`;
    expect(parseCnkiArticle(html, CODE, CNKI_URL).value).toMatchObject({ title: TITLE, authors: [{ family: "张三" }, { family: "李四" }], venue: "测试地理学报", year: 2021, issue: "3" });
  });

  it("reads the ISSN from the CNKI journal page", () => {
    expect(parseCnkiJournalIssn(journalPage("1000-000X"), "CSDL")).toEqual({ value: "1000-000X" });
    expect(parseCnkiJournalIssn(journalPage(), "OTHER").value).toBeUndefined();
    expect(cnkiJournalCode(CNKI_URL)).toBe("CSDL");
  });

  it("finds the CNKI article code in each CNKI address form", () => {
    expect(cnkiArticleCode(`https://read.cnki.net/web/Journal/Article/${CODE}.html`)).toBe(CODE);
    expect(cnkiArticleCode(`https://kns.cnki.net/kcms/detail/detail.aspx?dbcode=CJFD&filename=${CODE.toLowerCase()}&dbname=CJFDLAST2021`)).toBe(CODE);
    expect(cnkiArticleCode(`https://www.cnki.com.cn/Article/CJFDTOTAL-${CODE}.htm`)).toBe(CODE);
    expect(cnkiArticleCode(`https://xuewen.cnki.net/CJFD-${CODE}.html`)).toBe(CODE);
    expect(cnkiArticleCode("https://wap.cnki.net/touch/web/Dissertation/Article/1015971446.nh.html")).toBeUndefined();
  });

  it("reads Highwire tags, keeps the Chinese authors and drops affiliation marks", () => {
    expect(parseArticleMeta(officialPage(fullMeta))).toMatchObject({
      titles: [TITLE, "Multiscale study of cooling by urban green space"], authors: [{ family: "张三" }, { family: "李四" }],
      venue: "测试地理学报", years: [2021], volume: "41", issue: "3", pages: "12-20", doi: "10.99999/j.csdl.2021.03.002", issn: ["1000-0000"],
    });
  });

  it("reads Dublin Core tags and the DC.source line", () => {
    const meta = parseArticleMeta(officialPage([
      ["dc.title", TITLE], ["dc.creator", "张三"], ["dc.creator", "李四"], ["citation_journal_title", "测试地理学报"],
      ["dc.identifier", "10.99999/j.csdl.2021.03.002"], ["dc.source", "测试地理学报, 2021, Vol. 41,  Issue 3, Pages: 12-20"],
    ]));
    expect(meta).toMatchObject({ authors: [{ family: "张三" }, { family: "李四" }], years: [2021], volume: "41", issue: "3", pages: "12-20", doi: "10.99999/j.csdl.2021.03.002" });
  });

  it("takes year, volume, issue and first page from the platform's article address, and the year from the page's issue line", () => {
    const meta = parseArticleMeta(officialPage([["citation_title", TITLE], ["citation_authors", "张三, 李四"], ["citation_journal_title", "测试地理学报"]]),
      "https://www.csdl-journal.example/CN/Y2021/V41/I3/12");
    expect(meta).toMatchObject({ years: [2021], volume: "41", issue: "3", pages: "12" });
    const page = officialPage([["citation_title", TITLE], ["citation_authors", "张三, 李四"], ["citation_journal_title", "测试地理学报"], ["citation_volume", "41"]])
      .replace("文章页", "测试地理学报 ›› 2021, Vol. 41 ›› Issue (3) : 12-20.");
    expect(parseArticleMeta(page)?.years).toEqual([2021]);
  });

  it("returns nothing for a page without article metadata", () => {
    expect(parseArticleMeta("<html><head><title>首页</title></head><body></body></html>")).toBeUndefined();
  });
});

describe("which references get the Chinese search", () => {
  it("uses the Chinese original in brackets after an English translation", () => {
    const ref = parseReference(`Zhang S, Li S. Multiscale study of cooling by urban green space (in Chinese). Acta Test Geogr, 2021, 41: 12–20 [张三, 李四. ${TITLE}. 测试地理学报, 2021, 41: 12–20]`, 3);
    const view = chineseJournalView(ref);
    expect(view).toMatchObject({ index: 3, titleGuess: TITLE, venueGuess: "测试地理学报", year: 2021 });
  });

  it("skips books, theses and English references", () => {
    expect(chineseJournalView(parseReference("张三. 城市绿地研究[M]. 北京: 测试出版社, 2021.", 1))).toBeUndefined();
    expect(chineseJournalView(parseReference("张三. 城市绿地降温效应研究[D]. 北京: 测试大学, 2021.", 1))).toBeUndefined();
    expect(chineseJournalView(parseReference("Smith J. Urban green space. J Test Geogr, 2021, 41(3): 12-20.", 1))).toBeUndefined();
  });

  it("reads the cited volume and first page for the Crossref lookup", () => {
    expect(citedVolumePage(CITED)).toEqual({ volume: "41", firstPage: "12" });
    expect(citedVolumePage(CITED_VOLUME_PAGES)).toEqual({ volume: "41", firstPage: "412" });
    expect(citedVolumePage(`张三. ${TITLE}[J]. 测试地理学报, 第 41 卷第 3 期, 12-20.`)).toEqual({ volume: "41", firstPage: "12" });
  });
});
