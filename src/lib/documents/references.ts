import type { ReferenceSection } from "./types";

export function extractReferenceSection(text: string): ReferenceSection | null {
  const heading = /^(?:\s*(?:\d+(?:\.\d+)*[.、．]?|[一二三四五六七八九十]+[、．.]|第[一二三四五六七八九十\d]+章)\s*)?(参考文献|引用文献|参考资料|references|bibliography|works cited)\s*[:：]?\s*$/gim;
  const matches = [...text.matchAll(heading)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const tail = text.slice(start);
  const endHeading = /^(?:\s*\d+[.、．]?\s*)?(?:附录(?:\s*[A-Z一二三四五六七八九十\d])?|致谢|作者简介|appendix(?:\s+[A-Z\d])?|appendices|acknowledg(?:e)?ments?|supporting information|supplementary (?:material|information))\s*[:：]?\s*$/im.exec(tail);
  const end = endHeading?.index === undefined ? text.length : start + endHeading.index;
  const selected = text.slice(start, end).replace(/^\[第 \d+ 页\]\s*$/gm, "").trim();
  return selected ? { text: selected, heading: match[1], start, end } : null;
}
