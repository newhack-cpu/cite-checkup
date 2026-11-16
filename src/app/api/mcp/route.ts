// MCP 网络入口（Streamable HTTP，无状态、只回 JSON）：Claude、Cursor 等客户端填这个地址就能调用，不用装 Node 或拉代码。
// 工具与 stdio 版（scripts/mcp-server.mts）完全相同：结论来自数据库逐字段比对和原文引句校验，客户端传来的内容一律当作数据。
// 每个请求新建一个服务实例；限额是进程内的，按访客 IP 计，不是账户系统。
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { WindowLimit, checkClientIp } from "@/lib/check-limits";
import { createClaimLimits } from "@/lib/claims/limits";
import { createCiteCheckupServer } from "@/lib/mcp/server";

export const maxDuration = 180;

/** 参考文献最多 60,000 字符，中文按 UTF-8 三字节再加 JSON 转义，512 KiB 足够 */
const MAX_BODY_BYTES = 512 * 1024;
const MESSAGES_PER_MINUTE = 30;
// 进程内共用：每个访客每分钟的消息数；论断核查的模型额度（并发、每小时字符预算、每人每分钟 6 次）
const perIp = new WindowLimit(60_000, MESSAGES_PER_MINUTE);
const claimLimits = createClaimLimits();
const headers = { "Cache-Control": "no-store" };

function rpcError(status: number, message: string, code = -32000): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}

/** 浏览器直接打开时给一句说明；无状态 JSON 模式不提供 SSE 推送流，按规范回 405 */
export async function GET() {
  return Response.json(
    {
      name: "cite-checkup",
      transport: "Streamable HTTP（无状态，JSON 响应）",
      usage: "在支持 MCP 的客户端里把这个地址配置为 HTTP 类型的 MCP 服务器，即可使用 verify_references（核验参考文献）和 check_claim（核查论断证据）两个工具。",
      limits: `每个访客每分钟最多 ${MESSAGES_PER_MINUTE} 条消息；论断核查每分钟最多 6 次。`,
    },
    { status: 405, headers: { ...headers, Allow: "POST" } },
  );
}

export async function DELETE() {
  return rpcError(405, "无状态服务，没有会话可关闭");
}

export async function POST(request: Request) {
  const ip = checkClientIp(request);
  if (!perIp.take(ip)) return rpcError(429, `请求过于频繁（每分钟最多 ${MESSAGES_PER_MINUTE} 条消息），请稍后再试`);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return rpcError(413, "请求体过大");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return rpcError(413, "请求体过大");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return rpcError(400, "Parse error", -32700);
  }

  const server = createCiteCheckupServer({ openalexBudget: 20, claimLimits, clientKey: ip });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody: body });
    // JSON 模式下响应体已经完整生成，可以先把内容读出来再关闭实例
    const text = await response.text();
    const out = new Headers(response.headers);
    out.set("Cache-Control", "no-store");
    return new Response(text, { status: response.status, headers: out });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
