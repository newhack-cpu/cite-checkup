// 对照实验数据集：与“直接问 AI”比较、做消融用。每条带构造出来的真值，不靠事后人工判断。
//   correct    真实正确：从四批盲测里随机抽英文引文（不看本系统的结论，避免只挑查得到的）
//   error      改错一项：取本系统按 DOI 配上的真实文献，把年份 / 第一作者 / 刊名 / DOI 改掉一项（一半去掉 DOI）
//   fabricated 编造（各 15 条）：chimeric 把 A 的题名换成另一篇 B 的真实题名；invented 换成虚构题名（eval/compare/invented-titles.json）
//   zh         中文：真实中文期刊引文 10 条（随机抽）+ 虚构 10 条（eval/compare/invented-zh.json）
// 用法（需要代理时先设 NODE_USE_ENV_PROXY=1）：
//   pnpm exec tsx scripts/build-compare-set.mts --select   抽样并写出待编题名的候选（invented-candidates.json）
//   pnpm exec tsx scripts/build-compare-set.mts            生成 eval/compare/compare-2026-10-18.json，并核查虚构条目查不到
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseReference } from "../src/lib/verify/extract";
import { recordYears, venueSimilarity } from "../src/lib/verify/match";
import { cjkRatio, dice } from "../src/lib/verify/normalize";
import { crossrefByDoi, crossrefFieldSearch } from "../src/lib/verify/sources/crossref";
import { cnJournalSearch, deepseekSearch, sameTitle } from "../src/lib/verify/sources/cnweb";
import { doiRegistry } from "../src/lib/verify/sources/doi";
import type { WorkRecord } from "../src/lib/verify/types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 虚构条目的联网核查需要 DEEPSEEK_API_KEY
}

const SETS = ["blind-2026-10-16", "blind-2026-10-16b", "blind-2026-10-17", "blind-2026-10-17b"];
const DIR = "eval/compare";
const OUT = `${DIR}/compare-2026-10-18.json`;
const select = process.argv.includes("--select");

interface Case { id: string; raw: string; label: { lang: "zh" | "en" } }
interface Row { id: string; verdict: string; match?: { doi?: string; source?: string } }
type Key = string; // `${set}:${id}`

// 固定种子的伪随机数（mulberry32），保证每次抽到同一批
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261018);
const shuffle = <T,>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const cases = new Map<Key, Case & { set: string }>();
const rows = new Map<Key, Row>();
const excluded = new Set<Key>();
for (const set of SETS) {
  for (const c of (JSON.parse(readFileSync(`eval/real-world/${set}.json`, "utf8")) as { cases: Case[] }).cases) cases.set(`${set}:${c.id}`, { ...c, set });
  for (const r of (JSON.parse(readFileSync(`eval/results/real-${set}-rules.json`, "utf8")) as { results: Row[] }).results) rows.set(`${set}:${r.id}`, r);
  // 复核为真实错误或无法确认的条目不算“真实正确”
  const adj = JSON.parse(readFileSync(`eval/results/real-${set}-adjudication.json`, "utf8")) as { items: { id: string; judgment: string }[] };
  for (const it of adj.items) if (it.judgment !== "false_alarm") excluded.add(`${set}:${it.id}`);
}

const DOI_RE = /\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi\s*[:：]?\s*)?10\.\d{4,9}\/[^\s,;]+/gi;
const stripDoi = (raw: string) => raw.replace(DOI_RE, "").replace(/\s+([.,;])/g, "$1").replace(/[.,;]\s*[.,;]+/g, ".").replace(/\s{2,}/g, " ").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const english = shuffle([...cases.entries()].filter(([, c]) => c.label.lang === "en"));
const chinese = shuffle([...cases.entries()].filter(([, c]) => c.label.lang === "zh"));

// 1. 真实正确：随机抽，不看本系统结论
const correct = english.filter(([key]) => !excluded.has(key)).slice(0, 40);
const used = new Set<Key>(correct.map(([key]) => key));

