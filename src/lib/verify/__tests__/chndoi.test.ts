// 知网（CNKI）登记的 DOI：读中国 DOI 注册机构的解析页，判断 DOI 登记的是不是引文这一篇。
// 样例取自 2026-10-23 场景测试（eval/scenario-2026-10-23/）：大模型给中文文献配了同刊另一篇论文的 DOI。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReference } from "../extract";
import { parseChndoi } from "../sources/cnpage";

// 解析页走 cnpage 的取页逻辑，会先解析域名、确认是公网地址；测试里固定成文档保留的公网地址，不联网
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));

/** 解析页的结构照 2026-10-23 实际页面：“来源”“出版年”是空的 */
function chndoiPage(doi: string, title: string, authors: string[]): string {
  return `<!DOCTYPE html><html><body><div class="feedbackresult"><div class="fbHd">多重解析地址选择页面</div><div class="fbBd"><table>
    <tr><td><label>题名：</label>${title}</td></tr>
    <tr><td><label>作者：</label>${authors.join(";")};</td></tr>
    <tr><td><label>来源：</label></td></tr>
    <tr><td><label>出版机构：</label>同方知网（北京）技术有限公司</td></tr>
    <tr><td><label>出版年:</label></td></tr>
    <tr><td><label>DOI码：</label>${doi}</td></tr>
    <tr><td><label>注册时间：</label>2018-04-26 15:15:24</td></tr>
  </table></div></div></body></html>`;
}

const html = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

type Route = [RegExp, () => Response];
function serve(routes: Route[]) {
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    const path = url.hostname + decodeURIComponent(url.pathname);
    const route = routes.find(([re]) => re.test(path));
    if (!route) throw new Error(`Unexpected request: ${path}`);
    return route[1]();
  });
}

