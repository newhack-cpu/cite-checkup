// 文本归一化与相似度计算。中英文混排：英文按词切分，中文按相邻两字（bigram）切分。

const EN_STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "in", "on", "for", "to", "with", "by", "at", "from",
  "as", "via", "is", "are", "its", "into", "vs", "et", "al",
]);

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
const CJK_RUN_RE = /[㐀-䶿一-鿿豈-﫿]+/g;

export function isCjk(ch: string): boolean {
  return CJK_RE.test(ch);
}

/** 字符串中汉字所占比例（忽略空白） */
export function cjkRatio(s: string): number {
  const chars = s.replace(/\s+/g, "");
  if (!chars) return 0;
  const cjk = chars.match(CJK_RUN_RE)?.join("").length ?? 0;
  return cjk / chars.length;
}

/** 去掉 Crossref 题名里常见的 HTML / MathML 标签 */
export function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–" };

/** 解码 Crossref 元数据里残留的 HTML 实体（有的记录被转义了两次，如 &amp;mdash;） */
export function decodeEntities(s: string): string {
  let out = s;
  for (let i = 0; i < 2 && /&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(out); i++) {
    out = out.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
    });
  }
  return out;
}

/**
 * 归一化：全角转半角、去标签、去变音符号、小写、标点换成空格、合并空白。
 * 汉字原样保留。
 */
export function normalizeText(s: string): string {
  return stripTags(s)
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // 这几个字母没有可分解的变音符号，单独换成基本拉丁字母（Małoinwazyjne ↔ Maloinwazyjne）
    .replace(/ł/g, "l").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ı/g, "i")
    .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 切分成用于比对的词元：英文单词（去停用词），中文 bigram */
export function tokenize(s: string): string[] {
  const norm = normalizeText(s);
  const out: string[] = [];
  for (const piece of norm.split(" ")) {
    if (!piece) continue;
    // 一个片段里可能中英文粘在一起，比如 "bert模型"
    const parts = piece.split(/([㐀-䶿一-鿿豈-﫿]+)/);
    for (const part of parts) {
      if (!part) continue;
      if (isCjk(part[0])) {
        if (part.length === 1) out.push(part);
        for (let i = 0; i < part.length - 1; i++) out.push(part.slice(i, i + 2));
      } else if (part.length >= 2 && !EN_STOPWORDS.has(part)) {
        out.push(part);
      } else if (/^\d$/.test(part)) {
        out.push(part);
      }
    }
  }
  return out;
}

export function tokenSet(s: string): Set<string> {
  return new Set(tokenize(s));
}

/** candidate 的词元有多大比例出现在 reference 中（按集合计） */
export function recall(candidate: string, reference: Set<string>): number {
  const toks = new Set(tokenize(candidate));
  if (toks.size === 0) return 0;
  let hit = 0;
  for (const t of toks) if (reference.has(t)) hit++;
  return hit / toks.size;
}

/** Dice 系数：两段文本词元集合的对称相似度 */
export function dice(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function tokenCount(s: string): number {
  return new Set(tokenize(s)).size;
}

/** 撤稿论文在 Crossref 里的题名常带 "RETRACTED:" 前缀，比对前去掉 */
export function stripRetractionPrefix(title: string): string {
  return title.replace(/^\s*(retracted( article)?|withdrawn|retraction)\s*[:：]\s*/i, "");
}

/** 去掉所有空白，用于中文姓名这类不该被空格打断的匹配 */
export function compact(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

/** 只保留字母、数字和汉字，用于化学式这类空格位置不固定的题名比对（W18O49 ↔ W 18 O 49） */
export function alnum(s: string): string {
  return normalizeText(s).replace(/ /g, "");
}

/**
 * 拆开粘连的姓名缩写，只用于作者比对：VizioliL → Vizioli L，MarkiewiczCJ → Markiewicz CJ，AdamsB(2018) → Adams B(2018)。
 * 要求大写缩写后面紧跟分隔符或括号，所以 McDonald、LeCun 这类姓不受影响。
 */
export function deglueNames(s: string): string {
  return s.replace(/(\p{Lu}[\p{Ll}'’-]+)(\p{Lu}{1,3})(?=[\s,.;:(]|$)/gu, "$1 $2");
}
