// 用数据库记录生成规范引文。只做格式化，不补造任何数据库里没有的信息。

import { compact, isCjk } from "./normalize";
import type { Author, WorkRecord } from "./types";

function isCjkName(a: Author): boolean {
  return isCjk(a.family[0]);
}

function initials(given: string | undefined, withDots: boolean): string {
  if (!given) return "";
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .map((p) => (p[0] ? p[0].toUpperCase() + (withDots ? "." : "") : ""))
        .join("-"),
    )
    .join(withDots ? " " : "");
}

function gbtAuthor(a: Author): string {
  if (isCjkName(a)) return compact(a.family + (a.given ?? ""));
  const ini = initials(a.given, false);
  return `${a.family.toUpperCase()}${ini ? " " + ini : ""}`;
}

function apaAuthor(a: Author): string {
  if (isCjkName(a)) return compact(a.family + (a.given ?? ""));
  const ini = initials(a.given, true);
  return ini ? `${a.family}, ${ini}` : a.family;
}

function gbtType(rec: WorkRecord): string {
  switch (rec.type) {
    case "proceedings-article":
    case "paper-conference":
    case "conference-paper":
      return "C";
    case "book":
    case "monograph":
    case "edited-book":
      return "M";
    case "posted-content":
    case "preprint":
    case "article":
      return rec.source === "doi-csl" || rec.type === "preprint" || rec.type === "posted-content" ? "EB/OL" : "J";
    case "dissertation":
      return "D";
    default:
      return "J";
  }
}

/** GB/T 7714-2015 顺序编码制 */
export function formatGbt(rec: WorkRecord): string {
  const zh = rec.authors.some(isCjkName);
  const names = rec.authors.slice(0, 3).map(gbtAuthor);
  let authors = names.join(", ");
  if (rec.authors.length > 3) authors += zh ? ", 等" : ", et al";
  const type = gbtType(rec);
  const title = rec.subtitle ? `${rec.title}: ${rec.subtitle}` : rec.title;
  let s = `${authors ? authors + ". " : ""}${title}[${type}]. `;
  if (type === "C") {
    s += `${rec.venue ? "//" + rec.venue + ". " : ""}${rec.year ?? ""}${rec.pages ? ": " + rec.pages : ""}.`;
  } else {
    const vol = rec.volume ? `, ${rec.volume}${rec.issue ? `(${rec.issue})` : ""}` : "";
    s += `${rec.venue ?? ""}${rec.venue ? ", " : ""}${rec.year ?? ""}${vol}${rec.pages ? ": " + rec.pages : ""}.`;
  }
  if (rec.doi) s += ` DOI: ${rec.doi}.`;
  return s.replace(/\s+/g, " ").replace(/\.\./g, ".").trim();
}

/** APA 第 7 版 */
export function formatApa(rec: WorkRecord): string {
  const names = rec.authors.map(apaAuthor);
  let authors: string;
  if (names.length <= 1) authors = names[0] ?? "";
  else if (names.length <= 20) authors = names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
  else authors = names.slice(0, 19).join(", ") + ", . . . " + names[names.length - 1];
  const title = rec.subtitle ? `${rec.title}: ${rec.subtitle}` : rec.title;
  const pages = rec.pages?.replace(/-/g, "–");
  let s = `${authors ? authors + " " : ""}(${rec.year ?? "n.d."}). ${title.replace(/[.\s]+$/, "")}.`;
  if (rec.venue) {
    s += ` ${rec.venue}`;
    if (rec.volume) s += `, ${rec.volume}${rec.issue ? `(${rec.issue})` : ""}`;
    if (pages) s += `, ${pages}`;
    s += ".";
  }
  if (rec.doi) s += ` https://doi.org/${rec.doi}`;
  return s.replace(/\s+/g, " ").trim();
}

/** 引文是中文或 GB/T 格式就给 GB/T，否则给 APA */
export function suggestCitation(rec: WorkRecord, raw: string): string {
  const gbtLike = /\[(?:J|M|C|D|S|P|R|N|EB)(?:\/OL)?\]/i.test(raw) || /[一-鿿]/.test(raw);
  return gbtLike ? formatGbt(rec) : formatApa(rec);
}