/** 知网登记、doi.org 内容协商取不到元数据的 DOI */
function cnkiDoi(doi: string, registered: { title: string; authors: string[] }, search: unknown[] = []): Route[] {
  return [
    [/^api\.crossref\.org\/works\/10\./, () => new Response("Resource not found.", { status: 404 })],
    [/^doi\.org\/ra\//, () => Response.json([{ DOI: doi, RA: "CNKI" }])],
    [/^doi\.org\/10\./, () => html("<html>CNKI</html>")],
    [/^www\.chndoi\.org\/Resolution\/Handler$/, () => html(chndoiPage(doi, registered.title, registered.authors))],
    [/^api\.crossref\.org\/works$/, () => Response.json({ message: { items: search } })],
    [/^api\.openalex\.org\/works\//, () => new Response("Not Found", { status: 404 })],
  ];
}

async function verify(raw: string) {
  const { verifyReference } = await import("../verify");
  return verifyReference(parseReference(raw, 1), { openalexBudget: { left: 5 } });
}

beforeAll(async () => { await import("../verify"); }, 30_000);
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("chndoi.org resolution page", () => {
  it("reads the registered title and authors", () => {
    const doi = "10.16383/j.aas.2018.c170153";
    const page = chndoiPage(doi, "医学图像分析深度学习方法研究与挑战", ["田娟秀", "刘国才", "谷珊珊", "鞠忠建", "刘劲光", "顾冬冬"]);
    const { value } = parseChndoi(page, doi, "https://www.chndoi.org/Resolution/Handler?doi=x");
    expect(value?.title).toBe("医学图像分析深度学习方法研究与挑战");
    expect(value?.authors.map((a) => a.family)).toEqual(["田娟秀", "刘国才", "谷珊珊", "鞠忠建", "刘劲光", "顾冬冬"]);
    expect(value?.doi).toBe(doi);
    expect(value?.year).toBeUndefined();
    expect(value?.venue).toBeUndefined();
  });

  it("ignores a page registered for a different DOI or without a title", () => {
    const page = chndoiPage("10.16383/j.aas.2018.c170154", "另一篇", ["张三"]);
    expect(parseChndoi(page, "10.16383/j.aas.2018.c170153", "").value).toBeUndefined();
    expect(parseChndoi("<html>CNKI</html>", "10.16383/j.aas.2018.c170153", "").value).toBeUndefined();
  });
});

describe("CNKI DOIs checked against the registered title", () => {
  it("flags a DOI registered for another paper when the cited paper cannot be found (edu-05)", async () => {
    const doi = "10.16187/j.cnki.issn1001-4918.2020.06.08";
    serve(cnkiDoi(doi, { title: "高中生感知教师支持与学习投入的关系:学业自我效能感和成就目标定向的链式中介作用", authors: ["贾绪计", "蔡林", "林琳", "林崇德"] }));
    const result = await verify(`罗杰, 周瑗, 陈维, 等. 大学生学业倦怠与学习投入的关系: 一个有调节的中介模型[J]. 心理发展与教育, 2020, 36(6): 707-715. DOI: ${doi}.`);
    expect(result.verdict).toBe("not_found");
    expect(result.summary).toBe("DOI 指向的是另一篇文献，引用内容疑似编造");
    expect(result.issues[0]).toContain("高中生感知教师支持与学习投入的关系");
    expect(result.steps.find((s) => s.action === "doi_chndoi")).toMatchObject({ ok: true });
  });

  it("reports the wrong DOI when the cited paper itself is found (edu-03)", async () => {
    const doi = "10.16128/j.cnki.1005-3611.2010.02.011";
    serve(cnkiDoi(doi, { title: "三等位基因5-HTTLPR与青少年重性抑郁障碍的关联研究", authors: ["马静", "苏林雁", "禹顺英"] }, [{
      DOI: "10.16128/j.cnki.1005-3611.2010.02.004", title: ["青少年学习倦怠量表的编制"],
      author: [{ family: "吴艳" }, { family: "戴晓阳" }, { family: "温忠麟" }, { family: "崔汉卿" }],
      issued: { "date-parts": [[2010]] }, "container-title": ["中国临床心理学杂志"], volume: "18", issue: "2", page: "152-154",
    }]));
    const result = await verify(`吴艳, 戴晓阳, 温忠麟, 等. 青少年学习倦怠量表的编制[J]. 中国临床心理学杂志, 2010, 18(2): 152-154. DOI: ${doi}.`);
    expect(result.verdict).toBe("mismatch");
    expect(result.issues.join("")).toContain("引用中的 DOI 指向另一篇文献《三等位基因5-HTTLPR与青少年重性抑郁障碍的关联研究》，正确 DOI 应为 10.16128/j.cnki.1005-3611.2010.02.004");
  });

  it("says the registration matches but keeps year, journal and pages for manual checking (med-01)", async () => {
    const doi = "10.16383/j.aas.2018.c170153";
    serve(cnkiDoi(doi, { title: "医学图像分析深度学习方法研究与挑战", authors: ["田娟秀", "刘国才", "谷珊珊", "鞠忠建", "刘劲光", "顾冬冬"] }));
    const result = await verify(`田娟秀, 刘国才, 谷珊珊, 等. 医学图像分析深度学习方法研究与挑战[J]. 自动化学报, 2018, 44(3): 401-424. DOI: ${doi}.`);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toBe("DOI 登记的题名、作者与引文一致；年份、期刊、卷期页没有可比对的记录，请人工核对");
    expect(result.suggestion).toBeUndefined();
  });

  it("does not compare a Chinese registered title with an English citation (D010)", async () => {
    const doi = "10.16581/j.cnki.issn1671-3206.2019.02.014";
    serve(cnkiDoi(doi, { title: "红芪总多糖的微波提取及抗氧化活性研究", authors: ["袁静", "王燕", "黄勇"] }));
    const result = await verify(`Yuan J, Wang Y, Huang Y, Study on microwave extraction and antioxidant activity of total polysaccharides from Radix Hedysari, applied Chemistry 48 (02) (2019) 373–375+379. doi: ${doi}.`);
    expect(result.verdict).toBe("unverifiable");
    expect(result.summary).toBe("DOI 已注册，但注册机构不提供可比对的元数据，请人工核对");
  });
});