// 2. 可改写的真实文献：本系统按 DOI 配上 Crossref 记录、且元数据齐全的期刊论文
interface PoolItem { key: Key; raw: string; rec: WorkRecord; title?: string; venue?: string }
const pool: PoolItem[] = [];
for (const [key, c] of english) {
  if (used.has(key) || excluded.has(key) || pool.length >= 110) continue;
  const row = rows.get(key);
  if (row?.verdict !== "verified" || !row.match?.doi || row.match.source !== "crossref") continue;
  const { record: rec } = await crossrefByDoi(row.match.doi);
  if (!rec || !rec.authors.length || !rec.authors[0].family || !rec.venue || !rec.year || rec.type !== "journal-article") continue;
  const ref = parseReference(c.raw, 1);
  // 引文里的题名、刊名要能在原文里原样找到，才能替换
  const title = ref.titleGuess && c.raw.includes(ref.titleGuess) && dice(ref.titleGuess, rec.title) >= 0.8 ? ref.titleGuess : undefined;
  const venue = ref.venueGuess && c.raw.includes(ref.venueGuess) && venueSimilarity(ref.venueGuess, rec.venue, rec.venueShort) >= 0.6 ? ref.venueGuess : undefined;
  pool.push({ key, raw: c.raw, rec, title, venue });
}
console.log(`真实正确 ${correct.length} 条；可改写的真实文献 ${pool.length} 条（能定位题名 ${pool.filter((p) => p.title).length}、刊名 ${pool.filter((p) => p.venue).length}）`);

const take = (n: number, ok: (p: PoolItem) => boolean) => {
  const picked: PoolItem[] = [];
  for (const p of pool) {
    if (picked.length >= n) break;
    if (!used.has(p.key) && ok(p)) { picked.push(p); used.add(p.key); }
  }
  if (picked.length < n) throw new Error(`可用条目不够：需要 ${n}，只有 ${picked.length}`);
  return picked;
};
const hasDoi = (p: PoolItem) => p.raw.toLowerCase().includes(p.rec.doi!.toLowerCase());
// 能定位题名的条目最少，先分给编造类
const forChimeric = take(15, (p) => !!p.title);
const forInvented = take(15, (p) => !!p.title);
const forVenue = take(10, (p) => !!p.venue);
const forDoi = take(10, hasDoi);
const forAuthor = take(10, (p) => new RegExp(`\\b${escape(p.rec.authors[0].family!)}\\b`, "i").test(p.raw));
const forYear = take(10, (p) => new RegExp(`(?<![\\d./])${p.rec.year}(?![\\d])`).test(stripDoi(p.raw)));

