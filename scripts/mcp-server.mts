// 引用体检 MCP Server（stdio）。配置方法见 README「MCP Server」一节。
// stdout 只能输出 MCP 协议消息，日志一律写到 stderr。
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCiteCheckupServer } from "../src/lib/mcp/server";

try {
  // 客户端启动时的工作目录不确定，按脚本位置找项目根目录下的 .env.local
  process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
} catch {
  // 没有 .env.local 也能核验参考文献；论断核查会提示未配置 DeepSeek
}

const budget = Number(process.env.OPENALEX_SEARCH_BUDGET ?? 20);
const server = createCiteCheckupServer({ openalexBudget: Number.isFinite(budget) ? Math.max(0, Math.min(80, Math.floor(budget))) : 20 });
await server.connect(new StdioServerTransport());
console.error("cite-checkup MCP server is running on stdio");
