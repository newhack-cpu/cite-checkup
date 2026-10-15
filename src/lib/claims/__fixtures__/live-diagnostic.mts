// Explicit manual live verification; never included by the unit-test runner.
// Saves only public/synthetic evidence and model tool arguments, never headers or configuration.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkClaim } from "../index";
import { fetchDoiEvidence } from "../sources";

process.loadEnvFile(".env.local");
const fixture = JSON.parse(await readFile("eval/results/claims-smoke-2026-10-14T02-12-14-972Z.json", "utf8"));
const input = fixture.results.find((entry: { id: string }) => entry.id === "synthetic-supported").input;
const realFetch = globalThis.fetch;
let toolArguments: unknown;
globalThis.fetch = async (url, init) => {
  const response = await realFetch(url, init);
  const address = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
  if (address.pathname.endsWith("/chat/completions") && response.ok) {
    const body = await response.clone().json();
    const args = body?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (typeof args === "string" && args.length < 24_000) {
      try { toolArguments = JSON.parse(args); } catch { toolArguments = { invalidJson: true }; }
    }
  }
  return response;
};
const supported = await checkClaim(input);
const file = fileURLToPath(new URL("./live-supported-diagnostic.json", import.meta.url));
await writeFile(file, JSON.stringify({ ranAt: new Date().toISOString(), input, toolArguments, response: supported }, null, 2));
console.log(JSON.stringify({ kind: "synthetic-supported", status: supported.status, verdict: supported.verdict, errorCode: supported.errorCode, saved: file, toolArguments }));
globalThis.fetch = realFetch;

const doi = "10.1038/s41598-023-41032-5";
try {
  const evidence = await fetchDoiEvidence(doi);
  const output = fileURLToPath(new URL("./live-public-abstract.json", import.meta.url));
  await writeFile(output, JSON.stringify({ ranAt: new Date().toISOString(), ...evidence }, null, 2));
  console.log(JSON.stringify({ kind: "public-abstract", doi, source: evidence.source, text: evidence.text, warnings: evidence.warnings, saved: output }));
} catch (error) {
  console.log(JSON.stringify({ kind: "public-abstract", doi, errorCode: error instanceof Error && "code" in error ? error.code : "UNKNOWN" }));
  process.exitCode = 1;
}
