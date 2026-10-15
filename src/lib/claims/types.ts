/** Shared wire types. This file contains no server configuration or credentials. */
export type ClaimVerdict = "supported" | "partially_supported" | "contradicted" | "insufficient_evidence";
export type ClaimErrorCode = "CONFIGURATION" | "NO_EVIDENCE" | "SOURCE_UNAVAILABLE" | "MODEL_UNAVAILABLE" | "INVALID_MODEL_RESPONSE" | "TIMEOUT" | "CANCELLED";

export interface ClaimInput {
  claim: string;
  /** DOI and evidenceText are mutually exclusive. Only allowlisted databases are fetched. */
  doi?: string;
  evidenceText?: string;
  evidenceLabel?: string;
}

export interface ClaimSource {
  id: string;
  kind: "crossref_abstract" | "openalex_abstract" | "user_provided";
  label: string;
  title?: string;
  doi?: string;
  url?: string;
  retrievedAt: string;
  /** User material is not independently authenticated. Abstracts are never full text. */
  scope: "abstract" | "user_provided_text";
  totalChars: number;
}

export interface EvidenceChunk {
  id: string;
  sourceId: string;
  text: string;
  /** Zero-based UTF-16 offsets into the normalized source text, [start, end). */
  start: number;
  end: number;
  score: number;
}

export interface ClaimCitation {
  sourceId: string;
  chunkId: string;
  quote: string;
  /** Exact quote location in the normalized source, [start, end). */
  start: number;
  end: number;
}

export interface ClaimResult {
  status: "complete" | "incomplete";
  claim: string;
  /** Null means the check did not finish; it is not an evidence judgment. */
  verdict: ClaimVerdict | null;
  explanation: string;
  citations: ClaimCitation[];
  chunks: EvidenceChunk[];
  source: ClaimSource | null;
  coverage: {
    scope: "abstract" | "user_provided_text" | "none";
    totalChunks: number;
    retrievedChunks: number;
    retrievedChars: number;
    method: "bm25-en-zh-v1";
  };
  warnings: string[];
  model: string | null;
  errorCode?: ClaimErrorCode;
}

export interface ClaimServiceStatus {
  available: boolean;
  provider: "DeepSeek";
  model: string;
  limits: { claimChars: number; evidenceChars: number; retrievedChunks: number };
}
