// MCP Server：把参考文献核验和论断核查开放给 Claude、Cursor 等 MCP 客户端。
// 只调用现有引擎：参考文献结论来自数据库逐字段比对，论断判断的引句经过原文校验；客户端传来的内容一律当作数据。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { MAX_CHECK_CHARS, MAX_CHECK_REFS } from "../check-request";
import { checkClaim } from "../claims";
import { createClaimLimits } from "../claims/limits";
import { ClaimRequestError, MAX_CLAIM_CHARS, MAX_EVIDENCE_CHARS } from "../claims/request";
import { VERDICT_META } from "../verdict-meta";
import { parseReferenceList } from "../verify/extract";
import { VERDICTS, type RefResult, type Verdict } from "../verify/types";
import { verifyAll } from "../verify/verify";

const referenceResult = z.object({
  index: z.number().int(),
  raw: z.string(),
  verdict: z.enum(VERDICTS),
  summary: z.string(),
  issues: z.array(z.string()),
  notes: z.array(z.string()),
  matchStatus: z.enum(["confirmed", "candidate"]).optional(),
  match: z.object({
    doi: z.string().optional(),
    title: z.string(),
    year: z.number().int().optional(),
    venue: z.string().optional(),
    source: z.string(),
  }).optional(),
  suggestion: z.string().optional(),
});

function compactResult(r: RefResult): z.infer<typeof referenceResult> {
  return {
    index: r.index, raw: r.raw, verdict: r.verdict, summary: r.summary, issues: r.issues, notes: r.notes,
    matchStatus: r.matchStatus,
    match: r.match ? { doi: r.match.doi, title: r.match.title, year: r.match.year, venue: r.match.venue, source: r.match.source } : undefined,
    suggestion: r.suggestion,
  };
}

const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });

/** 给调用方模型看的纯文本：每条一行结论，问题和规范写法附在下面 */
function referenceReport(results: RefResult[], counts: Record<Verdict, number>): string {
  const head = VERDICTS.filter((v) => counts[v]).map((v) => `${VERDICT_META[v].label} ${counts[v]}`).join("，");
  const lines = [`共 ${results.length} 条：${head}。结论来自 Crossref / doi.org / OpenAlex 的逐字段比对；查不到不等于编造。`
    + (counts.near_match ? "相近候选只是找到了相近的记录、未能确认是同一篇，不算信息有误，需要人工核对。" : "")];
  for (const r of results) {
    const label = VERDICT_META[r.verdict].label;
    lines.push("", `[${r.index}] ${r.summary.startsWith(label) ? r.summary : `${label}：${r.summary}`}`);
    for (const issue of r.issues) lines.push(`  - 问题：${issue}`);
    if (r.match?.doi) lines.push(`  - 数据库 DOI：${r.match.doi}`);
    if (r.suggestion) lines.push(`  - ${r.matchStatus === "candidate" ? "相近候选（未确认同一篇）" : "按数据库记录生成的规范写法"}：${r.suggestion}`);
  }
  return lines.join("\n");
}

export interface ServerOptions {
  /** 单次核验最多发起几次 OpenAlex 题名检索（无 key 时每天额度有限） */
  openalexBudget?: number;
}

