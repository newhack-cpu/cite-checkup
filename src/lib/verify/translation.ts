// 中文期刊引文常附英文译名（“王某, 李某. 中文题名[J]. 刊名, 2020, 1(2): 3-4. (Wang M, Li H. English title[J]. ...)”），
// 或反过来英文在前、方括号里附中文原文。两段说的是同一篇，拼音作者应与汉字作者逐一对应。
// 这里只在引文内部比对两段作者：拼音整组换成了另一批人（“杨敏, 赵现朝” 对 “Zhang Z B, Yang Y”）时，引文本身就自相矛盾，不需要查数据库。
// 只用于服务端核验模块。
import { pinyin } from "pinyin-pro";
import { parseReference } from "./extract";
import { hanFamilyLength, romanizeHanName } from "./romanize";
import type { Author, ParsedRef } from "./types";

export interface TranslationAuthorConflict {
  /** 中文段的汉字作者 */
  han: string[];
  /** 译名里的拼音作者 */
  latin: string[];
  /** 在汉字作者和数据库记录作者里都找不到对应的人的拼音作者 */
  unmatched: string[];
}

const CLOSE = ")）]］";

/** 引文末尾一对括号里的内容和括号前面的部分；括号可以嵌套（译名里常有“(2011–2020)[J]”） */
export function splitTrailingGroup(raw: string): { outer: string; inner: string } | undefined {
  const s = raw.trim().replace(/[.。]\s*$/, "").trimEnd();
  const last = CLOSE.indexOf(s.at(-1) ?? "");
  if (last < 0) return undefined;
  // 圆括号一族、方括号一族各自配对
  const round = last < 2;
  const opens = round ? "(（" : "[［";
  const closes = round ? ")）" : "]］";
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (closes.includes(s[i])) depth++;
    else if (opens.includes(s[i]) && --depth === 0) {
      const outer = s.slice(0, i).trim();
      const inner = s.slice(i + 1, -1).trim();
      return outer && inner ? { outer, inner } : undefined;
    }
  }
  return undefined;
}

const hanCount = (s?: string) => s?.match(/\p{Script=Han}/gu)?.length ?? 0;
const ET_AL = /^(?:et\.?\s*al\.?|等人?)$/i;

function splitAuthors(authorsGuess?: string): string[] {
  return (authorsGuess ?? "").split(/\s*[,，、;；]\s*/).map((s) => s.trim()).filter((s) => s && !ET_AL.test(s));
}

/** 全是 2–4 字汉字姓名时返回姓名列表，否则 undefined */
function hanAuthors(ref: ParsedRef): string[] | undefined {
  const names = splitAuthors(ref.authorsGuess).map((s) => s.replace(/\s+/g, ""));
  return names.length && names.every((n) => /^\p{Script=Han}{2,4}$/u.test(n)) ? names : undefined;
}

/** 全是拉丁字母写的人名（“Liu Z H”“Huang Xiaodong”“Lü G C”）时返回列表，否则 undefined。
 * 解析器认不出全拼姓名（“Huang Xiaodong, Ding Wensi”）时，取题名前面那段 */
function latinAuthors(ref: ParsedRef, text: string): string[] | undefined {
  const at = ref.titleGuess ? text.indexOf(ref.titleGuess) : -1;
  const segment = ref.authorsGuess || (at > 0 ? text.slice(0, at).replace(/[\s.。,，:：]+$/, "") : "");
  const names = splitAuthors(segment);
  return names.length && names.every((n) => /^[\p{Script=Latin}'’.-]+(?:\s+[\p{Script=Latin}'’.-]+)*$/u.test(n)) ? names : undefined;
}

/** 去声调、ü/v/yu 统一成 u，只留小写字母 */
function plain(s: string): string {
  const t = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
  return t === "lv" || t === "lyu" ? "lu" : t === "nv" || t === "nyu" ? "nu" : t;
}

/** 一个汉字的全部读音（多音字姓氏：单 dan/shan/chan，曾 ceng/zeng） */
function readings(ch: string): string[] {
  return pinyin(ch, { toneType: "none", type: "array", multiple: true, v: false }).map(plain).filter(Boolean);
}

/** 港台或威妥玛拼法（Hsu、Tsai、Chung、Ch'en）不是汉语拼音，没法按读音比，遇到就整条不比 */
const NON_PINYIN = /hs|ts|tz|'|’|ung$|ieh$|^kw/i;

