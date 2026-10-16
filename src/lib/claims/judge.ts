import { unwrapToolArguments } from "../tool-args";
import { ClaimError } from "./errors";
import { record } from "./request";
import type { ClaimCitation, ClaimVerdict, EvidenceChunk } from "./types";

const VERDICTS = new Set<ClaimVerdict>(["supported", "partially_supported", "contradicted", "insufficient_evidence"]);
const invalid = () => new ClaimError("INVALID_MODEL_RESPONSE", "模型结果未通过原文引用与结构校验，本次核查未完成");

function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw invalid();
}

/**
 * 在片段里定位引句，返回原文中的起止位置。先逐字匹配；不行再忽略空白比对——
 * PDF 文字每行末尾都有换行，模型引用时常写成空格（2026-10-16 arXiv 实测 4 次里 4 次如此）。
 * 忽略空白时字符仍须按顺序完全一致，返回的引句取原文那一段，而不是模型写的版本。
 */
function locateQuote(text: string, quote: string): { at: number; end: number } | undefined {
  const exact = text.indexOf(quote);
  if (exact >= 0) return { at: exact, end: exact + quote.length };
  const needle = quote.replace(/\s+/g, "");
  if (needle.length < 8) return undefined;
  // 导入时插入的页标记“[第 n 页]”和紧跟其后的页码行不是原文内容：跨页的句子，模型引用时会略过它们
  const ignored = new Uint8Array(text.length);
  for (const m of text.matchAll(/\[第 \d+ 页\]\n(?:\d{1,4}(?=\n))?/g)) ignored.fill(1, m.index, m.index + m[0].length);
  let skeleton = "";
  const index: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (ignored[i] || /\s/.test(text[i])) continue;
    skeleton += text[i];
    index.push(i);
  }
  const found = skeleton.indexOf(needle);
  return found < 0 ? undefined : { at: index[found], end: index[found + needle.length - 1] + 1 };
}

export function validateJudgment(value: unknown, chunks: EvidenceChunk[]): { verdict: ClaimVerdict; explanation: string; citations: ClaimCitation[] } {
  if (!record(value)) throw invalid();
  onlyKeys(value, ["verdict", "explanation", "citations"]);
  if (typeof value.verdict !== "string" || !VERDICTS.has(value.verdict as ClaimVerdict) ||
      typeof value.explanation !== "string" || !value.explanation.trim() || value.explanation.length > 2_000 ||
      !Array.isArray(value.citations) || value.citations.length > 8) throw invalid();
  let citations: ClaimCitation[] = [];
  for (const citation of value.citations) {
    if (!record(citation)) throw invalid();
    onlyKeys(citation, ["sourceId", "chunkId", "quote"]);
    if (typeof citation.sourceId !== "string" || typeof citation.chunkId !== "string" || typeof citation.quote !== "string" ||
        citation.quote.trim().length < 8 || citation.quote.length > 1_200) throw invalid();
    const chunk = chunks.find((entry) => entry.id === citation.chunkId && entry.sourceId === citation.sourceId);
    const located = chunk ? locateQuote(chunk.text, citation.quote) : undefined;
    if (!chunk || !located) throw invalid();
    const start = chunk.start + located.at;
    const end = chunk.start + located.end;
    // 相邻片段重叠 160 字符，模型可能从两个片段引同一句：按原文位置去重，保留范围更大的那条
    if (citations.some((c) => c.sourceId === chunk.sourceId && c.start <= start && end <= c.end)) continue;
    citations = citations.filter((c) => !(c.sourceId === chunk.sourceId && start <= c.start && c.end <= end));
    citations.push({ sourceId: chunk.sourceId, chunkId: chunk.id, quote: chunk.text.slice(located.at, located.end), start, end });
  }
  if (value.verdict !== "insufficient_evidence" && citations.length === 0) throw invalid();
  // 模型偶尔把说明里的引号多转义一层（\"Even with ...\"），只在说明文字里还原；引句仍须与原文逐字一致
  return { verdict: value.verdict as ClaimVerdict, explanation: value.explanation.replace(/\\"/g, "\"").trim(), citations };
}

export function completionArguments(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.choices) || value.choices.length !== 1 || !record(value.choices[0])) throw invalid();
  const choice = value.choices[0];
  if (choice.finish_reason !== "tool_calls" || !record(choice.message) || choice.message.role !== "assistant" || !Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length !== 1) throw invalid();
  const call = choice.message.tool_calls[0];
  if (!record(call) || call.type !== "function" || typeof call.id !== "string" || !call.id || !record(call.function) || call.function.name !== "judge_claim" || typeof call.function.arguments !== "string" || call.function.arguments.length > 24_000) throw invalid();
  try { return unwrapToolArguments(JSON.parse(call.function.arguments)); } catch { throw invalid(); }
}
