// 场景测试一的查证材料补充：登记在知网（CNKI）的 DOI 没有可读的元数据，改到中国 DOI 注册机构 chndoi.org 的解析页
// 读出这个 DOI 登记的题名、作者和注册时间，写回 evidence-*.json 的 evidence.chndoi。只读公开页面。
// 用法：pnpm exec tsx scripts/scenario-chndoi.mts [eval/scenario-2026-10-23]

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "eval/scenario-2026-10-23";
const text = (html: string, label: string) => html.match(new RegExp(`<label>${label}[：:]</label>([^<]*)`))?.[1]?.trim() || undefined;

for (const file of readdirSync(dir).filter((f) => /^evidence-\w+\.json$/.test(f))) {
  const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as { entries: { id: string; doi?: string; evidence: Record<string, unknown> }[] };
  for (const entry of data.entries) {
    if (!entry.doi || entry.evidence.doiRegistry !== "CNKI") continue;
    const url = `https://www.chndoi.org/Resolution/Handler?doi=${encodeURIComponent(entry.doi)}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "cite-checkup-scenario/0.1" }, signal: AbortSignal.timeout(30_000) });
      const html = await res.text();
      entry.evidence.chndoi = {
        url, status: res.status, title: text(html, "题名"),
        authors: text(html, "作者")?.split(/[;；]/).filter(Boolean), source: text(html, "来源"), registered: text(html, "注册时间"),
      };
    } catch (error) {
      entry.evidence.chndoi = { url, error: String((error as Error).message) };
    }
    console.log(entry.id, JSON.stringify(entry.evidence.chndoi));
  }
  writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + "\n");
}
