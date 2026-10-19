# 2026-10-18 双视频制作

项目根目录：`D:\Darks\projects\cite-checkup`。基线提交 `474c66a`。

用户授权制作：约 7:40 的正式参赛演示，以及给老师看的简短操作视频。老师试用由用户安排。用户已选择云希男声 `zh-CN-YunxiNeural`，无本人音频。使用神经合成音并明确标注，不使用慧慧或 MiniMax。

遵循 `docs/competition/VIDEO_PROMPT.md`、`DEMO_SCRIPT.md`、`narration.json`、`TRIAL_GUIDE.md`。1920×1080、H.264/AAC MP4、普通话、烧录中文字幕。正式片 300–480 秒，目标 460；操作教程约 3–4 分钟。真实生产版、真实联网、不可 mock/replay，不录终端、密钥、环境变量、邮箱。合成测试材料明确标注；等待剪短须标明；不循环或冻帧凑时长。

ChatCut 配置存在，但会话无可调用 ChatCut 工具，插件搜索也没有返回入口；本任务依照项目既定 Playwright 原始录屏 + 本地 FFmpeg 制作流程，不上传私有素材。

文件所有权：
- 主代理：本 BRIEF、PROJECT_STATE.md、音频生成工具、剪辑/字幕/最终导出脚本、最终 MP4 与验收记录。
- 录屏代理：本目录 `record-current.cjs`、`capture/`、`capture-manifest.json`，管理本轮生产服务与当天测试/冒烟日志。产品 src 不改。
- 讲稿代理：`docs/competition/narration.json`、`DEMO_SCRIPT.md`，本目录 `tutorial-narration.json`、`SCRIPT_NOTES.md`。不要生成音频。
- MCP 代理：本目录 `mcp-viewer.mts`、`mcp-viewer.html`、`mcp/` 证据，监听本机 3211，仅用于录像的真实 stdio MCP 客户端；产品 src 不改。

录屏约定：每章独立原始 WebM；尺寸 1920×1080，可为后期标题/字幕保留顶部/底部留白，真实内容保持可读。保存章 id、原始视频路径、实际操作时间戳、等待区间、真实响应结果摘要。十章 id 沿用 narration.json。允许各章素材短于目标讲稿时长时补录真实操作/细节，不允许后期静止填满。整体片长由旁白与实际素材共同决定，可在 5–8 分钟内调整。

MCP 约定：浏览器打开 http://127.0.0.1:3211，展示“本地 MCP 演示客户端”，按钮“连接并列出工具”“核验两条参考文献”，用真实 SDK stdio 调用，展示实际结果。不是 Claude/Cursor，不伪称其界面；无配置/终端/密钥展示。

不得提交/推送 Git。本轮旧 MP4 与旧验收记录先备份再替换。保留本来未提交的 .claude/launch.json 和 PROJECT_STATE.md 修改。子代理不写总状态，不覆盖别人的文件。
