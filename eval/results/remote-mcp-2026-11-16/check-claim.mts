// 部署 8c3fc76 后公网验收：远程 MCP 调 check_claim（红队 B09，范围复核数量词修复）与 verify_references。用法：pnpm exec tsx <本文件> <out.json>
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const url = "https://kgkvybu111111-cite-checkup.ms.show/api/mcp";
const client = new Client({ name: "remote-acceptance", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const t0 = Date.now();
const claim = await client.callTool({ name: "check_claim", arguments: { claim: "绝大多数教师认为使用该软件后备课时间增加了。", evidence_text: "调查显示，使用该软件的教师中，有 56% 认为备课时间有所减少，31% 认为没有变化，13% 认为增加。", evidence_label: "红队评测合成材料" } });
const claimMs = Date.now() - t0;
const refs = await client.callTool({ name: "verify_references", arguments: { references: "[1] LeCun Y, Bengio Y, Hinton G. Deep learning[J]. Nature, 2015, 521(7553): 436-444." } });
await client.close();
const c = claim.structuredContent as { status: string; verdict: string | null; explanation: string };
const rec = { url, at: new Date().toISOString(), deployedCommit: "8c3fc76 (GitHub d351c7c)", checkClaim: { ms: claimMs, status: c.status, verdict: c.verdict, explanation: c.explanation.slice(0, 160) }, verifyReferences: (refs.structuredContent as { counts: Record<string, number> }).counts };
writeFileSync(process.argv[2] ?? "eval/results/remote-mcp-2026-11-16/check-claim.json", JSON.stringify(rec, null, 1));
console.log(JSON.stringify(rec, null, 1));
