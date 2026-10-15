import { writeFileSync } from "node:fs";
import { prepareAIReferences } from "../../src/lib/ai/index";
process.loadEnvFile(".env.local");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  let response: Response;
  try { response = await originalFetch(...args); }
  catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    console.log(JSON.stringify({ transportError: err.name, message: err.message, causeCode: err.cause?.code, cause: err.cause?.message }).replaceAll(process.env.DEEPSEEK_API_KEY!, "[REDACTED]"));
    throw e;
  }
  if (String(args[0]).includes("api.deepseek.com")) {
    const json = await response.clone().json().catch(() => null);
    const safe = JSON.stringify({ status: response.status, type: response.headers.get("content-type"), error: json?.error, choices: json?.choices, usage: json?.usage }, null, 2).replaceAll(process.env.DEEPSEEK_API_KEY!, "[REDACTED]");
    writeFileSync("eval/improvement-2026-10-14/ai-protocol-debug.json", safe);
    console.log(`Upstream HTTP ${response.status}; details saved without credentials.`);
  }
  return response;
};
try {
  const result = await prepareAIReferences("[1] LECUN Y, BENGIO Y, HINTON G | Deep learning | Nature | 2015 | DOI: 10.1038/nature14539\n[2] Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Networks, 9(8), 1735–1780. DOI: 10.1162/neco.1997.9.8.1735", { onProgress: console.log });
  console.log(JSON.stringify(result));
} catch (e) { console.log((e as Error).message); process.exitCode = 1; }
