// 隐藏文字与隐藏提示词检测。PDF / DOCX 解析器把“读者看不见”的文字用标记包起来，这里统一：
// 1. 取出标记，得到隐藏片段；2. 判断片段像不像写给 AI 的指令；3. 决定报告哪些、从导入文字中去掉哪些。
// 另外处理所有格式都可能出现的 Unicode 隐形标签字符（把 ASCII 指令编码成看不见的字符）。
// 只做提示，不判断作者意图：深色背景上的白字、扫描件的 OCR 文字层都是正常排版，规则里尽量避开。

/** 解析器插入的标记，使用 Unicode 规定永不分配的非字符，导入前先清除原文里的同类字符 */
export const HIDDEN_MARK = { start: "\uFDD0", end: "\uFDD1" } as const;
const MASK_BASE = 0xfde0;
const MARKS_RE = /[\uFDD0-\uFDEF]/g;
const MARK_CHAR = /[\uFDD0-\uFDEF]/;

export type HiddenTechnique = "white" | "invisible" | "tiny" | "offpage" | "unicode";
const BITS: [HiddenTechnique, number][] = [["white", 1], ["invisible", 2], ["tiny", 4], ["offpage", 8]];

/** 传给 PDF 解析 worker 的同一套标记约定 */
export const HIDDEN_WORKER_DATA = { ...HIDDEN_MARK, base: MASK_BASE, bits: Object.fromEntries(BITS) } as const;

export interface HiddenTextFinding {
  techniques: HiddenTechnique[];
  /** PDF 页码（从“[第 n 页]”标题推出）；DOCX、TXT 没有 */
  page?: number;
  /** 片段原文，最多 400 字符 */
  text: string;
  /** 片段的非空白字符数 */
  chars: number;
  /** 像不像写给 AI 的指令 */
  instruction: boolean;
}

export interface HiddenTextReport {
  /** 最多 20 条，像指令的排在前面 */
  findings: HiddenTextFinding[];
  total: number;
  instructions: number;
}

/** 用标记包住一段隐藏文字；mask 是 BITS 中的位组合 */
export function markHidden(text: string, techniques: HiddenTechnique[]): string {
  const mask = techniques.reduce((sum, t) => sum | (BITS.find(([name]) => name === t)?.[1] ?? 0), 0);
  if (!mask || !text) return text;
  return HIDDEN_MARK.start + String.fromCharCode(MASK_BASE + mask) + text + HIDDEN_MARK.end;
}

/** 清掉原文中可能冒充标记的非字符（正常文本不会出现） */
export function stripMarks(text: string): string {
  return text.replace(MARKS_RE, "");
}

interface HiddenRange { start: number; end: number; techniques: HiddenTechnique[] }

/**
 * 取出标记：返回去掉标记的文字，以及每段隐藏文字在新文字中的位置（嵌套时隐藏方式取并集）。
 * 同一种隐藏方式、只隔着空白的相邻片段合成一段（逐行打标记的一段话）；方式不同或隔着空行就分开。
 * 每段从第一个、到最后一个非空白字符为止。
 */
export function extractHiddenRanges(marked: string): { text: string; ranges: HiddenRange[] } {
  let text = "";
  const stack: number[] = [];
  const ranges: HiddenRange[] = [];
  let open: { start: number; end: number; mask: number } | null = null;
  const flush = () => {
    if (open) ranges.push({ start: open.start, end: open.end, techniques: BITS.filter(([, bit]) => open!.mask & bit).map(([name]) => name) });
    open = null;
  };
  for (let i = 0; i < marked.length; i++) {
    const ch = marked[i];
    if (ch === HIDDEN_MARK.start) {
      const code = marked.charCodeAt(i + 1) - MASK_BASE;
      stack.push(code >= 0 && code < 16 ? code : 0);
      i++;
      continue;
    }
    if (ch === HIDDEN_MARK.end) { stack.pop(); continue; }
    if (MARK_CHAR.test(ch)) continue;
    const mask = stack.reduce((sum, bit) => sum | bit, 0);
    if (!/\s/.test(ch)) {
      if (mask) {
        if (open && (open.mask !== mask || /\n[^\S\n]*\n/.test(text.slice(open.end)))) flush();
        if (open) open.end = text.length + 1;
        else open = { start: text.length, end: text.length + 1, mask };
      } else flush();
    }
    text += ch;
  }
  flush();
  return { text, ranges };
}

