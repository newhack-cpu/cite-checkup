// 场景测试一：像学生那样，让大模型（不联网）给毕业论文列参考文献。生成结果原样保存，之后逐条人工查证真假，
// 再交给引用体检核查，看编造的条目能抓出多少、真实条目有没有误报。
// 用法：pnpm exec tsx scripts/scenario-generate.mts [--out=eval/scenario-2026-10-23/generated.json]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deepseekConfiguration } from "../src/lib/ai";

try {
  process.loadEnvFile(".env.local");
} catch {
  // 没有 .env.local 时下面会报没有密钥
}

const out = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "eval/scenario-2026-10-23/generated.json";

// 三个常见的本科毕业论文题目，分别来自教育学、计算机 / 医学、经济学
const TOPICS = [
  { id: "edu", discipline: "教育学", title: "大学生学业倦怠的影响因素与干预研究" },
  { id: "med", discipline: "计算机 / 医学", title: "深度学习在医学影像辅助诊断中的应用综述" },
  { id: "econ", discipline: "经济学", title: "数字普惠金融对农村居民消费的影响" },
];
const prompt = (title: string) =>
  `我在写本科毕业论文，题目是《${title}》。请帮我列出 12 篇参考文献，中文和英文各 6 篇，按 GB/T 7714-2015 格式书写，期刊论文尽量附上 DOI。只输出参考文献列表，每条一行，用 [1] 到 [12] 编号，不要其他说明。`;

const { apiKey, model, endpoint } = deepseekConfiguration();
if (!apiKey || !endpoint) throw new Error("没有配置 DeepSeek 密钥");

const lists = [];
for (const topic of TOPICS) {
  // 普通对话：不联网、不开工具、不开深度思考，和学生直接在聊天框里快速问一样
  // （deepseek-flash 默认先思考，4000 个 token 会全用在思考上、正文为空，10-23 实测）
  const body = { model, messages: [{ role: "user", content: prompt(topic.title) }], thinking: { type: "disabled" }, max_tokens: 4000 };
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`DeepSeek 返回 HTTP ${res.status}`);
  const json = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[]; usage?: unknown };
  const text = json.choices?.[0]?.message?.content ?? "";
  lists.push({ ...topic, prompt: prompt(topic.title), model: json.model ?? model, seconds: Math.round((Date.now() - started) / 100) / 10, usage: json.usage, text });
  console.log(`== ${topic.id}（${json.model ?? model}）\n${text}\n`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), endpoint: new URL(endpoint).origin, requestedModel: model, webSearch: false, lists }, null, 2) + "\n");
console.log(`已写入 ${out}`);