export function createCiteCheckupServer(options: ServerOptions = {}): McpServer {
  // 0.2.0：结论新增 near_match（只找到相近候选，不算信息有误）
  const server = new McpServer({ name: "cite-checkup", version: "0.2.0" });
  // 论断核查要调用模型，和网页接口一样限次，防止客户端模型反复调用
  const claimLimits = createClaimLimits();

  server.registerTool("verify_references", {
    title: "核验参考文献",
    description:
      "Check a bibliographic reference list against Crossref, doi.org and OpenAlex. For each entry it returns a rule-based verdict " +
      "(verified, mismatch, near_match, not_found, retracted, concern, unverifiable, error), the problems found, the matched database record " +
      "and a citation generated only from that record. Verdicts come from database lookups and field-by-field comparison, never from " +
      "a language model. 'mismatch' means the same work was confirmed but some fields are wrong, or the cited DOI is unregistered or points " +
      "to another work. 'near_match' means only a similar record was found and it could not be confirmed as the same work: it is not a " +
      "confirmed error, and its citation must not replace the original until a person has checked it. 'not_found' or 'unverifiable' is " +
      "not proof of fabrication (books, theses, web pages and Chinese journals are poorly covered). " +
      `Accepts GB/T 7714, APA, IEEE and similar styles, at most ${MAX_CHECK_REFS} entries. Summaries are in Simplified Chinese.`,
    inputSchema: {
      references: z.string().min(1).max(MAX_CHECK_CHARS)
        .describe("The reference list: one entry per line, or numbered like [1] ... [2] ... or 1. ... 2. ..."),
    },
    outputSchema: {
      total: z.number().int(),
      counts: z.record(z.string(), z.number().int()),
      results: z.array(referenceResult),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  }, async ({ references }, extra) => {
    const refs = parseReferenceList(references);
    if (!refs.length) return failure("没有识别到参考文献条目，请每条一行，或用 [1]、1. 这类序号分隔。");
    if (refs.length > MAX_CHECK_REFS) return failure(`单次最多核验 ${MAX_CHECK_REFS} 条，当前识别到 ${refs.length} 条。`);
    const results: RefResult[] = [];
    const progressToken = extra._meta?.progressToken;
    await verifyAll(refs, (result) => {
      results.push(result);
      if (progressToken !== undefined) {
        void extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress: results.length, total: refs.length, message: `[${result.index}] ${result.summary}` },
        }).catch(() => {});
      }
    }, { concurrency: 3, openalexBudget: options.openalexBudget ?? 20, signal: extra.signal });
    extra.signal.throwIfAborted();
    results.sort((a, b) => a.index - b.index);
    const counts = Object.fromEntries(VERDICTS.map((v) => [v, results.filter((r) => r.verdict === v).length])) as Record<Verdict, number>;
    return {
      content: [{ type: "text", text: referenceReport(results, counts) }],
      structuredContent: { total: results.length, counts, results: results.map(compactResult) },
    };
  });

  server.registerTool("check_claim", {
    title: "核查论断证据",
    description:
      "Assess whether ONE claim from a manuscript is supported by ONE specific source: a DOI, or source text you provide. For a DOI " +
      "it reads the open-access full text from Europe PMC (JATS) or arXiv when available, otherwise the Crossref/OpenAlex abstract; " +
      "source.scope in the result says which was used. Short material is searched with BM25; long material with BM25 plus " +
      "model-expanded Chinese/English query terms, merged by reciprocal rank fusion and reranked by the model to 6 passages. " +
      "DeepSeek then returns supported, partially_supported, contradicted or insufficient_evidence, and every quotation is verified " +
      "verbatim against the retrieved passages. Only the retrieved passages are judged, not the whole paper; it does not establish " +
      "scientific truth. Provide exactly one of doi or evidence_text. The explanation is in Simplified Chinese.",
    inputSchema: {
      claim: z.string().min(1).max(MAX_CLAIM_CHARS).describe("One claim sentence from the manuscript."),
      doi: z.string().max(2_048).optional().describe("DOI or doi.org link of the cited work; its open-access full text is used when available, otherwise its abstract."),
      evidence_text: z.string().max(MAX_EVIDENCE_CHARS).optional().describe("Source text to check against, instead of a DOI."),
      evidence_label: z.string().max(200).optional().describe("Optional short name of the provided source text."),
    },
    outputSchema: {
      status: z.enum(["complete", "incomplete"]),
      verdict: z.enum(["supported", "partially_supported", "contradicted", "insufficient_evidence"]).nullable(),
      explanation: z.string(),
      citations: z.array(z.object({ quote: z.string(), start: z.number().int(), end: z.number().int() })),
      source: z.object({ kind: z.string(), label: z.string(), title: z.string().optional(), doi: z.string().optional(), scope: z.string() }).nullable(),
      warnings: z.array(z.string()),
      model: z.string().nullable(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ claim, doi, evidence_text, evidence_label }, extra) => {
    const slot = claimLimits.reserve(claim.length + 7_200);
    if (slot.error) return failure(slot.error);
    try {
      const result = await checkClaim(
        { claim, ...(doi !== undefined ? { doi } : {}), ...(evidence_text !== undefined ? { evidenceText: evidence_text } : {}), ...(evidence_label ? { evidenceLabel: evidence_label } : {}) },
        { signal: extra.signal },
      );
      const structured = {
        status: result.status, verdict: result.verdict, explanation: result.explanation,
        citations: result.citations.map(({ quote, start, end }) => ({ quote, start, end })),
        source: result.source ? { kind: result.source.kind, label: result.source.label, title: result.source.title, doi: result.source.doi, scope: result.source.scope } : null,
        warnings: result.warnings, model: result.model,
      };
      if (result.status !== "complete") {
        return { isError: true, content: [{ type: "text", text: result.explanation || "论断证据核查未完成。" }], structuredContent: structured };
      }
      const quotes = result.citations.map((c, i) => `  ${i + 1}. “${c.quote}”`);
      const text = [`判断：${result.verdict}`, result.explanation, ...(quotes.length ? ["原文引句：", ...quotes] : []), `范围：${result.source?.label ?? ""}`, ...result.warnings.map((w) => `注意：${w}`)].join("\n");
      return { content: [{ type: "text", text }], structuredContent: structured };
    } catch (error) {
      extra.signal.throwIfAborted();
      if (error instanceof ClaimRequestError) return failure(error.message);
      throw error;
    } finally {
      slot.release?.();
    }
  });

  return server;
}
