// 本地解析：把参考文献列表切成条目，并从每条里抽出 DOI、年份、题名、作者段、文献类型。
// 这一步不调用任何外部服务，前端也会用它实时显示"识别到 N 条文献"。

import type { ParsedRef, RefKind } from "./types";
import { cjkRatio } from "./normalize";

const HEADER_RE = /^\s*(参考文献|参考资料|references?|bibliography|works cited)\s*[:：]?\s*$/i;
// 行首序号：[1] ［1］ 1. 1、 1) (1) （1）
const MARKER_RE = /^\s*(?:[[［]\s*\d{1,3}\s*[\]］]|[(（]\s*\d{1,3}\s*[)）]|\d{1,3}\s*[.、)）](?!\d))\s*/;

/** 把粘贴进来的参考文献列表切成单条 */
export function splitReferences(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !HEADER_RE.test(l));

  const nonEmpty = lines.filter((l) => l.trim());
  const markedCount = nonEmpty.filter((l) => MARKER_RE.test(l)).length;

  let entries: string[];
  if (markedCount >= 2 && markedCount >= nonEmpty.length * 0.3) {
    // 有序号：以序号行作为新条目的开始，没有序号的行视为上一条的续行
    entries = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      if (MARKER_RE.test(line) || entries.length === 0) entries.push(line.replace(MARKER_RE, ""));
      else entries[entries.length - 1] += " " + line.trim();
    }
  } else if (/\n\s*\n/.test(text.trim())) {
    // 空行分隔的段落，每段一条
    entries = text
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n/)
      .map((b) => b.split("\n").filter((l) => !HEADER_RE.test(l)).join(" "));
  } else {
    entries = nonEmpty;
  }

  return entries.map((e) => e.replace(/\s+/g, " ").trim()).filter((e) => e.length >= 8);
}

/**
 * 提取 DOI。DOI 只取 ASCII 字符，粘在后面的全角括号、中文标点（〉》，。）自然被排除；
 * 再去掉末尾标点（括号只在不配对时才去掉，因为有的 DOI 本身带括号）。
 */
