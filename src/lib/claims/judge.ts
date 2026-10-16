import { unwrapToolArguments } from "../tool-args";
import { ClaimError } from "./errors";
import { record } from "./request";
import type { ClaimCitation, ClaimVerdict, EvidenceChunk } from "./types";

const VERDICTS = new Set<ClaimVerdict>(["supported", "partially_supported", "contradicted", "insufficient_evidence"]);
const invalid = () => new ClaimError("INVALID_MODEL_RESPONSE", "模型结果未通过原文引用与结构校验，本次核查未完成");

function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw invalid();
}

export function validateJudgment(value: unknown, chunks: EvidenceChunk[]): { verdict: ClaimVerdict; explanation: string; citations: ClaimCitation[] } {
  if (!record(value)) throw invalid();
  onlyKeys(value, ["verdict", "explanation", "citations"]);
  if (typeof value.verdict !== "string" || !VERDICTS.has(value.verdict as ClaimVerdict) ||
      typeof value.explanation !== "string" || !value.explanation.trim() || value.explanation.length > 2_000 ||
      !Array.isArray(value.citations) || value.citations.length > 8) throw invalid();
  const citations: ClaimCitation[] = [];
  const seen = new Set<string>();
  for (const citation of value.citations) {
    if (!record(citation)) throw invalid();
    onlyKeys(citation, ["sourceId", "chunkId", "quote"]);
    if (typeof citation.sourceId !== "string" || typeof citation.chunkId !== "string" || typeof citation.quote !== "string" ||
        citation.quote.trim().length < 8 || citation.quote.length > 1_200) throw invalid();
    const chunk = chunks.find((entry) => entry.id === citation.chunkId && entry.sourceId === citation.sourceId);
    const at = chunk?.text.indexOf(citation.quote) ?? -1;
    if (!chunk || at < 0) throw invalid();
    const key = `${chunk.id}:${at}:${citation.quote.length}`;
    if (seen.has(key)) throw invalid();
    seen.add(key);
    citations.push({ sourceId: chunk.sourceId, chunkId: chunk.id, quote: citation.quote, start: chunk.start + at, end: chunk.start + at + citation.quote.length });
  }
  if (value.verdict !== "insufficient_evidence" && citations.length === 0) throw invalid();
  return { verdict: value.verdict as ClaimVerdict, explanation: value.explanation.trim(), citations };
}

export function completionArguments(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.choices) || value.choices.length !== 1 || !record(value.choices[0])) throw invalid();
  const choice = value.choices[0];
  if (choice.finish_reason !== "tool_calls" || !record(choice.message) || choice.message.role !== "assistant" || !Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length !== 1) throw invalid();
  const call = choice.message.tool_calls[0];
  if (!record(call) || call.type !== "function" || typeof call.id !== "string" || !call.id || !record(call.function) || call.function.name !== "judge_claim" || typeof call.function.arguments !== "string" || call.function.arguments.length > 24_000) throw invalid();
  try { return unwrapToolArguments(JSON.parse(call.function.arguments)); } catch { throw invalid(); }
}
