import { writeFileSync } from "node:fs";
import { prepareAIReferences } from "../../src/lib/ai/index";

process.loadEnvFile(".env.local");
const input = "[1] LECUN Y, BENGIO Y, HINTON G | Deep learning | Nature | 2015 | DOI: 10.1038/nature14539\n[2] Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Networks, 9(8), 1735–1780. DOI: 10.1162/neco.1997.9.8.1735";
const knownCodes = new Set(["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]);
const originalFetch = globalThis.fetch;
const evidence: unknown[] = [];
globalThis.fetch = async (...args) => {
  const started = Date.now();
  try {
    const response = await originalFetch(...args);
    const body = await response.clone().json().catch(() => null);
    const item = { httpStatus: response.status, ms: Date.now() - started,
      finishReasons: body?.choices?.map((choice: { finish_reason: string }) => ["tool_calls", "stop", "length", "content_filter", "aborted", "insufficient_system_resource"].includes(choice.finish_reason) ? choice.finish_reason : "unknown"),
      toolNames: body?.choices?.flatMap((choice: { message?: { tool_calls?: { function?: { name: string } }[] } }) => choice.message?.tool_calls?.map((call) => call.function?.name === "verify_references" ? "verify_references" : "unknown")),
    };
    evidence.push(item);
    console.log(JSON.stringify(item));
    return response;
  } catch (error) {
    const rawCode = (error as { cause?: { code?: string } }).cause?.code;
    const item = { transport: "failed", code: rawCode && knownCodes.has(rawCode) ? rawCode : "UNKNOWN", ms: Date.now() - started };
    evidence.push(item);
    console.log(JSON.stringify(item));
    throw error;
  }
};
for (let attempt = 1; attempt <= 2; attempt++) {
  const started = Date.now();
  try {
    const result = await prepareAIReferences(input);
    const item = { attempt, result: "success", refs: result.refs.length, filledTitle: Boolean(result.refs[0].titleGuess), ms: Date.now() - started };
    evidence.push(item);
    console.log(JSON.stringify(item));
  } catch (error) {
    // prepareAIReferences sanitizes errors before returning them. Still emit an
    // allowlisted classification only, never error messages, URLs, headers or keys.
    const message = (error as Error).message;
    const category = /超时/.test(message) ? "timeout" : /鉴权/.test(message) ? "authentication" :
      /原文|字段|工具|作者|条目|年份|DOI|JSON|格式/.test(message) ? "validation" : "request_failed";
    const item = { attempt, result: "failed", category, ms: Date.now() - started };
    evidence.push(item);
    console.log(JSON.stringify(item));
  }
}
writeFileSync("eval/improvement-2026-10-14/ai-safe-diagnostics.json", JSON.stringify({ ranAt: new Date().toISOString(), evidence }, null, 2));
