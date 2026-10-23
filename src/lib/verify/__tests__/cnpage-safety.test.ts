import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPageCache, fetchJournalArticle, privateAddress, unsafeTarget } from "../sources/cnpage";

// internal.example 解析到内网地址，其余域名解析到文档用的公网地址；测试不联网
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [{ address: host.startsWith("internal.") ? "10.0.0.5" : "203.0.113.10", family: 4 }]),
}));

const ARTICLE = `<html><head>
<meta name="citation_title" content="城市绿地降温效应的多尺度研究">
<meta name="citation_author" content="张三"><meta name="citation_author" content="李四">
<meta name="citation_journal_title" content="测试地理学报"><meta name="citation_date" content="2021-03-15">
<meta name="citation_volume" content="41"><meta name="citation_issue" content="3">
</head><body></body></html>`;

beforeEach(() => clearPageCache());
afterEach(() => vi.unstubAllGlobals());

describe("pages are only requested from public addresses", () => {
  it.each([
    ["127.0.0.1", true], ["10.1.2.3", true], ["172.20.0.1", true], ["192.168.1.1", true], ["169.254.169.254", true],
    ["100.64.0.1", true], ["0.0.0.0", true], ["224.0.0.1", true], ["::1", true], ["fd00::1", true], ["fe80::1", true],
    ["::ffff:127.0.0.1", true], ["203.0.113.10", false], ["121.194.4.151", false], ["2001:db8::1", false],
  ])("treats %s as private: %s", (ip, expected) => {
    expect(privateAddress(ip)).toBe(expected);
  });

  it("rejects non-web schemes, credentials, unusual ports and internal hosts", async () => {
    expect(await unsafeTarget(new URL("ftp://journal.example/a"))).toContain("协议");
    expect(await unsafeTarget(new URL("https://user:pw@journal.example/a"))).toContain("账号");
    expect(await unsafeTarget(new URL("https://journal.example:8443/a"))).toContain("端口");
    expect(await unsafeTarget(new URL("http://169.254.169.254/latest/meta-data"))).toContain("内网");
    expect(await unsafeTarget(new URL("https://internal.example/a"))).toContain("内网");
    expect(await unsafeTarget(new URL("https://journal.example/CN/abc"))).toBeUndefined();
  });

  it("does not follow a redirect from a journal page to an internal address", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      requested.push(input);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    });
    const result = await fetchJournalArticle("https://journal.example/CN/abc", true);
    expect(result.value).toBeUndefined();
    expect(result.reason).toContain("内网");
    expect(requested).toEqual(["https://journal.example/CN/abc"]);
  });

  it("follows an ordinary redirect between public pages and reads the article", async () => {
    vi.stubGlobal("fetch", async (input: string) => input.endsWith("/old")
      ? new Response(null, { status: 301, headers: { location: "/CN/abc" } })
      : new Response(ARTICLE, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    const result = await fetchJournalArticle("https://journal.example/old", true);
    expect(result.value?.title).toBe("城市绿地降温效应的多尺度研究");
    expect(result.value?.url).toBe("https://journal.example/CN/abc");
  });
});