const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

const EN_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|preceding|all|any|other|existing)\b[^.]{0,30}\b(instruction|prompt|direction|guideline|rule|context|command)s?\b/,
  /\b(give|write|provide|generate|produce|output|leave)\b[^.]{0,30}\b(positive|favou?rable|glowing|good|high|excellent)\b[^.]{0,20}\b(review|rating|score|assessment|evaluation|feedback)s?\b/,
  /\b(do not|don't|never|avoid|without)\b[^.]{0,20}\b(highlight|mention|point(ing)? out|discuss|critici[sz]e|list|note|report)\w*\b[^.]{0,30}\b(negatives?|weakness(es)?|limitations?|flaws?|shortcomings?|criticisms?|drawbacks?)\b/,
  /\b(recommend|suggest)\w*\b[^.]{0,40}\b(accept\w*|publication)\b[^.]{0,40}\b(paper|manuscript|submission|article|work)\b/,
  /\b(paper|manuscript|submission|article)\b[^.]{0,40}\b(should|must) be (accepted|published)\b/,
  /\b(you are|act as|pretend to be|if you are|as an?) (an? )?(ai|llm|large language model|language model|chatbot|ai assistant|ai reviewer|automated reviewer)\b/,
  /\b(llm|ai|chatgpt|gpt-?\d\w*|claude|gemini|copilot|deepseek)s?\b[^.]{0,40}\b(must|should|shall|please|need to|are instructed to)\b/,
  /\b(rate|score) (this|the) (paper|manuscript|submission|work)\b/,
  /\b(new|updated|system|hidden|secret) (instructions?|prompt)\b/,
  /\[\/?inst\]|<\|im_(start|end)\|>|<\/?system>/,
];
const ZH_PATTERNS = [
  /(忽略|无视|忘记|忘掉|不要理会|覆盖)(之前|以上|前面|上面|上述|先前|此前|所有|全部|其他|其它)?(的)?(所有|全部|任何)?(指令|指示|提示|要求|规则|设定)/,
  /(给出|给予|写出|写|提供|生成|输出)(一[个份篇条段])?(正面|积极|良好|很好|好|高|满)(的)?(评价|评审|评论|评分|分数|分|审稿意见|意见)/,
  /(不要|不得|切勿|别|无需|不必)(提及|指出|强调|提到|列出|说明|讨论|批评)(任何|本文的?|论文的?)?(缺点|不足|问题|局限|弱点|负面|瑕疵)/,
  /(推荐|建议)(录用|接收|接受|发表)/,
  /(你是|作为|假如你是|如果你是|扮演)(一[个名位])?(ai|人工智能|大模型|大语言模型|语言模型|审稿人|评审人|评审专家|助手|chatgpt|deepseek)/,
  /(新的?|系统|隐藏)(指令|提示词)/,
  /(给|为)(本文|这篇论文|该论文|本论文)(打|评)(满分|高分|\d+分)/,
];

/** 传给 PDF 解析 worker 的同一套指令规则：扫描件 OCR 文字层里像指令的行仍要报告，worker 按与 looksLikeInstruction 相同的方式匹配 */
export const INSTRUCTION_WORKER_DATA = {
  en: EN_PATTERNS.map(re => [re.source, re.flags]),
  zh: ZH_PATTERNS.map(re => [re.source, re.flags]),
} as const;

/** 片段像不像写给 AI 的指令（只对隐藏文字使用，不对正文做判断） */
export function looksLikeInstruction(text: string): boolean {
  const s = squash(text);
  if (EN_PATTERNS.some(re => re.test(s))) return true;
  const compact = s.replace(/\s+/g, "");
  return ZH_PATTERNS.some(re => re.test(compact));
}

/** Unicode 标签字符 U+E0000–U+E007F：可把 ASCII 指令编码成看不见的字符 */
const TAG_RUN_RE = /[\u{E0000}-\u{E007F}]+/gu;
/** 零宽字符：常用来拆开关键词逃避检查；ZWJ / ZWNJ 在部分文字和表情里有用，不动 */
const ZERO_WIDTH_RE = /[\u200B\u2060-\u2064\uFEFF\u180E]/g;

