// Explicit live check: sends four public/synthetic examples to the configured local service.
import { mkdirSync, writeFileSync } from "node:fs";
import type { ClaimInput, ClaimResult, ClaimVerdict } from "../src/lib/claims/types";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3210";
const serviceResponse = await fetch(`${base}/api/claims`);
if (!serviceResponse.ok || !serviceResponse.headers.get("content-type")?.includes("application/json")) throw new Error(`论断核查服务尚未正常启动（HTTP ${serviceResponse.status}），请检查服务端构建日志。`);
const status = await serviceResponse.json();
if (!status.available) throw new Error("论断核查服务未配置可用的 DeepSeek，请先启动已配置的本地服务。");
const evidenceText = "这是功能验收用的合成研究材料，不是真实论文。研究招募了40名大学生，分为学习计划组和对照组，各20人。干预持续四周。学习计划组与对照组的平均测验成绩差异没有达到统计显著性。研究没有观察到学习计划提高考试成绩的可靠证据。研究没有追踪长期效果。";
const cases: { id: string; input: ClaimInput; expected: ClaimVerdict }[] = [
  { id: "public-abstract", input: { doi: "10.1038/s41598-023-41032-5", claim: "在该研究样本中，GPT-3.5生成引文的55%为虚构，GPT-4为18%。" }, expected: "supported" },
  { id: "synthetic-supported", input: { evidenceText, evidenceLabel: "验收合成材料", claim: "研究招募了40名大学生，干预持续四周。" }, expected: "supported" },
  { id: "synthetic-contradicted", input: { evidenceText, evidenceLabel: "验收合成材料", claim: "这项研究招募了400名大学生。" }, expected: "contradicted" },
  { id: "synthetic-insufficient", input: { evidenceText, evidenceLabel: "验收合成材料", claim: "干预使参与者一年后的收入翻倍。" }, expected: "insufficient_evidence" },
];
const results = [];
for (const testCase of cases) {
  const started = Date.now();
  const response = await fetch(`${base}/api/claims`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(testCase.input), signal: AbortSignal.timeout(120_000) });
  const body = await response.json() as ClaimResult;
  const citationsValid = Array.isArray(body.citations) && body.citations.every(citation => {
    const chunk = body.chunks?.find(part => part.id === citation.chunkId);
    return chunk && citation.sourceId === chunk.sourceId && citation.start >= chunk.start && citation.end <= chunk.end && chunk.text.slice(citation.start - chunk.start, citation.end - chunk.start) === citation.quote;
  });
  const passed = response.ok && body.status === "complete" && body.verdict === testCase.expected && citationsValid && (body.verdict === "insufficient_evidence" || body.citations.length > 0);
  results.push({ ...testCase, response: body, httpStatus: response.status, ms: Date.now() - started, citationsValid, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${testCase.id}: ${body.status} / ${body.verdict}`);
}
mkdirSync("eval/results", { recursive: true });
const out = `eval/results/claims-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), model: status.model, passed: results.every(result => result.passed), results, limitation: "四条流程验收，不代表开放场景判断准确率；三条证据是明确标注的合成材料。" }, null, 2));
console.log(`验收证据：${out}`);
if (!results.every(result => result.passed)) process.exitCode = 1;
