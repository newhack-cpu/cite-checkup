# 重做演示视频：交给 GPT 的任务说明

用法：等 `PROJECT_STATE.md` 顶部写明“视频前的改动已完成并提交”后，把下面整段（从“你在”开始）发给 GPT。旧成片是 10-14 版，里面没有拍照识别、AI 检索 Agent、隐藏提示词、开放全文论断核查和 MCP。

---

你在 `D:\Darks\projects\cite-checkup` 仓库里工作，这是传智杯 AI WEB 网页开发挑战赛的参赛作品《引用体检》。任务：按当前版本重新制作正式演示视频，替换 10-14 的旧成片。

**先读这些文件，以它们为准：**

- `docs/competition/OFFICIAL_REQUIREMENTS.md`：官方要求（5–8 分钟、MP4、不低于 1080p、普通话讲解，可配字幕）。
- `docs/competition/DEMO_SCRIPT.md`：分镜、每段的真实操作、录制前准备和异常分支。
- `docs/competition/narration.json`：逐字讲稿，10 章。
- `docs/competition/media/README.md`：上次的流程（`generate-narration.ps1` → `prepare_media.py` → `record-demo.cjs` → `assemble_demo.py`）。`record-demo.cjs` 还是 10-14 旧分镜（会点“AI 辅助解析”、等旧页面文字），要按新分镜重写，不要硬套。
- `PROJECT_STATE.md` 顶部和 `docs/competition/SUBMISSION_CHECKLIST.md`。

**硬性要求：**

1. 只录最终生产构建的真实运行：`pnpm build` 后启动 3210 端口的生产服务。本机访问 Crossref / OpenAlex 要走代理：用 `.claude/launch.json` 里的 `cite-checkup-prod-local`，或启动前设置 `NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY`、`HTTP_PROXY`（`NO_PROXY=localhost,127.0.0.1,::1`）。不拦截、不回放模型和数据库响应；`DEMO_REHEARSAL=1` 只能彩排，不能导出正式片。
2. 录制当天先跑 `pnpm test`、`pnpm smoke:ai`、`pnpm smoke:claims`、`pnpm smoke:mcp`，确认模型和数据源可用；第 04 段的中文期刊检索要用 DeepSeek 的 Search 接口，账户需要有余额，先用 `DEMO_SCRIPT.md` 里的中文引文试一次。当天不要先跑评测，免得用掉 OpenAlex 的每日额度。
3. 每段先跑通再录。外部数据会变：跑不出 `DEMO_SCRIPT.md` 写的结果，就如实录真实结果，并改对应那段讲稿。不在失败画面上配“成功”的旁白，不在后期用字幕伪造结论。
4. 讲稿要与画面一致。讲稿里的数字（测试数、盲测结果）以仓库当前的 `README.md` 和技术说明 PDF 为准；对不上就先改 `narration.json` 再录，并把改动告诉我。
5. 旁白：
   - 如果我提供了自己的普通话录音（每章一个 wav，放在 `docs/competition/media/narration/human/`），就用我的录音；
   - 否则用合成音，但不要再用 Windows 慧慧。改用自然的中文神经网络音色（例如 edge-tts 的 `zh-CN-YunxiNeural` 或 `zh-CN-XiaoxiaoNeural`），用之前先问我选哪个，并在 `docs/competition/media/README.md` 里写明是合成音。
   - 不使用任何 MiniMax 的工具或服务。
6. 加中文字幕：由 `narration.json` 生成 SRT 并烧录进画面，字号适中，不遮挡操作区域。
7. 画面 1920×1080，H.264 + AAC 的 MP4，总时长 5:00–8:00，目标约 7:40，不要超过 8:00。长等待可以剪短，但要在画面上标“等待已缩短”；不能用静止画面或循环画面凑时长。
8. 画面里不能出现：API 密钥、`.env.local`、环境变量、终端、浏览器密码界面、个人邮箱。MCP 一段只展示客户端里的调用和结果。合成的演示材料（测试 PDF、合成证据）要在画面或旁白里标明是合成的。
9. 验收：
   - 用 ffprobe 检查分辨率、时长和音轨；
   - 按章节抽帧检查（参照 `verification-frames/` 的做法）；
   - 把结果写进 `docs/competition/output/video/video-verification.json`；
   - 旧成片先改名备份，不要覆盖或删除。
10. 视频和音频文件不进 git（`.gitignore` 已忽略 `*.mp4`、`*.wav`），只提交脚本和验收记录。提交前先给我看 diff，经我同意再提交。

**交付：**

- `docs/competition/output/video/引用体检-完整演示-1080p.mp4`（新版）；
- 更新后的 `video-verification.json`、`recording-timing.json`；
- 一段说明：每章实际时长、哪些段落与讲稿有出入、哪些步骤失败后重录过。
