import { readFileSync, writeFileSync } from "node:fs";
import { parseReference } from "../../src/lib/verify/extract";
import { verifyAll } from "../../src/lib/verify/verify";
process.loadEnvFile(".env.local");
const cases = readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as { id: string; raw: string });
const out: unknown[] = [];
await verifyAll(cases.map((c, i) => parseReference(c.raw, i + 1)), (r) => {
  out.push({ id: cases[r.index - 1].id, verdict: r.verdict, summary: r.summary, issues: r.issues, notes: r.notes, suggestion: r.suggestion, cited: cases[r.index - 1].raw.slice(0, 40) });
}, { concurrency: 3, openalexBudget: cases.length, cn: { left: 200 } });
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log("done", out.length);
