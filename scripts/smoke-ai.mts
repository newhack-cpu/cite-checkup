// Live integration check. Requires a running local server and its server-side DeepSeek key.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCheckStream } from "../src/lib/check-stream";
import type { CheckEvent } from "../src/lib/verify/types";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3210";
const status = await fetch(`${base}/api/check`).then(r => r.json()) as { available?: boolean; model?: string };
if (!status.available) throw new Error("本地服务尚未配置 DeepSeek；请配置 .env.local 并启动服务后重试。");
const text = [
  "[1] LECUN Y, BENGIO Y, HINTON G | Deep learning | Nature | 2015 | DOI: 10.1038/nature14539",
  "[2] Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Networks, 9(8), 1735–1780. DOI: 10.1162/neco.1997.9.8.1735",
].join("\n");
const response = await fetch(`${base}/api/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, mode: "ai" }), signal: AbortSignal.timeout(180_000) });
if (!response.ok || !response.body) throw new Error(`核验请求失败（HTTP ${response.status}）`);
const events: CheckEvent[] = [];
await readCheckStream(response.body, e => {
  events.push(e);
  if (e.type === "phase" || e.type === "notice") console.log(e.message);
  if (e.type === "result") console.log(`[${e.result.index}] ${e.result.verdict}: ${e.result.summary}`);
});
const out = join("eval", "results", `ai-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(join("eval", "results"), { recursive: true });
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), model: status.model, input: text, events }, null, 2));
if (events.some(e => e.type === "notice")) throw new Error(`本次发生降级，未通过真实 AI 验收。证据：${out}`);
const meta = events.find(e => e.type === "meta");
if (!meta || meta.type !== "meta" || meta.refs[0]?.titleGuess !== "Deep learning" || !meta.refs[0]?.authorsGuess?.includes("LECUN")) throw new Error("复杂格式的AI字段抽取未达到预期。");
const results = events.filter(e => e.type === "result").map(e => e.result);
if (results[0]?.index === 2) results.reverse();
if (results[0]?.verdict !== "verified" || results[1]?.verdict !== "mismatch") throw new Error(`核验结果未达到预期，请检查数据源和记录。证据：${out}`);
console.log(`真实 DeepSeek 解析 → 数据库核验通过。证据：${out}`);
