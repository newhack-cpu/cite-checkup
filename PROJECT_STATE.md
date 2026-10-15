# 引用体检：完善与参赛准备

- 项目：`D:\Darks\projects\cite-checkup`
- 当前目标：用户要求论断证据核查、PDF/Word导入、重新评分与参赛演示材料全部完成。本轮应用功能、生产验收、技术PDF、模拟评分与完整演示视频均已交付验收。
- 验收标准：原误判回归、真实DeepSeek/数据库链路、导入与证据边界、取消/未完成、桌面/手机、生产构建、技术PDF逐页渲染、5–8分钟1080p普通话MP4。
- 约束：沿用项目纸张/印章风格；模型不能决定文献真实性；不伪造证据或秘密；保留用户模型设置；没有公网发布、正式提交或编造团队资料。

## 2026-10-15 准确率修复（最新）

- 起因：10-14 晚的会话在修准确率时额度用完，代码停在半路；10-15 的下一个会话又因 OAuth 失效中断。接手时 typecheck 失败（checker.tsx 的类型标签表缺少 legal/software），deepseek.test.ts 有 4 个作者段测试失败。
- 本次补完的规则：
  - 文献类型新增法规、软件；补强报告、标准、学位论文、网页的识别。
  - DOI 只取 ASCII 字符，不会再把全角括号带进 DOI。
  - 作者段切分：作者段在哪结束说不清时宁可不切，免得漏掉编造的合著者。
  - 作者比对：拆开粘连缩写（EstebanO）；兼容记录里姓、名放反和复姓整串放进 family 的情况。
  - 题名比对：化学式忽略空格；不写题名的引文按 DOI、作者、刊名、卷号、页码核对。
  - 年份接受纸本和在线首发年。
  - 刊名比对：接受"刊名 + 副刊名"的写法；判期刊名不符前，按 ISSN 查 OpenAlex 登记的别名。
  - 判"疑似不存在"前，先查 Crossref 期刊目录，确认该刊在引文年份有收录。
  - 知网等不支持内容协商的 DOI 判为无法核验，不再报错。
  - 数据源会解码 HTML 实体。
- 评测：
  - dev 108 条：误报 19 → 0，核实 29 → 44。
  - test 119 条只盲测一次：逐条复核后误报 19（16.0%）→ 12（10.1%），核实 37 → 45；3 条源论文本身的错误两版都标出了。
  - 29 条人工样例仍为 29/29。
  - 证据：`eval/results/real-*-2026-10-15-*.json`，盲测复核见 `eval/results/real-test-2026-10-15-adjudication.json`。旧引擎由会话记录还原，在 dev 上与原基线 108 条逐条一致。
- 检查：24 个文件 317 项测试、lint、typecheck、build 全部通过。浏览器复验：11 条示例结论不变；无题名、纸本年份、期刊别名 3 条真实引文均为已核实，注释和核查步骤显示正常。
- 下一步：
  - 盲测剩余误报的几类：机构作者标准、未识别的报告、题名内 "Dr." 截断、西语复姓缩写、汉字与拼音跨文字比对作者、图书重印本。
  - test 集已经用过，修完这些之后需要重新抽一批新的盲测集，不能再在 test 集上调。
  - 连续全量评测会触发 Crossref 429。设置 `CROSSREF_MAILTO` 可以进入 polite pool；需要本人填写联系邮箱，未代填。
  - AI 辅助解析模式这次没有重测。

## 有效文件