/**
 * 汉字姓名和拼音写法是否可能是同一个人：姓的读音一致，名的首字母一致（拼音只写缩写时）。
 * 返回 undefined 表示没法比（转不了拼音、不是汉语拼音拼法）
 */
function nameFits(han: string, latin: string): boolean | undefined {
  const roman = romanizeHanName(han);
  if (!roman) return undefined;
  const words = latin.split(/[\s.]+/).filter(Boolean);
  if (!words.length || words.some((w) => NON_PINYIN.test(w))) return undefined;
  const familyChars = hanFamilyLength(han);
  const families = new Set(familyChars === 1 ? [plain(roman.family), ...readings(han[0])] : [plain(roman.family)]);
  const givenChar = han[familyChars];
  const initials = new Set([plain(roman.given ?? "")[0], ...(givenChar ? readings(givenChar).map((r) => r[0]) : [])].filter(Boolean));
  // 姓在前（Liu Z H、Huang Xiaodong）或姓在后（Xiaodong Huang）都试
  const orders: [string, string[]][] = [[words[0], words.slice(1)]];
  if (words.length > 1) orders.push([words[words.length - 1], words.slice(0, -1)]);
  return orders.some(([family, given]) => {
    if (!families.has(plain(family))) return false;
    const first = plain(given[0] ?? "")[0];
    return !first || !initials.size || initials.has(first);
  });
}

/** 拼音写法和数据库里的拉丁字母作者（Crossref 登记的拼音）是否可能是同一人 */
function latinFits(rec: Author, latin: string): boolean | undefined {
  const words = latin.split(/[\s.]+/).filter(Boolean);
  if (!words.length || words.some((w) => NON_PINYIN.test(w))) return undefined;
  const family = plain(rec.family);
  const initial = plain(rec.given ?? "")[0];
  if (!family) return undefined;
  const orders: [string, string[]][] = [[words[0], words.slice(1)]];
  if (words.length > 1) orders.push([words[words.length - 1], words.slice(0, -1)]);
  return orders.some(([f, given]) => plain(f) === family && (!initial || !given.length || plain(given[0])[0] === initial));
}

/**
 * 引文附有另一语种的译名、且译名里的拼音作者大多找不到对应的人时返回冲突详情；没有译名、比不了或对得上时返回 undefined。
 * 拼音作者在中文段的汉字作者或数据库记录的作者（recordAuthors，要求是已确认的同一篇）里找得到同一人就算对上，不看位置：
 * 期刊给的英文著录有时换了作者顺序（科学通报 2013, 58(21) 中文列程邦波在前，英文列徐冠华在前），两段又都只写前三位加“等”。
 * 判“对不上”要过半数找不到：多音字、个别拼法差异只错一两个，不会触发
 */
export function translationAuthorConflict(ref: ParsedRef, recordAuthors: Author[] = []): TranslationAuthorConflict | undefined {
  const group = splitTrailingGroup(ref.raw);
  if (!group) return undefined;
  const sides = [group.outer, group.inner].map((text) => {
    const p = parseReference(text, ref.index);
    const han = hanCount(p.titleGuess) >= 4 ? hanAuthors(p) : undefined;
    const latin = hanCount(p.titleGuess) === 0 && (p.titleGuess?.length ?? 0) >= 8 ? latinAuthors(p, text) : undefined;
    return { p, han, latin };
  });
  const zh = sides.find((s) => s.han);
  const en = sides.find((s) => s.latin && s !== zh);
  if (!zh?.han || !en?.latin) return undefined;
  // 年份都写了却不同，说明括号里不是这一篇的译名
  if (zh.p.year && en.p.year && zh.p.year !== en.p.year) return undefined;
  const hanPool = [...zh.han, ...recordAuthors.filter((a) => /\p{Script=Han}/u.test(a.family)).map((a) => `${a.family}${a.given ?? ""}`.replace(/\s+/g, ""))];
  const latinPool = recordAuthors.filter((a) => !/\p{Script=Han}/u.test(a.family));
  const unmatched: string[] = [];
  for (const latin of en.latin) {
    const verdicts = [...hanPool.map((h) => nameFits(h, latin)), ...latinPool.map((a) => latinFits(a, latin))];
    // 拼法不是汉语拼音（港台、威妥玛）：整条不比
    if (latin.split(/[\s.]+/).some((w) => NON_PINYIN.test(w))) return undefined;
    if (!verdicts.some((v) => v === true)) unmatched.push(latin);
  }
  return unmatched.length * 2 > en.latin.length ? { han: zh.han, latin: en.latin, unmatched } : undefined;
}
