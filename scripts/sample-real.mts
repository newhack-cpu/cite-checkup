// 从 Crossref 抽一批新的真实参考文献评测集：按出版社随机抽 2023 年后发表、带参考文献列表的论文，
// 每篇随机取几条 unstructured 原文。所有条目都出自已发表论文，视为真实存在。
// 用法：pnpm sample:real --out=eval/real-world/blind-xxxx.json [--per-group=12] [--seed=1]
// 已有集合（eval/real-world/*.json）用过的源论文会被排除，保证新集合来自不同论文。
// 抽样只统计条数、不打印条目内容：盲测集在规则定稿前不应被查看。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 也能抽样
}

const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const out = option("out");
if (!out) throw new Error("请用 --out= 指定输出文件，例如 eval/real-world/blind-2026-10-15.json");
if (existsSync(out)) throw new Error(`${out} 已存在，不覆盖`);
const perGroup = Number(option("per-group") ?? 12);
let seed = Number(option("seed") ?? 1);
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

interface Group { name: string; filter: string; lang: "en" | "zh" }
// 与 dev / test 的出版社组合不同，换进 IEEE、SAGE、IOP、Cambridge 等，检验规则是否只对旧出版社有效
const GROUPS: Group[] = [
  { name: "Elsevier", filter: "member:78", lang: "en" },
  { name: "Springer Nature", filter: "member:297", lang: "en" },
  { name: "Wiley", filter: "member:311", lang: "en" },
  { name: "IEEE", filter: "member:263", lang: "en" },
  { name: "SAGE", filter: "member:179", lang: "en" },
  { name: "IOP Publishing", filter: "member:266", lang: "en" },
  { name: "Cambridge University Press", filter: "member:56", lang: "en" },
  { name: "MDPI", filter: "member:1968", lang: "en" },
  { name: "PLOS", filter: "member:340", lang: "en" },
  { name: "中国科学（中文参考文献）", filter: "prefix:10.1360", lang: "zh" },
  { name: "科学出版社 10.3724（中文参考文献）", filter: "prefix:10.3724", lang: "zh" },
];

const mailto = process.env.CROSSREF_MAILTO?.trim();
const headers = { "User-Agent": `cite-checkup-eval/1.0${mailto ? ` (mailto:${mailto})` : ""}` };

const used = new Set<string>();
for (const file of readdirSync("eval/real-world").filter((f) => f.endsWith(".json"))) {
  const { cases } = JSON.parse(readFileSync(join("eval/real-world", file), "utf8")) as { cases: { sourcePaper?: string }[] };
  for (const c of cases) if (c.sourcePaper) used.add(c.sourcePaper.toLowerCase());
}

interface Reference { unstructured?: string; DOI?: string }
interface Work { DOI: string; reference?: Reference[] }

async function sample(group: Group): Promise<Work[]> {
  const params = new URLSearchParams({
    filter: `${group.filter},has-references:true,from-pub-date:2023-01-01,type:journal-article`,
    sample: "40",
    select: "DOI,reference",
  });
  if (mailto) params.set("mailto", mailto);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.crossref.org/works?${params}`, { headers, signal: AbortSignal.timeout(60_000) });
    if (res.ok) return ((await res.json()) as { message: { items: Work[] } }).message.items;
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error(`${group.name}：Crossref 抽样失败`);
}

const HAN = /\p{Script=Han}{4,}/u;
const cases: { id: string; group: string; sourcePaper: string; raw: string; assertedDoi: string | null; label: { lang: "en" | "zh" } }[] = [];
for (const group of GROUPS) {
  const works = (await sample(group)).filter((w) => !used.has(w.DOI.toLowerCase()));
  const picked: typeof cases = [];
  for (const work of works) {
    if (picked.length >= perGroup) break;
    // 中文组只取中文参考文献，英文组只取不含汉字的；太短的（只有网址或编号）跳过
    const refs = (work.reference ?? []).filter((r) => typeof r.unstructured === "string" && r.unstructured.trim().length >= 25
      && (group.lang === "zh" ? HAN.test(r.unstructured) : !/\p{Script=Han}/u.test(r.unstructured)));
    // 每篇最多 2 条，免得一篇论文的引用格式占满一组
    for (let k = 0; k < 2 && refs.length && picked.length < perGroup; k++) {
      const [ref] = refs.splice(Math.floor(random() * refs.length), 1);
      picked.push({ id: "", group: group.name, sourcePaper: work.DOI, raw: ref.unstructured!.replace(/\s+/g, " ").trim(), assertedDoi: ref.DOI ?? null, label: { lang: group.lang } });
    }
    used.add(work.DOI.toLowerCase());
  }
  cases.push(...picked);
  console.log(`${group.name}：${picked.length} 条，来自 ${new Set(picked.map((c) => c.sourcePaper)).size} 篇论文`);
}
cases.forEach((c, i) => (c.id = `B${String(i + 1).padStart(3, "0")}`));
const name = out.split(/[\\/]/).pop()!.replace(/\.json$/, "");
writeFileSync(out, JSON.stringify({
  name,
  description: "盲测集：与 dev、test 来自不同论文和不同的出版社组合；抽样后、规则定稿前不查看条目，只运行一次",
  createdAt: new Date().toISOString(),
  method: "Crossref /works?filter=member 或 prefix,has-references:true,from-pub-date:2023-01-01,type:journal-article&sample=40，按出版社各抽若干篇已发表论文（排除已有集合用过的源论文），每篇随机取至多 2 条 unstructured 原文。所有条目都出自已发表论文，视为真实存在的文献。",
  cases,
}, null, 1));
console.log(`共 ${cases.length} 条，写入 ${out}`);