- 源码：`D:\Darks\projects\cite-checkup\src`
- 配置和运行说明：`D:\Darks\projects\cite-checkup\README.md`
- 服务端配置：`D:\Darks\projects\cite-checkup\.env.local`（按用户授权安全复用本机DeepSeek配置；Git忽略；此记录不含秘密）。模板`.env.example`。
- 第一阶段前快照：`D:\Darks\projects\cite-checkup\eval\improvement-2026-10-14\before-changes.zip`
- 第二阶段前快照与任务约定：`D:\Darks\projects\cite-checkup\eval\phase-two-2026-10-14\before-phase-two.zip`、`BRIEF.md`
- 参赛材料目录：`D:\Darks\projects\cite-checkup\docs\competition\README.md`
- 技术说明PDF：`D:\Darks\projects\cite-checkup\docs\competition\output\pdf\引用体检-技术说明.pdf`（11页，已定稿验收）
- 可编辑内容源：`D:\Darks\projects\cite-checkup\docs\competition\technical-content.json`、`technical-report.html`；构建脚本`build_technical_report.py`。
- 评分：`D:\Darks\projects\cite-checkup\docs\competition\REVIEW.md`，73/100模拟分，原版48/100，非官方成绩。
- 分镜/普通话稿/答辩：同目录`DEMO_SCRIPT.md`、`narration.json`、`DEFENSE_QA.md`、`SUBMISSION_CHECKLIST.md`。
- 视频源与实际响应：`D:\Darks\projects\cite-checkup\docs\competition\media`；root独占。`rehearsal`明确为回放彩排，不算真实调用证据。
- 正式视频：`D:\Darks\projects\cite-checkup\docs\competition\output\video\引用体检-完整演示-1080p.mp4`；6分39秒、1920×1080、25fps、H264/AAC、普通话合成讲解。规格与验收见同目录`video-verification.json`。

## 已完成

- 文献核验：修复题名、假作者/作者顺序、撤稿/关注声明、403、无效响应、预算等误判；候选不等于确认同一篇，修正版保留原文供复核。
- AI解析：DeepSeek真实verify_references工具调用，只补原文可支持的缺失字段；保护原作者/题名/年份/期刊/DOI，模型不能指定任意请求地址或真实性结论。
- 双工作区：参考文献体检与正文论断核查；页签键盘操作与状态保留，完整/未完成/取消状态和Markdown报告。
- PDF文字层/DOCX/TXT：上传预览、全文/参考文献区域、编辑确认后替换输入；8MiB/100页/160k字符；扫描、加密、损坏、超限均明确反馈，不做OCR。
- 导入资源：ZIP/XML实际边界；PDF独立worker及取消终止。单解码流8MiB、累计分配32MiB，固定PDF.js6.4.299完整SHA校验，升级必须重新审计。临时文件仅程序代码，上传原文不落盘。预算不等于硬进程RSS隔离。
- 论断RAG：DOI从白名单Crossref/OpenAlex取得摘要，或用户自备原文；固定切块、BM25中英文词法召回最多6段；DeepSeek judge_claim给四类判断，严格校验来源ID、片段ID、原文引句及UTF16位置。
- 摘要/用户原文范围明示；引句能定位不代表解释必然正确。无证据/模型异常/取消不伪造结论。首次真实模型多余call参数已定位并收紧提示，保持严格输出校验。
- 技术PDF、官方要求、答辩、操作稿与证据索引已完成；模拟复评73分，主要提升来自真实AI工作流、RAG与可靠性。

## 已验证及证据

