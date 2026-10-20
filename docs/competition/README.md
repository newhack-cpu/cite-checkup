# 引用体检 · 参赛材料

本目录用于整理本地可审阅的参赛材料，不代表已经报名、公开部署、授权评审访问或正式提交。

| 文件 | 用途 |
|---|---|
| `OFFICIAL_REQUIREMENTS.md` | 2026-10-14 实时核对的官方材料要求及评分口径 |
| `output/pdf/引用体检-技术说明.pdf` | 2026-10-19 版，15 页（在 10-17 晚版基础上加入“和直接问 AI 比”一页与魔搭公网演示）：加入 AI 检索 Agent、拍照 / 截图识别、隐藏提示词检测、开放全文 + 混合检索和 MCP，“相近候选”单列；逐页验收见 `eval/results/technical-pdf-2026-10-17/`（10-18 只改第 11 页测试数，重验见 `eval/results/technical-pdf-2026-10-18/`） |
| `technical-report.html` | 自含 HTML 阅读/编辑源；修改后需另存，浏览器改动不会自动回写 JSON |
| `technical-content.json` | 结构化正式内容源；应从此修改内容后重新构建 PDF/HTML |
| `build_technical_report.py` | 使用 ReportLab 的本地构建脚本，不调用模型或网络 |
| `validate_technical_report.py` | Poppler 渲染与页面 / 文本 / 页码检查，结果写入 `eval/results/technical-pdf-<日期>/`，不覆盖旧版验收；视觉验收另行实际查看 |
| `narration.json` | 2026-10-18 主片逐字稿：10 章；云希 zh-CN-YunxiNeural 神经合成音，成片实测 7 分 44.061 秒 |
| `media/video-2026-10-18/tutorial-narration.json` | 老师操作教程逐字稿：7 章，目标约 3–4 分钟；从已打开的工具页面开始，使用同一云希合成音 |
| `DEMO_SCRIPT.md` | 双片分镜、逐项操作、已批准演示输入、评测事实与异常分支 |
| `VIDEO_PROMPT.md` | 既有正式录制要求（真实运行、讲稿与画面一致、字幕、验收）；本轮音色已选定，双片执行约束见 `media/video-2026-10-18/BRIEF.md` |
| `TRIAL_GUIDE.md` | 请老师试用的指南：魔搭试用入口、三分钟讲解、试用流程、记录表和 SUS 可用性量表 |
| `COMPARISON-2026-10-18.md` | 和“直接问 AI”的对照实验与消融：130 条构造真值，本系统三档对 DeepSeek 不联网 / 联网四档，含重复运行一致性 |
| `USABILITY-2026-10-18.md` | 自动化可用性走查（不是真人测试）：任务步数与耗时、axe-core 无障碍、启发式评估与改进清单 |
| `CLAIM-SCOPE-2026-10-19.md` | 论断“范围错配”评测：47 条论断（三篇论文摘要 + 合成材料）各判 3 次，比较只判定与加范围复核，含改进过程和局限 |
| `DEFENSE_QA.md` | 如实说明技术价值、范围和局限的答辩问答 |
| `SUBMISSION_CHECKLIST.md` | 正式提交前需本人补充/核对的事项 |
| `REVIEW-2026-10-17.md` | 当前版本 81/100 模拟复评：重新核实 Agent / 全文检索 / Vision / MCP、工程与页面，并区分旧盲测和新回放；不是官方成绩 |
| `REVIEW.md` | 保留 10-14 的 73/100 历史模拟复评；当时的功能缺项不代表当前版本 |
| `output/video/引用体检-完整演示-1080p.mp4` | 新版正式参赛片，7 分 44.061 秒，1080p，已完成媒体与逐章抽帧验收 |
| `output/video/引用体检-老师操作教程-1080p.mp4` | 老师操作教程，4 分 06.741 秒，1080p，已完成媒体与逐章抽帧验收 |
| `output/video/video-verification.json` | 新版主片规格、源片段、SHA256 与最终验收 |
| `output/video/tutorial-video-verification.json` | 老师教程的独立最终验收 |
| `media/README.md` | 双片制作入口、准确时长、逐章起点、重录原因、检查范围与历史备份位置 |
| `media/video-2026-10-18/` | 本轮真实生产录屏、云希旁白、中文字幕及剪辑记录；文件存在不代表最终验收通过 |

本轮双视频状态：**2026-10-18 已完成本地交付**。两片均为 1920×1080、25 fps、H.264/AAC MP4，普通话与烧录中文字幕，画面注明“云希 · 神经合成配音”。主片 7 分 44 秒，符合 5–8 分钟要求；老师教程约 4 分 7 秒。另附同名 SRT。已完整解码并逐章抽帧检查，音轨验收和 ASR 抽查不等于人工听审。

演示采用最终生产构建的真实联网操作，不回放模型或数据库响应。等待段可剪短并标明“等待已缩短”，合成材料明确标注，失败结果如实保留。旧视频、旧音频和旧验收保留为历史证据；本轮素材与它们分开记录。

老师操作与试用记录沿用 [TRIAL_GUIDE.md](TRIAL_GUIDE.md)，老师实际试用仍由用户安排。教程制作不代表已开展用户研究；试用人数、用时、误报和意见只在实际发生后填写。双片最终规格、验收范围和旧版备份路径见 [media/README.md](media/README.md)。

构建 PDF 与 HTML：

```powershell
python docs/competition/build_technical_report.py
```

使用 Python 包 `reportlab` 和本机 Windows 字体（宋体、黑体）。最终 PDF 已生成后，阅读不依赖 Python 或本机字体。内容源更新后必须重新构建并通过实际页面渲染验收；不能只检查脚本退出码。

当前复评证据位于项目的 `eval/review-2026-10-17/`，页面截图位于 `output/playwright/review-2026-10-17/`。10-14 的验证与模拟评分保留在 `eval/phase-two-2026-10-14/competition/`；最初的 48/100、10-14 的 73/100 与当前 81/100 均对应各自版本，不覆盖旧证据，也不构成官方成绩或获奖预测。
