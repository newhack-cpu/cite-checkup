// 导出 BibTeX：只导出数据库确认是同一篇的条目，字段全部取自数据库记录（和规范参考文献同一套规则），
// 没确认的条目不导出，只在文件开头的注释里列出序号和原因，不替用户猜。导入 Zotero、EndNote、JabRef 或 LaTeX 用。
import { localDate } from "./report-html";
import { rewritableRecord } from "./report";
import type { Author, ParsedRef, RefResult, WorkRecord } from "./verify/types";

const isCjk = (s: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s);

/** BibTeX 的特殊字符：& % $ # _ 加反斜杠，花括号去掉（数据库题名里的花括号多是排版残留），换行压成空格 */
function escape(s: string): string {
  return s.replace(/[{}]/g, "").replace(/([&%$#_])/g, "\\$1").replace(/\s+/g, " ").trim();
}

/** 作者：西文写成“姓, 名”；中文姓名、只有一个名字的机构作者整体加花括号，避免被拆成姓和名 */
function author(a: Author): string {
  if (isCjk(a.family) || !a.given) return `{${escape(a.family + (a.given && isCjk(a.family) ? a.given : ""))}}`;
  return `${escape(a.family)}, ${escape(a.given)}`;
}

function entryType(rec: WorkRecord): { type: string; venueField: string } {
  switch (rec.type) {
    case "proceedings-article":
    case "paper-conference":
    case "conference-paper":
      return { type: "inproceedings", venueField: "booktitle" };
    case "book":
    case "monograph":
    case "edited-book":
      return { type: "book", venueField: "publisher" };
    case "book-chapter":
      return { type: "incollection", venueField: "booktitle" };
    case "dissertation":
      return { type: "phdthesis", venueField: "school" };
    case "posted-content":
    case "preprint":
      return { type: "misc", venueField: "howpublished" };
    default:
      return { type: "article", venueField: "journal" };
  }
}

/** 引用键：第一作者的西文姓 + 年份（如 lecun2015），中文作者或没有作者时用 ref + 原序号；重复时加 a、b、c */
function citeKey(rec: WorkRecord, index: number, used: Set<string>): string {
  const family = rec.authors[0]?.family ?? "";
  const ascii = isCjk(family) ? "" : family.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  const base = `${ascii || `ref${index}`}${rec.year ?? ""}`;
  let key = base;
  for (let i = 0; used.has(key); i++) key = base + String.fromCharCode(97 + i);
  used.add(key);
  return key;
}

function entry(rec: WorkRecord, key: string, note?: string): string {
  const { type, venueField } = entryType(rec);
  const title = rec.subtitle ? `${rec.title}: ${rec.subtitle}` : rec.title;
  const fields: [string, string | undefined][] = [
    ["author", rec.authors.length ? rec.authors.map(author).join(" and ") : undefined],
    ["title", escape(title)],
    [venueField, rec.venue ? escape(rec.venue) : undefined],
    ["year", rec.year ? String(rec.year) : undefined],
    ["volume", rec.volume ? escape(rec.volume) : undefined],
    ["number", rec.issue ? escape(rec.issue) : undefined],
    ["pages", rec.pages ? escape(rec.pages).replace(/\s*[-–—]+\s*/g, "--") : undefined],
    ["doi", rec.doi],
    ["url", !rec.doi && rec.url ? rec.url : undefined],
    ["note", note],
  ];
  const body = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

export interface BibtexExport {
  text: string;
  exported: number;
  /** 没导出的条目序号 */
  skipped: number[];
}

export function buildBibtex(refs: ParsedRef[], results: Map<number, RefResult>, date = localDate()): BibtexExport {
  const used = new Set<string>();
  const entries: string[] = [];
  const skipped: number[] = [];
  for (const ref of refs) {
    const r = results.get(ref.index);
    const rec = rewritableRecord(r);
    if (!r || !rec) {
      skipped.push(ref.index);
      continue;
    }
    const note = r.verdict === "retracted" ? "已撤稿 / 撤回" : r.verdict === "concern" ? "期刊发布关注声明" : undefined;
    entries.push(entry(rec, citeKey(rec, ref.index, used), note));
  }
  const header = [
    `% 引用体检导出（${date}）：只含数据库确认是同一篇的 ${entries.length} 条，字段取自数据库记录。`,
    skipped.length ? `% 没有导出 ${skipped.length} 条（第 ${skipped.join("、")} 条）：相近候选、查不到、待人工或数据库记录不全，请人工核对后自行补充。` : undefined,
  ].filter(Boolean).join("\n");
  return { text: `${header}\n\n${entries.join("\n\n")}\n`, exported: entries.length, skipped };
}
