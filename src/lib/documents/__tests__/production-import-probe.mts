import { readFile, writeFile } from "node:fs/promises";
import { resourcePdf } from "./fixtures/resource-pdf";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3212");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) throw new Error("This synthetic upload probe only targets a local acceptance server.");
const cases = [
  { name: "ordinary-pdf", filename: "paper.pdf", bytes: new Uint8Array(await readFile(new URL("./fixtures/paper.pdf", import.meta.url))), status: 200, needle: "Miller" },
  { name: "chinese-pdf", filename: "chinese.pdf", bytes: new Uint8Array(await readFile(new URL("./fixtures/chinese.pdf", import.meta.url))), status: 200, needle: "中文" },
  { name: "32-mib-flate-expansion", filename: "resource-probe.pdf", bytes: resourcePdf({ megabytes: 32 }), status: 413, code: "PDF_RESOURCE_LIMIT" },
];
const observations = [];
for (const entry of cases) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(entry.bytes)], entry.filename));
  const started = Date.now();
  const response = await fetch(new URL("/api/import", base), { method: "POST", body: form });
  const body = await response.json();
  const passed = response.status === entry.status && (entry.code ? body.code === entry.code : typeof body.text === "string" && body.text.includes(entry.needle ?? ""));
  observations.push({ case: entry.name, wireBytes: entry.bytes.byteLength, status: response.status, code: body.code ?? null, metadata: body.metadata ?? null, elapsedMs: Date.now() - started, passed });
}
const report = { checkedAt: new Date().toISOString(), base: base.origin, observations, passed: observations.every(entry => entry.passed) };
await writeFile(new URL("./production-import-verification.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