if (select) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/invented-candidates.json`, JSON.stringify(forInvented.map((p) => ({ key: p.key, venue: p.rec.venue, title: p.rec.title, year: p.rec.year })), null, 1));
  // 只取中文书写的期刊引文（英文转写的“(in Chinese)”另算一类）
  const zhReal = chinese.filter(([, c]) => parseReference(c.raw, 1).kind === "journal" && cjkRatio(c.raw) > 0.3).slice(0, 10);
  writeFileSync(`${DIR}/zh-real-candidates.json`, JSON.stringify(zhReal.map(([key, c]) => ({ key, raw: c.raw })), null, 1));
  console.log(`已写出 ${DIR}/invented-candidates.json（15 条）和 zh-real-candidates.json（10 条），请编好 invented-titles.json、invented-zh.json 后再运行`);
  process.exit(0);
}

const SURNAMES = ["Peterson", "Lindqvist", "Moreau", "Okafor", "Castellano", "Hoffmann", "Nakamura", "Barros", "Kowalski", "Fitzgerald", "Delgado", "Sorensen", "Haddad", "Whitaker", "Brennan"];
interface Item {
  id: string; raw: string; lang: "en" | "zh";
  truth: "correct" | "error" | "fabricated";
  kind: string;
  field?: "year" | "author" | "venue" | "doi";
  doiInRaw?: boolean;
  /** 真实文献的数据库记录（correct 类没有：随机抽的引文不一定查得到） */
  record?: { doi?: string; title: string; firstAuthor?: string; year?: number; venue?: string };
  change?: { from: string; to: string; note?: string };
  source: Key;
  check?: unknown;
}
const items: Item[] = [];
const recOf = (rec: WorkRecord) => ({ doi: rec.doi, title: rec.title, firstAuthor: rec.authors[0]?.family, year: rec.year, venue: rec.venue });

correct.forEach(([key, c], i) => items.push({ id: `C${String(i + 1).padStart(2, "0")}`, raw: c.raw, lang: "en", truth: "correct", kind: "real", source: key }));

// 改 DOI：把后缀最后一个数字加一（没有数字就改最后一个字母），记录改后的 DOI 是未注册还是指向别的文献
for (const [i, p] of forDoi.entries()) {
  const doi = p.rec.doi!;
  const at = doi.search(/\d(?=\D*$)/);
  const wrong = at >= 0 ? doi.slice(0, at) + ((Number(doi[at]) + 1) % 10) + doi.slice(at + 1) : doi.slice(0, -1) + (doi.at(-1) === "a" ? "b" : "a");
  const reg = await doiRegistry(wrong);
  const other = reg.exists ? (await crossrefByDoi(wrong)).record : undefined;
  const raw = p.raw.replace(new RegExp(escape(doi), "i"), wrong);
  items.push({
    id: `E-D${String(i + 1).padStart(2, "0")}`, raw, lang: "en", truth: "error", kind: "error", field: "doi", doiInRaw: true, record: recOf(p.rec), source: p.key,
    change: { from: doi, to: wrong, note: reg.exists === false ? "改后的 DOI 未注册" : reg.exists ? `改后的 DOI 指向《${other?.title ?? "未知"}》` : "注册状态不明" },
  });
}
// 改刊名：换成池里另一篇文献的刊名
const venues = [...new Set(pool.map((p) => p.rec.venue!))];
for (const [i, p] of forVenue.entries()) {
  // 每条换一本不同的刊（按序号轮换），和原刊名不像
  const options = venues.filter((v) => venueSimilarity(v, p.rec.venue!, p.rec.venueShort) < 0.3 && !p.raw.includes(v));
  const to = options[(i * 7) % options.length];
  const keep = i % 2 === 0 && hasDoi(p);
  const raw = (keep ? p.raw : stripDoi(p.raw)).replace(p.venue!, to);
  items.push({ id: `E-V${String(i + 1).padStart(2, "0")}`, raw, lang: "en", truth: "error", kind: "error", field: "venue", doiInRaw: keep, record: recOf(p.rec), source: p.key, change: { from: p.venue!, to } });
}
// 改第一作者的姓
for (const [i, p] of forAuthor.entries()) {
  const family = p.rec.authors[0].family!;
  const names = new Set(p.rec.authors.map((a) => (a.family ?? "").toLowerCase()));
  const to = SURNAMES.find((s, k) => k >= i % SURNAMES.length && !names.has(s.toLowerCase())) ?? SURNAMES.find((s) => !names.has(s.toLowerCase()))!;
  const keep = i % 2 === 0 && hasDoi(p);
  const raw = (keep ? p.raw : stripDoi(p.raw)).replace(new RegExp(`\\b${escape(family)}\\b`, "i"), to);
  items.push({ id: `E-A${String(i + 1).padStart(2, "0")}`, raw, lang: "en", truth: "error", kind: "error", field: "author", doiInRaw: keep, record: recOf(p.rec), source: p.key, change: { from: family, to } });
}
// 改年份：差 3 年以上，且不是该文献在线首发、纸本等其他年份
for (const [i, p] of forYear.entries()) {
  const years = recordYears(p.rec);
  let to = p.rec.year! - 3;
  while (years.some((y) => Math.abs(y - to) <= 1)) to--;
  const keep = i % 2 === 0 && hasDoi(p);
  const base = keep ? p.raw : stripDoi(p.raw);
  // 不动 DOI、网址里的数字
  const protectedParts: string[] = [];
  const masked = base.replace(/(?:https?:\/\/\S+|10\.\d{4,9}\/[^\s,;]+)/gi, (m) => `\u0000${protectedParts.push(m) - 1}\u0000`);
  const raw = masked.replace(new RegExp(`(?<![\\d./])${p.rec.year}(?![\\d])`, "g"), String(to)).replace(/\u0000(\d+)\u0000/g, (_, n) => protectedParts[Number(n)]);
  items.push({ id: `E-Y${String(i + 1).padStart(2, "0")}`, raw, lang: "en", truth: "error", kind: "error", field: "year", doiInRaw: keep, record: recOf(p.rec), source: p.key, change: { from: String(p.rec.year), to: String(to) } });
}

// 编造（拼接）：A 的作者、刊名、年份 + B 的真实题名，去掉 DOI
const titleCheck = async (title: string) => {
  const { records } = await crossrefFieldSearch({ bibliographic: title }, 5);
  return Math.max(0, ...records.map((r) => dice(r.title, title)));
};
for (const [i, a] of forChimeric.entries()) {
  const b = forChimeric[(i + 7) % forChimeric.length];
  const raw = stripDoi(a.raw).replace(a.title!, b.rec.title);
  items.push({
    id: `F-C${String(i + 1).padStart(2, "0")}`, raw, lang: "en", truth: "fabricated", kind: "chimeric", source: a.key,
    change: { from: a.title!, to: b.rec.title, note: `题名来自 ${b.rec.doi}（作者 ${b.rec.authors[0]?.family}），作者、刊名、年份来自 ${a.rec.doi}` },
  });
}

// 编造（全编）：A 的作者、刊名、年份 + 虚构题名，去掉 DOI；核查 Crossref 和网页搜索都查不到同名文献
const invented = JSON.parse(readFileSync(`${DIR}/invented-titles.json`, "utf8")) as Record<Key, string>;
for (const [i, a] of forInvented.entries()) {
  const title = invented[a.key];
  if (!title) throw new Error(`invented-titles.json 缺少 ${a.key}`);
  const crossrefBest = await titleCheck(title);
  const web = await deepseekSearch(`"${title}"`, 5);
  const webBest = Math.max(0, ...web.map((h) => dice(h.title, title)));
  items.push({
    id: `F-I${String(i + 1).padStart(2, "0")}`, raw: stripDoi(a.raw).replace(a.title!, title), lang: "en", truth: "fabricated", kind: "invented", source: a.key,
    change: { from: a.title!, to: title }, check: { crossrefBestTitleDice: +crossrefBest.toFixed(2), webBestTitleDice: +webBest.toFixed(2) },
  });
}

// 中文：真实 10 条 + 虚构 10 条（虚构的用知网、万方、维普联网检索核查查不到）
const zhReal = JSON.parse(readFileSync(`${DIR}/zh-real-candidates.json`, "utf8")) as { key: Key; raw: string }[];
zhReal.forEach((c, i) => items.push({ id: `Z-R${String(i + 1).padStart(2, "0")}`, raw: c.raw, lang: "zh", truth: "correct", kind: "real", source: c.key }));
const zhFake = JSON.parse(readFileSync(`${DIR}/invented-zh.json`, "utf8")) as { raw: string; title: string }[];
for (const [i, f] of zhFake.entries()) {
  const { records } = await cnJournalSearch(f.title);
  items.push({
    id: `Z-F${String(i + 1).padStart(2, "0")}`, raw: f.raw, lang: "zh", truth: "fabricated", kind: "invented", source: "invented",
    check: { cnSameTitle: records.filter((r) => sameTitle(r.title, f.title)).map((r) => `${r.site} ${r.url}`) },
  });
}

const suspicious = items.filter((it) => {
  const c = it.check as { crossrefBestTitleDice?: number; webBestTitleDice?: number; cnSameTitle?: string[] } | undefined;
  return (c?.crossrefBestTitleDice ?? 0) >= 0.8 || (c?.webBestTitleDice ?? 0) >= 0.8 || (c?.cnSameTitle?.length ?? 0) > 0;
});
if (suspicious.length) console.log("这些虚构条目查到了相近的真实文献，需要换题名：", suspicious.map((it) => it.id).join(", "));
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({
  name: "compare-2026-10-18",
  builtAt: new Date().toISOString(),
  note: "对照实验用的构造数据集：correct 为真实引文；error 为真实文献改错一项；fabricated 为拼接或虚构（虚构内容只用于评测，不是真实文献）",
  counts: Object.fromEntries(["correct", "error", "fabricated"].map((t) => [t, items.filter((it) => it.truth === t).length])),
  items,
}, null, 1));
console.log(`已写出 ${OUT}：${items.length} 条`);