/** PDF 文字里每页以“[第 n 页]”开头；返回按位置查页码的函数 */
function pageLookup(text: string): (index: number) => number | undefined {
  const headers = [...text.matchAll(/\[第 (\d+) 页\]\n/g)].map(m => ({ at: m.index, page: Number(m[1]) }));
  return index => {
    let page: number | undefined;
    for (const header of headers) {
      if (header.at > index) break;
      page = header.page;
    }
    return page;
  };
}

function finding(text: string, techniques: HiddenTechnique[], page: number | undefined): HiddenTextFinding {
  const trimmed = text.trim();
  return {
    techniques,
    ...(page === undefined ? {} : { page }),
    text: trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed,
    chars: trimmed.replace(/\s+/g, "").length,
    instruction: looksLikeInstruction(trimmed),
  };
}

/** 报告规则：像指令的一律报告；只是白字的，短于 40 字视为深色背景上的正常排版；其余隐藏方式短于 12 字视为图表小字等噪声 */
function reportable(f: HiddenTextFinding): boolean {
  if (f.instruction) return true;
  if (f.techniques.length === 1 && f.techniques[0] === "white") return f.chars >= 40;
  return f.chars >= 12;
}

export interface HiddenTextResult {
  text: string;
  hidden: HiddenTextReport | null;
  warnings: string[];
}

/**
 * 处理解析器输出：取出隐藏标记，报告并删除应当报告的隐藏片段，再去掉 Unicode 隐形字符。
 * extras 是解析器看到、但不在提取文字里的隐藏片段（例如 PDF.js 没有输出的文字），只报告。
 */
export function applyHiddenText(marked: string, extras: { text: string; techniques: HiddenTechnique[]; page?: number }[] = []): HiddenTextResult {
  const { text: unmarked, ranges } = extractHiddenRanges(marked);
  const findings: HiddenTextFinding[] = [];
  const removals: HiddenRange[] = [];
  const pageOf = pageLookup(unmarked);
  for (const range of ranges) {
    const f = finding(unmarked.slice(range.start, range.end), range.techniques, pageOf(range.start));
    if (!f.chars || !reportable(f)) continue;
    findings.push(f);
    removals.push(range);
  }
  for (const extra of extras) {
    const f = finding(extra.text, extra.techniques, extra.page);
    if (f.chars && reportable(f)) findings.push(f);
  }
  let text = unmarked;
  for (const range of removals.sort((a, b) => b.start - a.start)) {
    const before = text[range.start - 1] ?? "\n";
    let end = range.end;
    // 两边都是空格时吃掉一个，免得留下双空格；夹在两段英文之间才补一个空格
    if (/[ \t]/.test(before) && /[ \t]/.test(text[end] ?? "")) end++;
    const after = text[end] ?? "\n";
    const glue = text.slice(range.start, range.end).includes("\n") ? "\n" : /[\w.,;:!?)\]]/.test(before) && /[\w(\[]/.test(after) ? " " : "";
    text = text.slice(0, range.start) + glue + text.slice(end);
  }

  // Unicode 标签字符：解码出隐藏的 ASCII 文字再删除
  const tagPageOf = pageLookup(text);
  for (const match of text.matchAll(TAG_RUN_RE)) {
    const decoded = [...match[0]].map(ch => ch.codePointAt(0)! - 0xe0000).filter(code => code >= 0x20 && code <= 0x7e).map(code => String.fromCharCode(code)).join("");
    const f = finding(decoded, ["unicode"], tagPageOf(match.index));
    if (f.chars) findings.push(f);
  }
  text = text.replace(TAG_RUN_RE, "");
  const warnings: string[] = [];
  const zeroWidth = text.match(ZERO_WIDTH_RE)?.length ?? 0;
  if (zeroWidth) {
    text = text.replace(ZERO_WIDTH_RE, "");
    warnings.push(`已去掉 ${zeroWidth} 个零宽字符（看不见，可能用来拆开关键词）。`);
  }

  if (!findings.length) return { text, hidden: null, warnings };
  findings.sort((a, b) => Number(b.instruction) - Number(a.instruction));
  return {
    text,
    hidden: { findings: findings.slice(0, 20), total: findings.length, instructions: findings.filter(f => f.instruction).length },
    warnings,
  };
}
