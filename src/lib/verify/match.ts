// 把一条引文和数据库里的一条记录做逐字段比对，判断是不是同一篇文献。
// 思路：不依赖把引文完全解析正确，而是拿数据库里的题名、作者、期刊去原文里找。

import { organizationAuthor } from "./extract";
import {
  alnum,
  compact,
  deglueNames,
  isCjk,
  normalizeText,
  recall,
  stripRetractionPrefix,
  tokenCount,
  tokenSet,
  tokenize,
} from "./normalize";
import { romanizeHanAuthorList, romanizeHanName } from "./romanize";
import type { Author, FieldCheck, ParsedRef, WorkRecord } from "./types";

const HAN_RE = /\p{Script=Han}/u;

export interface MatchScore {
  /** 题名一致程度 0–1 */
  titleScore: number;
  /** 引文本身没写题名（物理、化学期刊常见），只能靠作者、刊名、卷期页码比对 */
  titleMissing: boolean;
  /** 数据库前几位作者在引文中出现的比例；数据库没有作者信息时为 undefined */
  authorRatio?: number;
  /** 数据库记录的第一作者是否出现在引文中（是否排第一由 authorOrderOk 判断） */
  firstAuthor: "match" | "mismatch" | "unknown";
  /** 作者顺序是否与数据库一致；无法判断时为 undefined */
  authorOrderOk?: boolean;
  /** 已识别的作者段中是否包含数据库作者以外的姓名；省略作者不算错误。 */
  authorListMismatch?: boolean;
  /** 中文记录：引文列出的作者都在数据库作者里，只是顺序不同（Crossref 的中文记录常把顺序登记错） */
  authorsReordered?: boolean;
  /** 引文年份与数据库各个出版年份（正式、纸本、在线首发）的最小差值 */
  yearDiff?: number;
  /** 数据库记录的卷号、起始页（或文章号）是否出现在引文里 */
  volumeHit: boolean;
  pageHit: boolean;
  /** 期刊名一致程度；无法比对时为 undefined */
  venueScore?: number;
  /** 引文里写的期刊名能否被单独识别出来 */
  venueCited: boolean;
  /** 引文 DOI 与数据库 DOI 是否一致；任一方没有 DOI 时为 undefined */
  doiMatch?: boolean;
  /** 用于在候选之间排序的综合分 */
  composite: number;
  same: boolean;
  partial: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * cited 里的词元能否对上 actual 里的词元：完全相同，或 cited 是缩写前缀（Comput. ↔ Computer，Am. ↔ American），
 * 或两者共享足够长的词干（Methodological ↔ Methodology）
 */
function tokenLike(cited: string, actual: string): boolean {
  if (cited === actual) return true;
  if (isCjk(cited[0]) || isCjk(actual[0])) return false;
  if (cited.length >= 2 && actual.startsWith(cited)) return true;
  if (actual.length >= 3 && cited.startsWith(actual)) return true;
  const min = Math.min(cited.length, actual.length);
  let i = 0;
  while (i < min && cited[i] === actual[i]) i++;
  return i >= 6;
}

/** cited 中有多大比例的词元能在 actual 中找到（支持缩写） */
export function fuzzyRecall(cited: string, actual: string): number {
  const c = [...new Set(tokenize(cited))];
  const a = [...new Set(tokenize(actual))];
  if (!c.length || !a.length) return 0;
  return c.filter((t) => a.some((u) => tokenLike(t, u))).length / c.length;
}

/** 期刊名首字母缩写（PNAS、JMLR 这类写法） */
function acronym(s: string): string {
  return tokenize(s)
    .filter((t) => !isCjk(t[0]))
    .map((t) => t[0])
    .join("");
}

/** 引文刊名以数据库刊名开头、后面多出副刊名（Clin Infect Dis Off Publ Infect Dis Soc Am ↔ Clinical Infectious Diseases） */
function leadingMatch(cited: string, actual: string): boolean {
  const c = tokenize(cited);
  const a = tokenize(actual);
  return a.length >= 2 && c.length > a.length && a.every((t, i) => tokenLike(c[i], t));
}

/** 引文里写的期刊名与数据库期刊名的一致程度 */
export function venueSimilarity(cited: string, actual: string, actualShort?: string): number {
  const citedCompact = normalizeText(cited).replace(/ /g, "");
  if (citedCompact.length >= 3 && !isCjk(citedCompact[0])) {
    const acr = acronym(actual);
    if (acr === citedCompact || (citedCompact.length >= 4 && acr.includes(citedCompact))) return 1;
  }
  if (leadingMatch(cited, actual) || (actualShort && leadingMatch(cited, actualShort))) return 1;
  return Math.max(fuzzyRecall(cited, actual), actualShort ? fuzzyRecall(cited, actualShort) : 0);
}

const PARTICLES = new Set(["van", "von", "de", "del", "della", "der", "den", "da", "di", "du", "dos", "das", "la", "le", "ten", "ter", "bin", "al", "el"]);

function locateName(family: string, given: string | undefined, rawNorm: string, rawCompact: string): number {
  if (isCjk(family[0])) {
    const full = compact(family + (given ?? ""));
    const pos = rawCompact.indexOf(full);
    if (pos >= 0) return pos;
    const fam = compact(family);
    return fam.length >= 2 && fam !== full ? rawCompact.indexOf(fam) : -1;
  }
  const fam = normalizeText(family);
  if (!fam) return -1;
  const variants = new Set([fam, fam.replace(/ /g, "")]);
  const parts = fam.split(" ");
  const last = parts[parts.length - 1];
  if (last.length >= 3) variants.add(last);
  // 复姓或整个姓名都放在 family 里（Ustaalioglu Oven、Shan Hangyong）：第一个词通常就是引文里写的姓
  if (parts.length > 1 && parts[0].length >= 2 && !PARTICLES.has(parts[0])) variants.add(parts[0]);
  let best = -1;
  for (const v of variants) {
    const m = new RegExp(`(?:^| )${escapeRe(v)}(?: |$)`).exec(rawNorm);
    if (m && (best < 0 || m.index < best)) best = m.index;
  }
  return best;
}

/** 在引文里定位某位作者，返回出现位置，找不到返回 -1 */
export function locateAuthor(author: Author, rawNorm: string, rawCompact: string): number {
  const family = author.family.trim();
  if (!family) return -1;
  const at = locateName(family, author.given, rawNorm, rawCompact);
  if (at >= 0) return at;
  // 有的记录把姓和名放反了（family 是 "A. Mine"，given 才是姓 "Onenerk"）：family 不像普通姓时再用 given 找一次
  const given = author.given?.trim();
  if (given && /[.\s]/.test(family) && /^\p{L}{3,}$/u.test(given) && !isCjk(given[0])) {
    return locateName(given, undefined, rawNorm, rawCompact);
  }
  return -1;
}

/** 卷号、页码这类数字是否单独出现在文本里（允许文章号前的 e：e2400278） */
function numberIn(text: string, value: string | undefined): boolean {
  const v = value?.trim().replace(/^[eE]/, "");
  return !!v && /^\d{1,8}$/.test(v) && new RegExp(`(?<![\\d.])[eE]?${v}(?!\\d)`).test(text);
}

// 题名之外常见的书目用词
const BIBLIO_WORDS = new Set([
  "vol", "volume", "no", "issue", "pp", "page", "pages", "art", "article", "suppl", "supplement",
  "doi", "pmid", "pubmed", "pmc", "eds", "ed", "press", "online", "available", "accessed", "retrieved",
]);

/** 引文（已去掉链接和 DOI）再去掉作者、刊名和数字后还剩几个词；几乎不剩说明引文没写题名 */
function leftoverWords(plain: string, rec: WorkRecord): number {
  const names = new Set(rec.authors.flatMap((a) => normalizeText(`${a.family} ${a.given ?? ""}`).split(" ")));
  const venue = tokenize([rec.venue, rec.venueShort].filter(Boolean).join(" "));
  return tokenize(plain).filter(
    (t) => !/^\d+$/.test(t) && t.length > 2 && !names.has(t) && !BIBLIO_WORDS.has(t) && !venue.some((v) => tokenLike(t, v)),
  ).length;
}

const ORGANIZATION_RE =
  /\b(?:committee|council|commission|organi[sz]ation|association|society|institute|agency|department|ministry|office|bureau|centre|center|foundation|consortium|board|administration|authority|corporation|international|inc|ltd|gmbh|team|group)\b|委员会|协会|学会|研究院|研究所|中心|组织/i;

/**
 * 记录里的作者全是机构名（没有名、名称里有 Committee、Society 等，或是 IUCN 这样的全大写缩写）。
 * IUCN 红色名录的记录把机构登记为作者、评估人写在题名里（B029），按姓氏比对没有意义
 */
export function isOrganizationList(authors: Author[]): boolean {
  return authors.length > 0 && authors.every((a) => !a.given && (ORGANIZATION_RE.test(a.family) || /^[A-Z]{3,10}$/.test(a.family.trim())));
}

// 开放数据库覆盖不足的文献类型（与 verify.ts 的 OUT_OF_SCOPE 相同）：数据库里查到的常是它的另一版本、转载或同名的其他作品
const VERSIONED_KINDS = new Set<ParsedRef["kind"]>(["book", "thesis", "standard", "patent", "report", "newspaper", "web", "legal", "presentation", "archive", "software"]);
const VERSIONED_TYPE_RE = /^(?:book|edited-book|monograph|reference-book|book-set|book-series|dissertation|dataset|software|database)$/i;
const JOURNAL_TYPE_RE = /^(?:journal-article|article|review|proceedings-article)$/i;

/** 引文或记录属于常有多个版本的类型：年份差得远时，记录可能是另一版本、转载或同名的其他作品 */
function editionsLikely(ref: ParsedRef, rec: WorkRecord): boolean {
  return VERSIONED_KINDS.has(ref.kind) || VERSIONED_TYPE_RE.test(rec.type ?? "");
}

/**
 * 图书、学位论文常有多个版本、印次，或后来的存档、数字化记录；网页、报告常被转载到 SSRN 等平台（比特币白皮书 2008 ↔ SSRN 2019）；
 * 软件、数据集的记录常是总 DOI（首发年份）。这些记录的年份与引文不同不一定是写错。
 * 记录本身是期刊论文时（引文只是被识别成了报告、网页）年份仍要对得上
 */
export function yearVaries(ref: ParsedRef, rec: WorkRecord): boolean {
  if (ref.kind === "book" || ref.kind === "thesis" || VERSIONED_TYPE_RE.test(rec.type ?? "")) return true;
  return VERSIONED_KINDS.has(ref.kind) && !!rec.type && !JOURNAL_TYPE_RE.test(rec.type);
}

/** 软件、数据集按版本发布：数据库记录常是整个软件包的总 DOI，作者是现任维护者，引用写的是某个版本的作者 */
export function versionedRecord(ref: ParsedRef, rec: WorkRecord): boolean {
  return ref.kind === "software" || /^(?:dataset|software|database)$/i.test(rec.type ?? "");
}

/** 数据库记录的全部出版年份：正式出版年份在前，另有纸本、在线首发年份 */
export function recordYears(rec: WorkRecord): number[] {
  return [...new Set([rec.year, ...(rec.years ?? [])].filter((y): y is number => y !== undefined))];
}

export function scoreCandidate(ref: ParsedRef, rec: WorkRecord): MatchScore {
  const rawSet = tokenSet(ref.raw);
  const main = stripRetractionPrefix(rec.title);
  const full = rec.subtitle ? `${main} ${rec.subtitle}` : main;

  // 题名：数据库题名在引文里出现了多少；如果猜出了引文题名，再反向看引文题名有多少在数据库题名里。
  // 化学式这类题名在数据库里常被拆开（W18O49 ↔ W 18 O 49），去掉空格和标点后整段出现也算一致。
  // 卷号、页码、"剩余词"只在去掉链接和 DOI 的文本里找，链接里的数字和词不算
  const plain = ref.raw.replace(/https?:\/\/\S+/gi, " ").replace(/\b(?:doi\s*[:：]?\s*)?10\.\d{4,9}\/\S+/gi, " ");
  const rawAlnum = alnum(ref.raw);
  const mainAlnum = alnum(main);
  const forward = mainAlnum.length >= 20 && rawAlnum.includes(mainAlnum)
    ? 1 : Math.max(recall(main, rawSet), rec.subtitle ? recall(full, rawSet) : 0);
  const guessAlnum = ref.titleGuess ? alnum(ref.titleGuess) : "";
  const backward = !ref.titleGuess ? 0 : guessAlnum.length >= 20 && alnum(full).includes(guessAlnum)
    ? 1 : recall(ref.titleGuess, tokenSet(full));
  const titleScore = ref.titleGuess ? 0.65 * forward + 0.35 * backward : forward;
  const titleMissing = titleScore < 0.5 && !ref.titleGuess && leftoverWords(plain, rec) <= 2;

  // 跨文字比对：引文是汉字姓名而记录是拼音（窦杰 ↔ Dou J），或反过来，先把汉字一侧转成拼音
  const recordHan = rec.authors.some((a) => isCjk(a.family.trim()[0] ?? ""));
  const citedHan = !!ref.authorsGuess && HAN_RE.test(ref.authorsGuess) && !/[A-Za-z]{3,}/.test(ref.authorsGuess.replace(/\bet\s+al\b/gi, ""));
  const citedAuthors = citedHan && rec.authors.length && !recordHan ? romanizeHanAuthorList(ref.authorsGuess!) : ref.authorsGuess;
  const recordAuthors = recordHan && !citedHan && !HAN_RE.test(ref.authorsGuess ?? ref.raw)
    ? rec.authors.map((a) => romanizeHanName(a.family + (a.given ?? "")) ?? a) : rec.authors;

  // 有独立作者段时只在该段查找，避免把题名 / 期刊中的人名算成作者；粘连的缩写（EstebanO）先拆开。
  const authorText = deglueNames(citedAuthors ?? ref.raw);
  const rawNorm = normalizeText(authorText);
  const rawCompact = compact(authorText);
  // 标准、机构报告的"作者"是机构（ASTM International ↔ D30 Committee），按姓氏比对没有意义，当作没有作者信息
  let people = ref.kind === "standard" || isOrganizationList(recordAuthors) ? [] : recordAuthors;
  // 引文是机构署名（"World Health Organization. 1978. ..."），记录里的个人作者一个也不在引文中：同样不按姓氏比对。
  // 期刊论文的记录常列出执笔的个人（"American Diabetes Association. ... Diabetes Care 2023" ↔ ElSayed NA 等）；
  // 报告、宣言这类非期刊文献，这样的记录通常是收录或转载它的图书章节、期刊（B056），不算同一篇
  const orgCited = !citedAuthors && people.length > 0 && organizationAuthor(ref.raw)
    && people.every((a) => locateAuthor(a, rawNorm, rawCompact) < 0);
  const reprint = orgCited && VERSIONED_KINDS.has(ref.kind);
  if (orgCited) people = [];
  const considered = people.slice(0, 3);
  const positions = people.map((a) => locateAuthor(a, rawNorm, rawCompact));
  const found = positions.filter((p) => p >= 0);
  const authorRatio = considered.length ? positions.slice(0, 3).filter((p) => p >= 0).length / considered.length : undefined;
  const firstAuthor: MatchScore["firstAuthor"] = considered.length === 0 ? "unknown" : positions[0] >= 0 ? "match" : "mismatch";
  // 比较所有已列出的作者，不只确认第一作者；同姓定位有歧义时不强判顺序。
  const authorOrderOk = found.length >= 2 && new Set(found).size === found.length
    ? found.every((p, i) => i === 0 || p > found[i - 1]) : undefined;
  let authorListMismatch: boolean | undefined;
  if (citedAuthors && people.length) {
    const initialsOf = (s: string) => normalizeText(s).split(" ").filter(Boolean).map((p) => p[0]).join("");
    const known = new Set(people.flatMap((a) => {
      const names = normalizeText(`${a.family} ${a.given ?? ""}`).split(" ");
      // 复姓只写其中一个姓、另一个变成缩写：Uttam Patil M ↔ Patil MU，Carrillo Esper R ↔ Esper RC，P.R. LE ↔ Pr LE
      const familyTokens = normalizeText(a.family).split(" ").filter(Boolean);
      const given = initialsOf(a.given ?? "");
      const compound = familyTokens.length < 2 ? [] : familyTokens.flatMap((_, i) => {
        const others = familyTokens.filter((__, j) => j !== i).map((t) => t[0]).join("");
        return [others, given + others, others + given];
      });
      // 姓名放反的记录里，引文的缩写其实来自 family（"A. Mine" ↔ "Onenerk AM"）
      return [...names, ...compound, normalizeText(a.family).replace(/ /g, ""), given, initialsOf(a.family),
        compact(a.family + (a.given ?? ""))];
    }));
    // 记录里只有名、缺中间名缩写（OpenAlex 的 "Tim Rhodes"）：引文多写一个首字母（Rhodes TR）不算错
    const initialsByFamily = new Map<string, string[]>();
    for (const a of people) {
      const family = normalizeText(a.family).split(" ").pop() ?? "";
      const given = initialsOf(a.given ?? "");
      if (family && given) initialsByFamily.set(family, [...(initialsByFamily.get(family) ?? []), given]);
    }
    const cited = normalizeText(deglueNames(citedAuthors))
      .replace(/\bet\s+al\b|\band\b|等(?:人)?/g, " ").split(/\s+/).filter(Boolean);
    authorListMismatch = cited.some((name, i) => name.length > 1 && !known.has(name)
      && !(/^[a-z]{2,3}$/.test(name) && (initialsByFamily.get(cited[i - 1]) ?? []).some((g) => name.startsWith(g))));
  }
  // 中文记录：引文列出的作者都能在数据库作者中找到，但顺序或第一作者不同。Crossref 的中文记录常把顺序登记错
  // （宫鹏等 2010 的记录里宫鹏排在第 14 位），这时不能说引文写错了作者
  let authorsReordered: boolean | undefined;
  if (recordHan && ref.authorsGuess && HAN_RE.test(ref.authorsGuess) && people.length) {
    const recorded = new Set(people.map((a) => compact(a.family + (a.given ?? ""))));
    const cited = ref.authorsGuess.split(/\s*[,，、;；]\s*/).map(compact).filter((s) => s && !/^(?:等人?|et\s*al\.?)$/i.test(s));
    authorsReordered = cited.length > 0 && cited.every((name) => recorded.has(name))
      && (authorOrderOk === false || firstAuthor === "mismatch" || (authorRatio ?? 1) < 0.5);
  }

  const years = recordYears(rec);
  const yearDiff = ref.year && years.length ? Math.min(...years.map((y) => Math.abs(ref.year! - y))) : undefined;
  const volumeHit = numberIn(plain, rec.volume);
  const pageHit = numberIn(plain, rec.pages?.split(/[-–]/)[0]);

  // 期刊：中文引文对英文期刊名（或反过来）没法比，直接跳过
  let venueScore: number | undefined;
  let venueCited = false;
  if (rec.venue && isCjk(rec.venue.trim()[0] ?? "") === (ref.lang === "zh")) {
    if (ref.venueGuess) {
      venueCited = true;
      venueScore = venueSimilarity(ref.venueGuess, rec.venue, rec.venueShort);
    } else {
      venueScore = Math.max(fuzzyRecall(rec.venue, ref.raw), rec.venueShort ? fuzzyRecall(rec.venueShort, ref.raw) : 0);
    }
  }

  const doiMatch = ref.doi && rec.doi ? ref.doi.toLowerCase() === rec.doi.toLowerCase() : undefined;

  const yearScore = yearDiff === undefined ? 0.5 : yearDiff === 0 ? 1 : yearDiff === 1 ? 0.6 : 0;
  // 没写题名的引文，题名分换成卷号、页码的吻合程度，否则同一篇也会排在别的候选后面
  const titleTerm = titleMissing ? 0.3 + 0.35 * Number(volumeHit) + 0.35 * Number(pageHit) : titleScore;
  const composite =
    0.55 * titleTerm +
    0.2 * (authorRatio ?? 0.5) +
    0.1 * (firstAuthor === "match" ? 1 : 0) +
    0.1 * yearScore +
    0.05 * (venueScore ?? 0.5) +
    (doiMatch ? 0.15 : 0);

  const strongTitle = titleScore >= 0.8;
  const authorOk = firstAuthor === "match" || (authorRatio ?? 0) >= 0.5;
  const yearOk = yearDiff !== undefined && yearDiff <= 1;
  const venueOk = (venueScore ?? 0) >= 0.6;
  const noAuthors = considered.length === 0;

  let same: boolean;
  if (doiMatch && titleScore >= 0.5) {
    same = true;
  } else if (reprint) {
    same = false;
  } else if (yearDiff !== undefined && yearDiff > 1 && editionsLikely(ref, rec) && (titleScore < 0.95 || firstAuthor === "mismatch")) {
    // 图书、报告、网页年份差得远时，常是同一作者的另一部作品、新版或转载：题名几乎逐字一致、第一作者也对得上才算同一篇
    same = false;
  } else if (titleMissing) {
    // 有 DOI：第一作者对上，年份或卷号也对上即可；没有 DOI：作者、年份、刊名、卷号、页码都要对上
    same = firstAuthor === "match" && (doiMatch
      ? yearOk || volumeHit
      : (authorRatio ?? 0) >= 0.67 && yearOk && venueOk && volumeHit && pageHit);
  } else if (tokenCount(main) <= 2) {
    // "Deep learning" 这类极短题名太容易撞车：第一作者要出现在引文里，并且年份或期刊对得上
    same = strongTitle && ((firstAuthor === "match" && (yearOk || venueOk)) || ((authorRatio ?? 0) >= 0.67 && yearOk && venueOk));
  } else if (noAuthors) {
    same = titleScore >= 0.85 && (yearOk || venueOk);
  } else {
    // 长题名几乎逐字一致时，即使作者写错也认定为同一篇（大模型常把真题名配上假作者）
    same = (strongTitle && (authorOk || (yearOk && venueOk))) || (titleScore >= 0.92 && tokenCount(main) >= 6);
  }
  // 知网、万方的网页结果没有作者：大模型常把真题名配上假作者，作者核对不了就不能认定是同一篇，最多是相近候选
  if (rec.source === "web" && noAuthors) same = false;
  const partial = !same && !reprint && titleScore >= 0.6 && (authorOk || noAuthors) && (yearDiff === undefined || yearDiff <= 2);

  return {
    titleScore, titleMissing, authorRatio, firstAuthor, authorOrderOk, authorListMismatch, authorsReordered, yearDiff, volumeHit, pageHit,
    venueScore, venueCited, doiMatch, composite, same, partial,
  };
}

export function formatAuthorsShort(authors: Author[], max = 6): string {
  const names = authors.slice(0, max).map((a) => {
    if (isCjk(a.family[0])) return compact(a.family + (a.given ?? ""));
    const initials = (a.given ?? "")
      .split(/[\s.\-]+/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase())
      .join("");
    return initials ? `${a.family} ${initials}` : a.family;
  });
  return names.join(", ") + (authors.length > max ? " 等" : "");
}

export function fieldChecks(ref: ParsedRef, rec: WorkRecord, s: MatchScore): FieldCheck[] {
  const checks: FieldCheck[] = [];

  checks.push({
    field: "title",
    status: s.titleMissing ? "missing" : s.titleScore >= 0.9 ? "match" : s.titleScore >= 0.6 ? "partial" : "mismatch",
    cited: ref.titleGuess,
    actual: rec.subtitle ? `${rec.title}: ${rec.subtitle}` : rec.title,
  });

  checks.push({
    field: "authors",
    status:
      s.authorRatio === undefined
        ? "missing"
        : s.authorsReordered
          ? "partial"
          : s.firstAuthor === "match" && s.authorListMismatch !== true && s.authorOrderOk !== false
          && (s.authorRatio >= 0.5 || s.authorListMismatch === false)
          ? "match"
          : s.authorRatio > 0
            ? "partial"
            : "mismatch",
    cited: ref.authorsGuess,
    actual: rec.authors.length ? formatAuthorsShort(rec.authors) : undefined,
  });

  checks.push({
    field: "year",
    status: s.yearDiff === undefined ? "missing" : s.yearDiff === 0 ? "match" : s.yearDiff === 1 || yearVaries(ref, rec) ? "partial" : "mismatch",
    cited: ref.year?.toString(),
    actual: recordYears(rec).join(" / ") || undefined,
  });

  if (rec.venue) {
    checks.push({
      field: "venue",
      status:
        s.venueScore === undefined
          ? "missing"
          : s.venueScore >= 0.75
            ? "match"
            : !s.venueCited || s.venueScore >= 0.6
              ? "partial"
              : "mismatch",
      cited: ref.venueGuess,
      actual: rec.venue,
    });
  }

  if (ref.doi || rec.doi) {
    checks.push({
      field: "doi",
      status: !ref.doi ? "missing" : !rec.doi ? "missing" : s.doiMatch ? "match" : "mismatch",
      cited: ref.doi,
      actual: rec.doi,
    });
  }
  return checks;
}