- 最终23文件289测试、lint、typecheck、build全部exit0：`D:\Darks\projects\cite-checkup\eval\phase-two-2026-10-14\final-checks.json`及`final-*.log`。
- 真实数据库29/29符合预期、编造7/7、真实误报不存在0/15：`D:\Darks\projects\cite-checkup\eval\results\improved-final-2026-10-14.json`。这是小型自建回归，不是实际总体准确率。
- 真实DeepSeek引文解析两例成功无降级：`D:\Darks\projects\cite-checkup\eval\results\ai-smoke-2026-10-14T01-36-52-721Z.json`。首次连接超时后一次受限重试成功，原失败证据保留。
- 真实RAG四例全通过：`D:\Darks\projects\cite-checkup\eval\results\claims-smoke-2026-10-14T02-20-44-807Z.json`。一条公开摘要DOI10.1038/s41598-023-41032-5；三条明确合成的支持/矛盾/不足。验证引句、来源、位置；不当作总体判断准确率。
- 原11条示例、复制/筛选、断流/降级/取消：`D:\Darks\projects\cite-checkup\eval\improvement-2026-10-14\browser-acceptance.json`。
- 新桌面1440/手机390真实导入10次+论断状态回放验证：`D:\Darks\projects\cite-checkup\eval\phase-two-2026-10-14\qa-dev-browser-acceptance.json`；生产重验论断界面：`qa-production-browser-acceptance.json`。无横向溢出/pageerror。手机最终截图`mobile-claims-final.png`来自生产，无dev浮层。
- 主代理另真实点击矛盾样例成功，下载报告与引用定位通过：同目录`desktop-claim-result.png`、`browser-claim-report.md`。
- PDF压缩资源P1已修复，独立9项定向复验通过：同目录`review\FINDINGS.md`。生产普通/中文PDF200，32MiB解压样例413：`D:\Darks\projects\cite-checkup\src\lib\documents\__tests__\production-import-verification.json`。
- 客户端232静态文件扫描密钥匹配0：`D:\Darks\projects\cite-checkup\eval\phase-two-2026-10-14\client-secret-check.json`。
- PDF11页实际Poppler渲染逐页检查通过：同目录`competition\pdf-validation.json`及`render-final`。内容可选取，无裁切/重叠/乱码；SHA256为432ff57febc5d12be3e36da8720bbc54f40ae4f05659b7155b122ccb4fb613bc。
- 正式视频398.593秒；完整音视频解码通过、错误日志为空；8章及失败画面逐帧抽验，音轨均值-24.1dB/峰值-0.1dB。录制公开摘要支持、合成支持/矛盾成功，末次新措辞收入论断输出不合规被拒绝，页面保留未完成。它不是4/4成功的那组独立冒烟，不混计结果。
- 原六章与实际续录两章拼接；失败末帧短暂停留并修整截图视口灰边，未修改响应。`media\initial-recording-timing.json`与原片保留；最终`recording-timing.json`的success仅代表录制完整，boundaryOutcome明示真实拒绝。

## 限制与正式提交前缺项

- 没有扫描OCR/图像理解、自主检索规划Agent、MCP Server、PDF隐藏文字识别；不得把文字导入称作多模态。
- 论断仅针对指定来源及召回片段，未自动读全文、未做跨文献系统检索/独立撤稿核查；词法检索可能漏召回。
- 调用与并发限额按Node进程；公网多实例仍需可信代理、共享预算/账户及资源隔离。没有公网部署、完整负载测试或用户研究。
- Git仍无提交历史，真实学校/团队信息与评审可访问仓库待本人补充；没有代报名或正式提交。不得编造开发历史。
- 模拟评分73/100是本地工程评审，非赛事成绩或获奖预测。官方规则证据见`docs\competition\OFFICIAL_REQUIREMENTS.md`及`eval\phase-two-2026-10-14\competition`。

## 当前运行与下一步

- 2026-10-15：上面 PID29916 的生产预览已不在运行。本次用 `.claude/launch.json` 的 `next dev -p 3210` 做浏览器验证，`.next` 中是 10-15 准确率修复后的生产构建。后续先核对监听，不把 PID 记录视作当前事实。
- 录屏、续录、合成与验证作业均已结束；当前只有生产预览服务应保持运行。浏览器验收和录制会话均已关闭。
- 本轮已授权实现与材料工作无待办。正式提交的外部事项见上方缺项及SUBMISSION_CHECKLIST；后续若继续，先核对当前源码与服务，再按新的明确要求推进。
- 所有子代理均已结束。competition末次因模型容量退出，主代理已完成视频验收、外侧索引/清单和总状态更新；未改变用户模型或推理设置。
- 更新时间：2026-10-15（Asia/Shanghai）。
