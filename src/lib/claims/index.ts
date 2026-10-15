// Server only. Client components import wire types from ./types instead.
import { ClaimError } from "./errors";
import { withDeadline } from "./io";
import { getClaimStatus, judgeRetrievedEvidence } from "./model";
import { validateClaimInput } from "./request";
import { chunkEvidence, MAX_RETRIEVED_CHUNKS, normalizeEvidence, retrieveEvidence } from "./retrieval";
import { fetchDoiEvidence } from "./sources";
import type { ClaimInput, ClaimResult, ClaimSource } from "./types";

export { getClaimStatus } from "./model";

const COMMON_WARNINGS = [
  "本结果为 AI 对论断与召回文本关系的辅助判断；引句可定位不代表科学结论已获证实，需人工复核。",
  "仅检查本次指定来源，不覆盖跨文献系统检索；检索可能漏召回同义表达、跨语言内容和其他段落中的限制条件。",
];

export async function checkClaim(raw: ClaimInput, options: { signal?: AbortSignal } = {}): Promise<ClaimResult> {
  options.signal?.throwIfAborted();
  const input = validateClaimInput(raw);
  const result: ClaimResult = { status: "incomplete", claim: input.claim, verdict: null, explanation: "", citations: [], chunks: [], source: null,
    coverage: { scope: "none", totalChunks: 0, retrievedChunks: 0, retrievedChars: 0, method: "bm25-en-zh-v1" }, warnings: [...COMMON_WARNINGS], model: null };
  try {
    if (!getClaimStatus().available) throw new ClaimError("CONFIGURATION", "DeepSeek 尚未配置可用的密钥或地址，论断证据核查未完成");
    return await withDeadline(async (signal) => {
      let source: ClaimSource;
      let text: string;
      if (input.doi) {
        const evidence = await fetchDoiEvidence(input.doi, signal);
        source = evidence.source;
        text = evidence.text;
        result.warnings.push(...evidence.warnings, "DOI 模式仅核查 Crossref / OpenAlex 提供的该篇文献摘要；未读取论文全文，摘要通常缺少完整方法、数据与限制。DOI 收录不等于同行评审或质量背书。", "本功能未独立完成撤稿状态核验；请配合参考文献体检与人工审阅使用。");
      } else {
        text = normalizeEvidence(input.evidenceText ?? "");
        source = { id: "source-1", kind: "user_provided", label: input.evidenceLabel || "用户提供的证据正文", retrievedAt: new Date().toISOString(), scope: "user_provided_text", totalChars: text.length };
        result.warnings.push("证据正文由用户提供，来源、真实性与完整性未经数据库核验；判断只对本次提供并召回的文字负责。");
      }
      signal.throwIfAborted();
      result.source = source;
      result.coverage.scope = source.scope;
      const allChunks = chunkEvidence(text, source.id);
      result.coverage.totalChunks = allChunks.length;
      if (!allChunks.length) throw new ClaimError("NO_EVIDENCE", "没有可用的证据正文，本次核查未完成");
      let chunks = retrieveEvidence(input.claim, allChunks);
      // A bounded short document can be fully recalled without lexical matches.
      // This supports translated claims and avoids treating English/Chinese mismatch as a finding.
      if (!chunks.length && allChunks.length <= MAX_RETRIEVED_CHUNKS) {
        chunks = allChunks;
        result.warnings.push("未找到词面匹配；所给材料较短，已将全部片段召回交由模型判断，可能包含跨语言或无关内容。");
      }
      result.chunks = chunks;
      result.coverage.retrievedChunks = chunks.length;
      result.coverage.retrievedChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
      if (!chunks.length) {
        return { ...result, status: "complete", verdict: "insufficient_evidence", explanation: "本次本地检索未召回与论断词面匹配的片段，无法建立支持或矛盾关系。此结果仅说明检索证据不足；可使用与原文相同语言或补充关键词后重试。未调用模型。" };
      }
      const judgment = await judgeRetrievedEvidence(input.claim, source, chunks, signal);
      signal.throwIfAborted();
      return { ...result, ...judgment, status: "complete" };
    }, options.signal, 75_000);
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("证据核查已取消", "AbortError");
    const safe = error instanceof ClaimError ? error : new ClaimError("MODEL_UNAVAILABLE", "证据核查发生错误，本次核查未完成，请稍后重试");
    return { ...result, status: "incomplete", verdict: null, citations: [], explanation: safe.message, errorCode: safe.code, model: null };
  }
}
