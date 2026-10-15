import type { EvidenceChunk } from "./types";

export const MAX_RETRIEVED_CHUNKS = 6;
const MAX_CHUNK_CHARS = 1_200;
const OVERLAP_CHARS = 160;
const STOP_WORDS = new Set("a an and are as at be been but by can did do does for from had has have how if in into is it its may of on or our that the their these they this those to was were what when where which who will with would".split(" "));

/** Preserve content; normalize only layout and invisible control characters. */
export function normalizeEvidence(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
}

/** Deterministic overlapping windows, preferring nearby paragraph/sentence ends. */
export function chunkEvidence(text: string, sourceId: string): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, text.length);
    if (end < text.length) {
      const tail = text.slice(start + 720, end);
      const matches = [...tail.matchAll(/\n|[。！？.!?](?:\s|$)/g)];
      const last = matches.at(-1);
      if (last?.index !== undefined) end = start + 720 + last.index + last[0].length;
      // Do not split a UTF-16 surrogate pair.
      if (/^[\uDC00-\uDFFF]$/.test(text[end] ?? "")) end--;
    }
    chunks.push({ id: `${sourceId}-c${chunks.length + 1}`, sourceId, text: text.slice(start, end), start, end, score: 0 });
    if (end === text.length) break;
    start = end - OVERLAP_CHARS;
    if (/^[\uDC00-\uDFFF]$/.test(text[start] ?? "")) start--;
  }
  return chunks;
}

function terms(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const result = (normalized.match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? []).filter((word) => !STOP_WORDS.has(word));
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    const chars = [...run];
    if (chars.length === 1) result.push(chars[0]);
    for (let i = 0; i + 1 < chars.length; i++) result.push(chars[i] + chars[i + 1]);
  }
  return result;
}

/** BM25 over an in-memory per-request index, with English words and Han bigrams. */
export function retrieveEvidence(claim: string, chunks: EvidenceChunk[]): EvidenceChunk[] {
  if (!chunks.length) return [];
  const query = [...new Set(terms(claim))];
  if (!query.length) return [];
  const docs = chunks.map((chunk) => {
    const words = terms(chunk.text);
    const frequencies = new Map<string, number>();
    for (const term of words) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    return { chunk, length: words.length, frequencies };
  });
  const average = Math.max(1, docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length);
  const idfs = new Map(query.map((term) => {
    const found = docs.filter((doc) => doc.frequencies.has(term)).length;
    return [term, Math.log(1 + (docs.length - found + 0.5) / (found + 0.5))];
  }));
  return docs.map(({ chunk, length, frequencies }) => {
    let score = 0;
    for (const term of query) {
      const count = frequencies.get(term) ?? 0;
      if (count) score += (idfs.get(term) ?? 0) * (count * 2.2) / (count + 1.2 * (0.25 + 0.75 * length / average));
    }
    return { ...chunk, score: Math.round(score * 1_000_000) / 1_000_000 };
  }).filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, MAX_RETRIEVED_CHUNKS);
}
