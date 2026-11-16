// 远程 MCP 入口公网验收：用官方 SDK 客户端连魔搭上的 /api/mcp，列工具，再核验两条参考文献（第二条年份故意写错）。
// 用法（项目根目录）：pnpm exec tsx eval/results/remote-mcp-2026-11-16/check.mts <url> <out.json>
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "https://kgkvybu111111-cite-checkup.ms.show/api/mcp";
const out = process.argv[3] ?? "eval/results/remote-mcp-2026-11-16/check.json";
const t0 = Date.now();
const client = new Client({ name: "remote-acceptance", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const connectMs = Date.now() - t0;
const tools = (await client.listTools()).tools.map((t) => t.name);
const t1 = Date.now();
const res = await client.callTool({ name: "verify_references", arguments: { references: "[1] LeCun Y, Bengio Y, Hinton G. Deep learning[J]. Nature, 2015, 521(7553): 436-444.\n[2] LeCun Y, Bengio Y, Hinton G. Deep learning[J]. Nature, 2017, 521(7553): 436-444." } });
const structured = res.structuredContent as { counts: Record<string, number>; results: { index: number; verdict: string; summary: string; issues: string[] }[] };
const rec = { url, at: new Date().toISOString(), connectMs, tools, verifyMs: Date.now() - t1, isError: !!res.isError, counts: structured.counts, results: structured.results.map(({ index, verdict, summary, issues }) => ({ index, verdict, summary, issues })) };
await client.close();
writeFileSync(out, JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec, null, 1));
