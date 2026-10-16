// 汉字姓名转拼音，只用于作者比对：中文引文对拼音作者记录（窦杰 ↔ Dou J），或拼音引文对汉字记录。
// 依赖 pinyin-pro 的姓氏读音（曾 zeng、单 shan、解 xie）；只在服务端的比对模块里引入，不进前端包。
import { pinyin } from "pinyin-pro";
import type { Author } from "./types";

const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容", "长孙", "宇文", "司徒", "夏侯",
  "令狐", "端木", "南宫", "西门", "独孤", "万俟", "闻人", "呼延", "澹台", "申屠", "淳于", "轩辕", "钟离",
]);
const HAN_NAME_RE = /^\p{Script=Han}{2,4}$/u;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "窦杰" → { family: "Dou", given: "Jie" }；"欧阳修" → { family: "Ouyang", given: "Xiu" }。不是 2–4 个汉字时返回 undefined */
export function romanizeHanName(name: string): Author | undefined {
  const s = name.replace(/\s+/g, "");
  if (!HAN_NAME_RE.test(s)) return undefined;
  const syllables = pinyin(s, { toneType: "none", type: "array", surname: "head", v: false }).map((x) => x.replace(/ü/g, "u"));
  if (syllables.length !== s.length || syllables.some((x) => !/^[a-z]+$/.test(x))) return undefined;
  const familyLength = s.length >= 3 && COMPOUND_SURNAMES.has(s.slice(0, 2)) ? 2 : 1;
  return { family: capitalize(syllables.slice(0, familyLength).join("")), given: capitalize(syllables.slice(familyLength).join("")) };
}

/** 汉字作者段转成 Vancouver 写法："窦杰，向子林，许强，等" → "Dou J, Xiang Z, Xu Q, et al"；转不了的片段原样保留 */
export function romanizeHanAuthorList(text: string): string {
  return text
    .split(/\s*[,，、;；]\s*/)
    .filter(Boolean)
    .map((segment) => {
      if (/^等人?$/.test(segment)) return "et al";
      const author = romanizeHanName(segment);
      return author ? `${author.family} ${author.given?.[0] ?? ""}`.trim() : segment;
    })
    .join(", ");
}
