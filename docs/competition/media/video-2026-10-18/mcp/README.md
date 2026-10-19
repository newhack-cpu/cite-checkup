# 本地 MCP 演示客户端

用途：本轮录屏的真实 MCP 集成演示。页面为自建本地客户端，不是 Claude 或 Cursor。

- 页面：`http://127.0.0.1:3211`
- 源文件：`D:\Darks\projects\cite-checkup\docs\competition\media\video-2026-10-18\mcp-viewer.mts`
- 页面文件：`D:\Darks\projects\cite-checkup\docs\competition\media\video-2026-10-18\mcp-viewer.html`
- 启动工作目录：`D:\Darks\projects\cite-checkup`
- 启动命令：`pnpm exec tsx docs/competition/media/video-2026-10-18/mcp-viewer.mts`
- 本轮运行 session ID：`19439`；启动后核对的 HTTP 服务 PID：`35292`。进程是否仍运行必须以实际核对为准。
- 服务只监听 `127.0.0.1:3211`，并校验 Host、Origin 和固定空对象请求体。
- 唯一动作：`POST /api/connect`、`POST /api/verify`。后者不接受外部文献或任意工具名，只核验源文件中的两条公开固定示例。
- MCP 实际启动链：SDK `Client` + `StdioClientTransport` → `pnpm --silent --dir <project> mcp`。沿用项目 MCP Server 自己的 `.env.local` 加载，不在界面、日志或证据中输出环境变量或 stderr。
- 可按本机网络需要为启动进程设置已有 HTTP/HTTPS 代理；本轮使用已有 `127.0.0.1:7890` 代理及 `NODE_USE_ENV_PROXY=1`，不改变持久配置。
- 页面每次点击核验均真实调用 `verify_references`；没有缓存结果、回放或 mock。`check_claim` 仅展示真实 listTools 返回的可用工具说明，不在此客户端提供调用入口。

## 录制选择器

1. 打开页面，点击 `#connect-button`：**连接并列出工具**。
2. 等待 `#connection-status[data-connected="true"]`，工具卡有 `data-listed="true"`。
3. 点击 `#verify-button`：**核验两条参考文献**。
4. 等待状态：`#result-panel[data-state="loading"]`；真实通知：`#progress-text`；墙钟等待：`#elapsed`。
5. 成功状态：`#result-panel[data-state="complete"]`；每条结果：`#results .result-card`，带 `data-index` 和 `data-verdict`；总计：`#results .summary`。
6. 失败状态：`#result-panel[data-state="error"]`。界面展示失败，不伪造核验结论。
7. `window.mcpLastResult` 含最近一次真实响应、用时和对应证据文件名；只用于录屏代理收集操作证据。

## 已验证 / 待验证

- 已验证：独立 TypeScript 类型检查通过；HTML 内联浏览器 JavaScript 语法检查通过。
- 已验证：HTTP 页面可达；实际 stdio 连接并列出 `verify_references`、`check_claim` 两个工具。见 `self-check.json` 和同目录 `list-tools-*.json`。
- 已验证：任意输入覆盖、缺少 Origin、任意工具调用路由分别被 403、403、404 拒绝；未执行核验动作。
- 已验证：录屏实际调用完成，`verify-references-2026-10-18T09-39-39-532Z.json` 记录两条结果为已核实1条、信息有误1条，没有服务端错误。最终主片第08章抽帧已实际查看，结果、固定输入与stdio集成说明可读；详见本轮 `visual-QA.json`。
- 已停止：录制及最终视觉验收完成后，经主代理授权，核对HTTP进程35292及其stdio子进程树后精确关闭。`shutdown.json` 记录3211端口已关闭，生产3210 PID29136仍保留且HTTP返回200；没有按全局进程名称终止程序。

界面页脚固定注明：**通过 stdio 调用本项目 MCP Server；供集成演示**。
