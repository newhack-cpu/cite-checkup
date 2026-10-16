// 图片识别评测：对 eval/vision/cases.json 里的每张图调用 DeepSeek 视觉识别，与标准答案逐条比较；
// 再把识别结果和标准答案分别送去核验，看识别误差会不会改变最终结论。
// 用法：python eval/vision/generate.py  然后  pnpm eval:vision [--no-verify]
// 需要 .env.local 里的 DEEPSEEK_API_KEY；网络需要代理时先设置 NODE_USE_ENV_PROXY=1。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseReferenceList } from "../src/lib/verify/extract";
import type { RefResult } from "../src/lib/verify/types";
import { verifyAll } from "../src/lib/verify/verify";
import { sniffImage, transcribeReferences } from "../src/lib/vision";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有密钥时识别会报未配置
}

interface Case { id: string; file: string; kind: string; entries: string[] }
const { cases } = JSON.parse(readFileSync("eval/vision/cases.json", "utf8")) as { cases: Case[] };
const verify = !process.argv.includes("--no-verify");
const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

/** 编辑距离，用来算字符错误率（CER） */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

async function verdicts(text: string): Promise<string[]> {
  const results: RefResult[] = [];
  await verifyAll(parseReferenceList(text), (r) => results.push(r), { concurrency: 2, openalexBudget: 5 });
  return results.sort((a, b) => a.index - b.index).map((r) => r.verdict);
}

const rows = [];
for (const c of cases) {
  const path = join("eval", "vision", c.file);
  if (!existsSync(path)) throw new Error(`缺少 ${path}，请先运行 python eval/vision/generate.py`);
  const bytes = new Uint8Array(readFileSync(path));
  const format = sniffImage(bytes);
  if (!format) throw new Error(`${path} 不是支持的图片格式`);
  const started = Date.now();
  const result = await transcribeReferences([{ bytes, format }]);
  const seconds = (Date.now() - started) / 1000;
  const truth = c.entries.map(squash);
  const got = result.entries.map(squash);
  const exact = truth.filter((t, i) => got[i] === t).length;
  const cer = distance(truth.join("\n"), got.join("\n")) / truth.join("\n").length;
  const row: Record<string, unknown> = {
    id: c.id, kind: c.kind, expectedEntries: truth.length, gotEntries: got.length, exactEntries: exact,
    cer: +cer.toFixed(4), seconds, tokens: result.tokens,
    diffs: truth.map((t, i) => (got[i] === t ? null : { expected: t, got: got[i] ?? null })).filter(Boolean),
  };
  if (verify) {
    const [fromImage, fromTruth] = [await verdicts(result.text), await verdicts(c.entries.join("\n"))];
    row.verdictsFromImage = fromImage;
    row.verdictsFromTruth = fromTruth;
    row.sameVerdicts = fromImage.length === fromTruth.length && fromImage.every((v, i) => v === fromTruth[i]);
  }
  rows.push(row);
  console.log(`${c.id}：${got.length}/${truth.length} 条，逐字一致 ${exact} 条，CER ${(cer * 100).toFixed(2)}%，${seconds.toFixed(1)} 秒${verify ? `，核验结论${row.sameVerdicts ? "一致" : "不一致"}` : ""}`);
}

const totalEntries = rows.reduce((s, r) => s + (r.expectedEntries as number), 0);
const exactEntries = rows.reduce((s, r) => s + (r.exactEntries as number), 0);
mkdirSync(join("eval", "results"), { recursive: true });
const out = join("eval", "results", `vision-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), model: process.env.DEEPSEEK_MODEL || "deepseek-flash", totalEntries, exactEntries, rows }, null, 1));
console.log(`\n合计 ${exactEntries}/${totalEntries} 条逐字一致；明细已写入 ${out}`);
