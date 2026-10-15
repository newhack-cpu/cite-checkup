# 引用体检 · 参赛材料

本目录用于整理本地可审阅的参赛材料，不代表已经报名、公开部署、授权评审访问或正式提交。

| 文件 | 用途 |
|---|---|
| `OFFICIAL_REQUIREMENTS.md` | 2026-10-14 实时核对的官方材料要求及评分口径 |
| `output/pdf/引用体检-技术说明.pdf` | 11 页本地技术验收版；已写入最终289项测试与实际功能证据，逐页验收见评审目录 |
| `technical-report.html` | 自含 HTML 阅读/编辑源；修改后需另存，浏览器改动不会自动回写 JSON |
| `technical-content.json` | 结构化正式内容源；应从此修改内容后重新构建 PDF/HTML |
| `build_technical_report.py` | 使用 ReportLab 的本地构建脚本，不调用模型或网络 |
| `validate_technical_report.py` | Poppler渲染与页面/文本/页码检查；视觉验收另行实际查看 |
| `narration.json` | 正式视频 8 章普通话讲解稿与动作；成片以实际时长验收 |
| `DEMO_SCRIPT.md` | 正式约 6 分钟操作分镜及约 4 分钟快版 |
| `DEFENSE_QA.md` | 如实说明技术价值、范围和局限的答辩问答 |
| `SUBMISSION_CHECKLIST.md` | 正式提交前需本人补充/核对的事项 |
| `REVIEW.md` | 73/100 模拟复评和扣分依据；不是官方成绩 |
| `output/video/引用体检-完整演示-1080p.mp4` | 6分39秒、1080p、普通话合成解说；真实操作与一次真实拒绝判断边界 |
| `output/video/video-verification.json` | 视频规格、源片段、实际失败记录与导出验收 |
| `media/` | 由主执行者维护的实际录屏、旁白和最终视频，按各自验证记录确认 |

构建 PDF 与 HTML：

```powershell
python docs/competition/build_technical_report.py
```

使用 Python 包 `reportlab` 和本机 Windows 字体（宋体、黑体）。最终 PDF 已生成后，阅读不依赖 Python 或本机字体。内容源更新后必须重新构建并通过实际页面渲染验收；不能只检查脚本退出码。

最终验证与模拟复评分位于项目的 `eval/phase-two-2026-10-14/competition/`。最初的 48/100 评分是修改前版本；最终复评独立保存，不覆盖旧证据，也不构成官方成绩或获奖预测。
