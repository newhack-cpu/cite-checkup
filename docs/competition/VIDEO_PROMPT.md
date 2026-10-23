# 重做演示视频：交给 GPT 的任务说明

用法：功能冻结、所有改动（包括另一个会话的中文期刊检索）都已提交并部署之后，把下面整段（从“你在”开始）发给 GPT。现有成片是 10-18 版（7:44，按 474c66a 录制），之后又加了：界面改版、开场动画和新手引导（10-20），论断范围复核（10-19～10-20），只贴 DOI 补全和规范参考文献（10-22）。

---

你在 `D:\Darks\projects\cite-checkup` 仓库里工作，这是传智杯 AI WEB 网页开发挑战赛的参赛作品《引用体检》。任务：按当前版本重新制作正式演示视频，替换 10-18 的成片；时间允许时，老师操作教程也按 `media/video-2026-10-18/tutorial-narration.json` 重录，时间不够先保证正式片。

**先读这些文件，以它们为准：**

- `docs/competition/OFFICIAL_REQUIREMENTS.md`：官方要求（5–8 分钟、MP4、不低于 1080p、普通话讲解，可配字幕）。
- `docs/competition/DEMO_SCRIPT.md`：分镜、每段的真实操作、录制前准备和异常分支。
- `docs/competition/narration.json`：逐字讲稿，10 章。
- `docs/competition/media/README.md`：上次的流程（`generate-narration.ps1` → `prepare_media.py` → `record-demo.cjs` → `assemble_demo.py`）。`record-demo.cjs`、`record-ending.cjs` 是按 10-18 的界面写的，10-20 改版后很多按钮名和位置都变了（见下表），要按新分镜重写，不要硬套。

**10-20 改版后界面的变化（录屏脚本要跟着改）：**

| 旧界面 | 现在 |
|---|---|
| 左栏“送检单” | 页面上方的大输入框（`#refs`），结果在输入框下面 |
| “标准核验 / AI 辅助解析”单选 | “AI 辅助解析”开关（`role=switch`，默认关，关着就是标准核验） |
| “导入 PDF / Word / TXT” | “导入文件” |
| “拍照 / 截图识别” | “截图识别”（要等 `/api/vision` 确认视觉模型可用才出现，慢网络下会晚几秒） |
| “展开详情 / 收起” | 卡片右下角“详情 / 收起” |
| “只看有问题的” | 结果上方筛选栏的“需要处理” |
| 两个大标签卡 | 页眉中间的分段切换“参考文献体检 / 正文论断核查” |
| 没有 | 首次来访的落印开场动画和“第一次来？”邀请卡（“先不用 / 带我看看”），页眉“怎么用”可重看；本地记录键 `cite-intro`、`cite-tour` |
| 没有 | 体检完成后的“规范参考文献”按钮和面板：GB/T 7714 / APA 切换、“复制全部” |
| 没有 | 只贴 DOI 的条目按 DOI 补全，结论写“已按 DOI 查到这篇文献” |
- `PROJECT_STATE.md` 顶部和 `docs/competition/SUBMISSION_CHECKLIST.md`。

**硬性要求：**

1. 只录最终生产构建的真实运行：`pnpm build` 后启动 3210 端口的生产服务。本机访问 Crossref / OpenAlex 要走代理：用 `.claude/launch.json` 里的 `cite-checkup-prod-local`，或启动前设置 `NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY`、`HTTP_PROXY`（`NO_PROXY=localhost,127.0.0.1,::1`）。不拦截、不回放模型和数据库响应；`DEMO_REHEARSAL=1` 只能彩排，不能导出正式片。
2. 录制当天先跑 `pnpm test`、`pnpm smoke:ai`、`pnpm smoke:claims`、`pnpm smoke:mcp`，确认模型和数据源可用；第 04 段的中文期刊检索要用 DeepSeek 的 Search 接口，账户需要有余额，先用 `DEMO_SCRIPT.md` 里的中文引文试一次。当天不要先跑评测，免得用掉 OpenAlex 的每日额度。
3. 每段先跑通再录。外部数据会变：跑不出 `DEMO_SCRIPT.md` 写的结果，就如实录真实结果，并改对应那段讲稿。不在失败画面上配“成功”的旁白，不在后期用字幕伪造结论。
4. 讲稿要与画面一致。讲稿里的数字（测试数、盲测结果）以仓库当前的 `README.md` 和技术说明 PDF 为准；对不上就先改 `narration.json` 再录，并把改动告诉我。
5. 旁白：
   - 如果我提供了自己的普通话录音（每章一个 wav，放在 `docs/competition/media/narration/human/`），就用我的录音；
   - 否则用合成音：沿用 10-18 我选定的 edge-tts `zh-CN-YunxiNeural` 云希男声，不要用 Windows 慧慧，并在 `docs/competition/media/README.md` 里写明是合成音。讲稿里写成“国标格式”的地方不要改回“GB/T 7714”（合成音会把数字读错）。
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
