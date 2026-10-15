# 参赛材料证据索引

本目录仅保存材料与评分证据。主项目状态由根目录 `PROJECT_STATE.md` 维护，本索引不替代最终状态。

## 已核对的基线

| 证据 ID | 原始文件 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| BASE-DB | `eval/results/improved-final-2026-10-14.json` | 第一阶段29条真实数据库回归全部符合预期 | 真实总体准确率或新论断质量 |
| BASE-AI | `eval/results/ai-smoke-2026-10-14T01-36-52-721Z.json` | 两条公开引文真实DeepSeek工具调用与数据库衔接 | 所有格式、长文或新RAG已通过 |
| BASE-UI | `eval/improvement-2026-10-14/browser-acceptance.json` | 第一阶段桌面/手机及固定故障分支验收 | 新界面、新导入、新论断已验收 |
| OFFICIAL | `eval/phase-two-2026-10-14/competition/official-check.json` | 实时官方API获取方法、参数、快照散列及要求摘要 | 官方给本作品评分或认可 |

## 本轮已核对的新增证据

| 证据 ID | 原始文件 | 实际覆盖与限制 |
|---|---|---|
| CLAIMS-LIVE | `eval/results/claims-smoke-2026-10-14T02-20-44-807Z.json` | 真实DeepSeek 4/4：1个公开Crossref摘要+3个明确标为合成的支持/矛盾/不足用例；4例引句位置均有效。不是总体准确率。 |
| CLAIMS-UI-LIVE | `eval/phase-two-2026-10-14/browser-claim-report.md`、`desktop-claim-result.png` | 真实页面判断合成“400人/40人”矛盾，附原文及报告。 |
| NEW-UI | `eval/phase-two-2026-10-14/qa-dev-browser-acceptance.json` | 1440×1000、390×844；共10次真实PDF/DOCX/中文PDF/无文字PDF上传解析；确认替换、放弃保留、标签页保留、报告、取消和引用定位通过，无横向溢出/pageerror。 |
| NEW-UI-REPLAY | 同上 | claims界面状态以已记录的真实响应回放检查，不是额外真实模型调用。开发模式截图含Next开发叠层，仅作验证证据。 |
| CLAIMS-PUBLIC | `CLAIMS-LIVE`的public-abstract条目 | DOI `10.1038/s41598-023-41032-5`，Crossref摘要1,031字符，supported，引句[713,823)，约14.5秒。明确只核查该研究样本，不外推新模型。 |
| PDF-RESOURCE | `eval/phase-two-2026-10-14/review/FINDINGS.md`、`pdf-resource-verification.json` | 独立发现解压资源问题后修复，定向2文件9测试通过；覆盖Flate、RunLength、嵌套/对象流/累计缓冲与未知worker拒绝。单流8MiB、累计32MiB不是总RSS硬上限。修复前记录保留。 |
| FINAL-CHECKS | `eval/phase-two-2026-10-14/final-checks.json` 与同目录 `final-test.log`、`final-lint.log`、`final-typecheck.log`、`final-build.log` | 根代理最终实际执行：23文件289测试通过，lint/typecheck/build全部exit 0。 |
| CLIENT-SCAN | `eval/phase-two-2026-10-14/client-secret-check.json` | 本次生产构建232静态文件中密钥匹配0，不是全面安全认证。 |
| PROD-UI | `eval/phase-two-2026-10-14/qa-production-browser-acceptance.json` | 生产版1440/390，claims真实响应回放测试通过，无pageerror/横向溢出；生产截图无开发叠层。仍不算额外模型样本。 |
| PROD-IMPORT | `src/lib/documents/__tests__/production-import-verification.json` | 实际生产HTTP：普通PDF200、中文PDF200、32MiB压缩展开攻击413/PDF_RESOURCE_LIMIT，3例通过。 |
| FINAL-PDF | `docs/competition/output/pdf/引用体检-技术说明.pdf`；`eval/phase-two-2026-10-14/competition/pdf-validation.json` | 11页，文本可选择、页码正确、文字无越页；Poppler最终11页逐页目视通过，内容无草稿待验收标记。仅团队身份待本人补充。 |

## 视频与正式提交状态

- 正式成片：`docs/competition/output/video/引用体检-完整演示-1080p.mp4`，398.593秒（6分39秒）、1920×1080、25fps、H264/AAC，Microsoft Huihui Desktop普通话合成解说。规格与源片段见同目录`video-verification.json`，完整解码错误日志为空，逐章及拒绝画面已查看。
- 视频前六章实际调用公开数据库和DeepSeek，没有回放响应。公开摘要支持、合成支持/矛盾成功；收入论断的新措辞调用被`INVALID_MODEL_RESPONSE`拒绝，页面真实显示未完成。保留原失败与完整记录，不把此段当成成功；独立smoke四例通过是另一组实际调用。
- 前六章原片与后两章技术说明/首页续录拼接；失败末帧停留至相应旁白结束，修整截图导致的灰色空白，未改结果内容。操作与剪辑说明见`docs/competition/media/README.md`、`recording-timing.json`；所有原片保留。
- PDF/HTML内容已锁定供真实录制使用；成片证据只更新本索引和外侧清单，不改已验收PDF。
- 团队真实信息、报名/缴费、仓库评审访问及正式提交仍未完成或未确认；没有代为提交。

最终模拟评分为73/100，`scorecard.json`为final-simulation状态。它依据本地已验证功能和最终构建，不是官方评分，也不等于参赛提交完成。