export function extractDoi(s: string): string | undefined {
  const m = s.match(/\b(10\.\d{4,9}\/[^\s"<>\u0080-￿]+)/i);
  if (!m) return undefined;
  let doi = m[1];
  for (;;) {
    const last = doi[doi.length - 1];
    if (".,;:]}>'".includes(last)) {
      doi = doi.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const open = (doi.match(/\(/g) ?? []).length;
      const close = (doi.match(/\)/g) ?? []).length;
      if (close > open) {
        doi = doi.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return doi.toLowerCase();
}

export function extractArxivId(s: string): string | undefined {
  const m =
    s.match(/arxiv(?:\.org\/(?:abs|pdf)\/|\s*[:：]?\s*)(\d{4}\.\d{4,5})(?:v\d+)?/i) ??
    s.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i);
  return m?.[1];
}

/** 提取出版年份。优先找带括号或位于逗号之间的年份，避免把页码、卷号当成年份 */
export function extractYear(s: string, now = new Date()): number | undefined {
  const maxYear = now.getFullYear() + 1;
  const ok = (y: number) => y >= 1800 && y <= maxYear;
  // 去掉 URL 和 DOI，里面的数字容易误判；再拆开粘在字母后面的年份（Materials2024）
  const text = s
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b10\.\d{4,9}\/\S+/g, " ")
    .replace(/(\p{L})((?:18|19|20)\d{2})(?!\d)/gu, "$1 $2");
  const patterns = [
    /[(（]\s*((?:18|19|20)\d{2})[a-z]?\s*(?:,[^)）]{0,30})?[)）]/, // APA: (2019) · (2024, October 13)
    /[,，]\s*((?:18|19|20)\d{2})\s*[,，(（:：;；.]/, // GB/T: 刊名, 2019, 41(3)
    /\b((?:18|19|20)\d{2})[a-z]?\s*[.。]/, // 2019.
    /\b((?:18|19|20)\d{2})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && ok(Number(m[1]))) return Number(m[1]);
  }
  return undefined;
}

const GBT_TYPE: Record<string, RefKind> = {
  J: "journal",
  M: "book",
  C: "conference",
  A: "conference",
  D: "thesis",
  S: "standard",
  P: "patent",
  R: "report",
  N: "newspaper",
  EB: "web",
  DB: "web",
  CP: "software",
  Z: "unknown",
};

const GBT_MARKER_RE = /\[\s*(J|M|C|A|D|S|P|R|N|EB|DB|CP|Z)\s*(?:\/\s*(?:OL|CD|MT|DK))?\s*\]/i;

/** 计算机等领域的主要会议：开放数据库收录很全，查不到才有参考意义 */
const MAJOR_VENUES =
  "CVPR|ICCV|ECCV|NeurIPS|NIPS|ICML|ICLR|AAAI|IJCAI|ACL|EMNLP|NAACL|COLING|KDD|SIGIR|SIGMOD|VLDB|ICDE|WWW|CHI|UIST|ICSE|FSE|OSDI|SOSP|NSDI|SIGCOMM|INFOCOM|ICRA|IROS|MICCAI|ISCA|MICRO|DAC";
// 只在 "in CVPR" "Proc. ACL" "NeurIPS 2017" 这类上下文里认缩写，避免把网址里的 www、医学里的 ACL 当成会议
export const MAJOR_VENUE_RE = new RegExp(
  `(?:\\b[Ii]n:?\\s+(?:[Pp]roc(?:eedings|\\.)?\\s+(?:of\\s+)?)?(?:the\\s+)?(?:\\d{4}\\s+)?(?:${MAJOR_VENUES})\\b)|(?:\\b(?:${MAJOR_VENUES})\\s*['’]?\\s*(?:\\d{2}|(?:19|20)\\d{2})\\b)|(?:\\((?:${MAJOR_VENUES})\\)\\s*,?\\s*(?:19|20)\\d{2})`,
);

const CONFERENCE_RE = /\b(?:in:?\s+)?proc(?:eedings|\.)|\bconference\b|\bsymposium\b|\bworkshop\b|\bcongress\b|会议|论文集/i;
// 名字里带 Proceedings 的期刊
const JOURNAL_PROCEEDINGS_RE =
  /proceedings of the (?:national academy|royal society|ieee\b(?!\s+(?:international|conference|symposium|workshop)))|proc\.?\s*natl\.?\s*acad|proc\.?\s*r\.?\s*soc|\bpnas\b/i;

/** 期刊论文常见的 "卷(期): 页" 写法，满足任意一种就按期刊论文处理 */
const JOURNAL_PATTERNS = [
  /\b\d{1,4}\s*\(\s*[\dA-Za-z][\dA-Za-z -]{0,9}\)\s*[,:]\s*[eEsS]?\d/, // APA / Springer：9(8), 1735 · 51(Suppl 1):S48
  /\b\d{1,4}\s*\(\s*\d{1,4}\s*\)\s*(?:\(\s*(?:18|19|20)\d{2}\s*\)\s*)?[eE]?\d{3,}/, // Elsevier：6 (8) (2012) 1449–58 · 277 (2021) 118830
  /\b(?:18|19|20)\d{2}\s*(?:[A-Z][a-z]{2}\s*\d{0,2}\s*)?;\s*(?:\d{1,4}|[IVXLC]{1,6})\b/, // Vancouver：2012;6(8):1449 · 2021;11 · 2021;VIII
  /\b\d{1,4}\s*,\s*[eE]?\d{1,7}(?:\s*[-–]\s*\d+)?\s*\(\s*(?:18|19|20)\d{2}\s*\)/, // 物理 / 化学：19, 3942 (2022)
  /[A-Za-z.]\s+\d{1,4}\s*(?:\([^)]{1,10}\))?\s*:\s*[eE]?\d{1,7}/, // Springer：J Manuf Process 27:37–62 · Cureus 17: e77202
  /\p{L}(?:18|19|20)\d{2}\s+(?:\d{1,4}|n\/a)\s+[eE]?\d{3,}/u, // Wiley 粘连写法：Electrochimica Acta2023 439 141730
  /\bvol\.?\s*\d+.*\b(?:pp?\.|no\.)\s*\d+/i, // IEEE：vol. 521, no. 7553, pp. 436-444
  /,\s*(?:18|19|20)\d{2}\s*,\s*\d{1,4}\s*(?:\(\s*\d{1,4}\s*\))?\s*:\s*\d/, // GB/T 无类型标识：刊名, 2017, 33(2): 10-17
  /,\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\s*:\s*\d{1,5}\s*[-–]\s*\d/, // 中文：学报, 56: 297–307 · 新疆文物, 1–2: 105–121
  /\(\s*(?:18|19|20)\d{2}[a-z]?\s*\)\s*[.,].+,\s*(?:\d{1,4}|e\d{3,})\s*\.?\s*$/, // MDPI：(2022). 题名. Cells, 11. · Small, e2400278.
];

const THESIS_RE =
  /\b(?:ph\.?\s?d|m\.?\s?sc|msc|master'?s?|doctoral|bachelor'?s?|diploma|honou?rs)\.?\s+(?:thesis|dissertation)\b|\bdissertations?\b|\bthesis\b|学位论文|硕士论文|博士论文|硕士学位|博士学位/i;
const STANDARD_CODE_RE = /\b(?:ASTM|ISO|IEC|ANSI|DIN|JIS|BS|EN|GB\/T|GB\/Z|GB|IEEE Std|SAE)\s?[A-Z]?\s?\d{2,}/;
const STANDARD_WORD_RE = /\bstandard (?:test )?(?:methods?|specifications?|practices?|guides?)\b|\bstandard no\.|国家标准|行业标准/i;
const PATENT_RE = /\bpatent\b|专利|\b(?:US|CN|EP|WO|JP)\s?\d{6,}\s?[A-Z]?\d?\b/;
const LEGAL_RE =
  /\b(?:directive|regulation\s*\((?:eu|ec|eec)\)|regulation no\.?|act of \d{4}|official journal of the european|federal register|public law \d|code of federal regulations|statute|decree)\b|法律|法规|条例/i;
const SOFTWARE_RE =
  /\b(?:software|computer program|r package|python package|source code|zenodo)\b|\b(?:version|revision|release)\s+[a-z]?\.?\d+(?:\.\d+)*\b|\bv\d+\.\d+(?:\.\d+)?\b|\bgaussian\s+\d{2}\b|\bR Core Team\b|github\.com/i;
const BOOK_RE =
  /\b(?:press|publishers?|publishing|verlag|isbn)\b|出版社|\bin:?\s.+\((?:eds?|hrsg)\.?\)|\((?:eds?)\.?\)|\bed(?:s|ition)?\.\s|\b\d+(?:st|nd|rd|th)\s+ed(?:ition|\.)|\/978-\d/i;
const WEB_RE =
  /\b(?:retrieved|accessed|available (?:online|at|from)|last (?:accessed|visited)|online:)\b|\[www document\]|\burl\s*[:〈<(]|访问日期|引用日期/i;
const REPORT_RE =
  /\b(?:report|white paper|working paper|technical note|policy brief|fact sheet|briefing paper|discussion paper|guidelines?|yearbook)\b|报告|年鉴|白皮书/i;
// 机构作者：开头就是部委、机构、协会这类名称
const ORG_AUTHOR_RE =
  /^(?:the\s+)?(?:[A-Z][\w&'’.-]*\s+){0,4}(?:Organi[sz]ation|Department|Ministry|Office|Agency|Bureau|Council|Commission|Parliament|Institute|Center|Centre|Association|Foundation|Society|Administration|Authority|Board|Committee|Union|Bank|Fund|Programme|Program|Service)\b/;

/** 文献类型：GB/T 7714 类型标识优先，其次看"卷(期): 页"这类期刊特征，最后看关键词 */
export function detectKind(s: string): RefKind {
  const t = s.normalize("NFKC");
  // arXiv 论文在 GB/T 里常被标成 [J]，按预印本处理更准确
  if (/arxiv|preprint|预印本|ssrn|biorxiv|medrxiv|chemrxiv|research square|techrxiv|\b10\.1101\//i.test(t)) return "preprint";
  const m = t.match(GBT_MARKER_RE);
  if (m) return GBT_TYPE[m[1].toUpperCase()] ?? "unknown";
  if (THESIS_RE.test(t)) return "thesis";
  if ((CONFERENCE_RE.test(t) && !JOURNAL_PROCEEDINGS_RE.test(t)) || MAJOR_VENUE_RE.test(t)) return "conference";
  if (JOURNAL_PATTERNS.some((re) => re.test(t))) return "journal";
  if (STANDARD_CODE_RE.test(t) || STANDARD_WORD_RE.test(t)) return "standard";
  if (PATENT_RE.test(t)) return "patent";
  if (LEGAL_RE.test(t)) return "legal";
  if (SOFTWARE_RE.test(t)) return "software";
  if (BOOK_RE.test(t)) return "book";
  if (WEB_RE.test(t)) return "web";
  if (REPORT_RE.test(t) || ORG_AUTHOR_RE.test(t)) return "report";
  // 只有普通网址、没有 DOI，多半是网页
  const urls = t.replace(/https?:\/\/(?:dx\.)?doi\.org\/\S+/gi, " ");
  if (/https?:\/\/|www\.\w/i.test(urls) && !/\b10\.\d{4,9}\//.test(t)) return "web";
  return "unknown";
}

// ---------- 作者段 ----------

const PARTICLE = "(?:(?:van|von|de|del|della|der|den|da|di|du|dos|das|la|le|ten|ter|bin|al|el)\\s+)*";
const SURNAME = "\\p{Lu}[\\p{L}'’\\-]*(?:\\s+\\p{Lu}[\\p{L}'’\\-]*){0,2}";
const INITIAL = "\\p{Lu}\\.?\\s?-?\\s?";
const VANCOUVER_NAME = `${PARTICLE}${SURNAME}\\s+\\p{Lu}{1,3}(?:-\\p{Lu})?`;
const CJK_NAME = "[\\p{Script=Han}]{1,2}\\s?[\\p{Script=Han}]{1,3}";
const NAME_PATTERNS = [
  new RegExp(`^${VANCOUVER_NAME}$`, "u"), // Vancouver / GB/T：Belzer C · de Vos WM · Richard J-C · LECUN Y
  new RegExp(`^(?:\\p{Lu}\\.\\s?-?\\s?){1,4}${PARTICLE}${SURNAME}$`, "u"), // 名缩写在前：A. Meftahi · D.D. Fang · C.-R. Cho
  new RegExp(`^${PARTICLE}${SURNAME},\\s*(?:${INITIAL}){1,4}$`, "u"), // APA / Springer：Ostolaza, M. · Spierings, A.B.L.G.
  new RegExp(`^${CJK_NAME}$`, "u"), // 中文：宫鹏 · 王 韦韦
];
const ET_AL_RE = /^(?:et\s+al\.?|等人?)$/i;
const INITIALS_ONLY_RE = new RegExp(`^(?:${INITIAL}){1,4}$`, "u");
const SURNAME_ONLY_RE = new RegExp(`^${PARTICLE}${SURNAME}$`, "u");
// 最后一位作者后面紧跟 ". 题名"（Vancouver / GB/T / 中文）
const LAST_NAME_THEN_TITLE_RE = new RegExp(`^(${VANCOUVER_NAME}|${CJK_NAME}|et\\s+al|等人?)[.．]\\s*\\S`, "u");
// 片段以姓名开头，后面却不是 ". 题名"（"Counterfeit X | 2015"、"J. Nanostruct. Chem."）：作者段在哪结束说不清
const NAME_PREFIX_RE = new RegExp(
  `^(?:${VANCOUVER_NAME}|(?:\\p{Lu}\\.\\s?-?\\s?){1,4}${PARTICLE}${SURNAME}|${CJK_NAME})(?![\\p{L}])`,
  "u",
);

function isName(seg: string): boolean {
  const s = seg.replace(/\s+et\s+al\.?$/i, "").trim();
  return ET_AL_RE.test(s) || NAME_PATTERNS.some((re) => re.test(s));
}

/** 按逗号、分号、and、& 切分，并把 APA 的 "Surname" + "I." 拼回一段 */
function nameSegments(text: string): string[] {
  const parts = text
    .split(/\s*(?:[,;，、]|\s&\s)\s*|\s+and\s+/)
    .map((p) => p.replace(/^(?:and|&)\s+/i, "").trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const next = parts[i + 1];
    if (next && INITIALS_ONLY_RE.test(next) && SURNAME_ONLY_RE.test(parts[i]) && !INITIALS_ONLY_RE.test(parts[i])) {
      merged.push(`${parts[i]}, ${next}`);
      i++;
    } else {
      merged.push(parts[i]);
    }
  }
  return merged;
}

function isAuthorList(text: string): boolean {
  const segs = nameSegments(text.replace(/[.:\s]+$/, ""));
  return segs.length > 0 && segs.every(isName) && segs.some((s) => !ET_AL_RE.test(s));
}

interface Span {
  text: string;
  /** 作者段在原文中的结束位置 */
  end: number;
}

/** 从开头逐段累加姓名，遇到第一个不像姓名的片段就停（它通常是题名或刊名） */
function leadingNames(t: string): Span | undefined {
  const segs = [...t.matchAll(/[^,;，、]+/g)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
  let end = -1;
  let real = 0;
  for (let i = 0; i < segs.length && i < 160; i++) {
    const seg = segs[i].text.replace(/^\s*(?:and|&)\s+/i, "").trim();
    if (!seg) break;
    const next = segs[i + 1]?.text.trim();
    // APA 的 "Surname, I." 被逗号拆成了两段
    if (next && SURNAME_ONLY_RE.test(seg) && INITIALS_ONLY_RE.test(next)) {
      end = segs[i + 1].end;
      real++;
      i++;
      continue;
    }
    if (isName(seg)) {
      end = segs[i].end;
      if (!ET_AL_RE.test(seg)) real++;
      continue;
    }
    const tail = seg.match(LAST_NAME_THEN_TITLE_RE);
    if (tail) {
      end = segs[i].start + segs[i].text.indexOf(tail[1]) + tail[1].length;
      if (!ET_AL_RE.test(tail[1])) real++;
    } else if (NAME_PREFIX_RE.test(seg)) {
      // 宁可不给作者段（比对时退回整条原文），也不能截掉后面的作者，否则查不出编造的合著者
      return undefined;
    }
    break;
  }
  return real > 0 && end > 0 ? { text: t.slice(0, end).trim(), end } : undefined;
}

function authorSpan(t: string): Span | undefined {
  // APA：作者段到 "(年份)" 之前
  const apa = t.match(/^(.{2,400}?)\s*\(\s*(?:18|19|20)\d{2}[a-z]?(?:\s*,[^)]{0,30})?\s*\)/);
  if (apa && isAuthorList(apa[1])) return { text: apa[1], end: apa[1].length };
  // IEEE：作者段到引号之前
  const ieee = t.match(/^(.{2,400}?),?\s*[“"]/);
  if (ieee && isAuthorList(ieee[1])) return { text: ieee[1], end: ieee[1].length };
  // Springer：作者段以 "M.:" 这样的冒号结束
  const colon = t.match(/^(.{2,400}?\.)\s*:\s/);
  if (colon && isAuthorList(colon[1])) return { text: colon[1], end: colon[1].length };
  return leadingNames(t);
}

/**
 * 取出作者段。只在能确认边界时返回，宁可返回 undefined 让比对退回整条原文，
 * 也不能把题名、刊名混进作者段（否则会把真实文献误判成"作者不符"）。
 */
export function guessAuthors(s: string): string | undefined {
  const span = authorSpan(s.normalize("NFKC").trim());
  return span?.text.replace(/[,.:;\s]+$/, "").trim() || undefined;
}

// ---------- 题名、期刊 ----------

/** 题名候选的基本检查：有足够的文字，不能是 "19, 3942 (2022)" 这种刊名卷页 */
function plausibleTitle(x: string): boolean {
  const s = x.trim();
  if (/^\d/.test(s)) return false;
  if (/\(\s*(?:18|19|20)\d{2}\s*\)|\b\d{1,4}\s*,\s*\d+\s*$/.test(s)) return false;
  const words = s.match(/\p{L}{2,}/gu) ?? [];
  const han = s.match(/\p{Script=Han}/gu)?.length ?? 0;
  return words.length >= 3 || han >= 6;
}

/** 启发式猜题名。猜不准没关系，后面的匹配主要拿数据库题名去原文里找 */
export function guessTitle(s: string): string | undefined {
  // 中文期刊的英文译名常带 "(in Chinese)" 后缀，不属于题名
  return rawTitle(s)?.replace(/\s*\(in chinese\)\s*$/i, "").trim() || undefined;
}

function rawTitle(s: string): string | undefined {
  const t = s.normalize("NFKC").trim();
  // GB/T 7714：作者. 题名[J]. 刊名, 年, 卷(期): 页码.
  const gbt = t.match(/^(.+?)[.．]\s*(.+?)\s*\[(?:J|M|C|A|D|S|P|R|N|EB|DB|CP|Z)(?:\/[A-Z]{2})?\]/i);
  if (gbt && gbt[2].length >= 4) return gbt[2].trim();
  // APA：Author, A. (2019). Title. Journal...
  const apa = t.match(/\(\s*(?:18|19|20)\d{2}[a-z]?(?:\s*,[^)]{0,30})?\s*\)\s*[.,]?\s*(.+?)(?:[.?!](?:\s|$))/);
  if (apa && apa[1].length >= 8 && plausibleTitle(apa[1])) return apa[1].trim();
  // IEEE / MLA：题名在引号里
  const quoted = t.match(/[“"](.{8,}?)[,.]?[”"]/);
  if (quoted) return quoted[1].trim();
  // Vancouver / Springer / 物理期刊 / 中文无类型标识：作者段之后到下一个句号
  const span = authorSpan(t);
  if (span) {
    const rest = t.slice(span.end).replace(/^[\s.,:;．，]+/, "").replace(/^(?:et\s+al|等人?)[.．,]?\s*/i, "");
    const m = rest.match(/^(?:(?:18|19|20)\d{2}[.．]\s*)?(.{6,400}?)(?:[.?!．。](?:\s|$)|\s*\[[A-Z]{1,2}(?:\/[A-Z]{2})?\])/);
    if (m && plausibleTitle(m[1])) return m[1].trim();
  }
  return undefined;
}

/** 启发式猜期刊名：GB/T 取 [J]. 之后到逗号；其他格式取题名之后到卷号前 */
export function guessVenue(s: string, titleGuess?: string): string | undefined {
  const t = s.normalize("NFKC");
  const gbt = t.match(/\[J(?:\/OL)?\]\s*[.．]\s*([^,，.．\d]{2,}?)\s*[,，]/i);
  if (gbt) return gbt[1].trim();
  if (titleGuess) {
    const at = t.indexOf(titleGuess);
    if (at >= 0) {
      const rest = t
        .slice(at + titleGuess.length)
        .replace(/^\s*\(in chinese\)/i, "")
        .replace(/^\s*\[[A-Z]{1,2}(?:\/[A-Z]{2})?\]/i, "")
        .replace(/^\s*[.?!”"．。]+\s*/, "");
      if (/^(in\s|proceedings|proc\.|https?:)/i.test(rest)) return undefined;
      const m = rest.match(/^([^,，(\d]{2,}?)\s*(?:[,，]|\(|\d)/);
      if (m) return m[1].replace(/[.\s]+$/, "").trim() || undefined;
      // 刊名缩写在引文末尾、后面没有卷期页码（"... Songliao Basin. Earth Sci. Front."）；
      // 要求中间有 "Sci. " 这样的缩写词，避免把末尾的出版社名（Springer Nature）当成刊名
      const tail = rest.match(/^(\p{Lu}[^,，()\d\[\]]{1,80}?)[.。．\s]*$/u)?.[1].trim();
      if (tail && /\b\p{Lu}\p{Ll}{0,8}\.\s/u.test(tail)) return tail;
    }
  }
  return undefined;
}

export function parseReference(raw: string, index: number): ParsedRef {
  const doi = extractDoi(raw);
  const arxivId = extractArxivId(raw);
  const kind = detectKind(raw);
  const titleGuess = guessTitle(raw);
  const zh = cjkRatio(raw) > 0.15 || /\p{Script=Han}{4,}/u.test(raw) || /\(in chinese\)/i.test(raw);
  return {
    index,
    raw,
    doi: doi ?? (arxivId ? `10.48550/arxiv.${arxivId}` : undefined),
    arxivId,
    year: extractYear(raw),
    titleGuess,
    authorsGuess: guessAuthors(raw),
    venueGuess: kind === "journal" || kind === "unknown" ? guessVenue(raw, titleGuess) : undefined,
    kind,
    lang: zh ? "zh" : "en",
  };
}

export function parseReferenceList(text: string): ParsedRef[] {
  return splitReferences(text).map((raw, i) => parseReference(raw, i + 1));
}
