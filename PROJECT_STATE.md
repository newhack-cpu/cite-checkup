# 引用体检：完善与参赛准备

- 项目：`D:\Darks\projects\cite-checkup`
- 当前目标：用户要求论断证据核查、PDF/Word导入、重新评分与参赛演示材料全部完成。本轮应用功能、生产验收、技术PDF、模拟评分与完整演示视频均已交付验收。
- 验收标准：原误判回归、真实DeepSeek/数据库链路、导入与证据边界、取消/未完成、桌面/手机、生产构建、技术PDF逐页渲染、5–8分钟1080p普通话MP4。
- 约束：沿用项目纸张/印章风格；模型不能决定文献真实性；不伪造证据或秘密；保留用户模型设置；没有公网发布、正式提交或编造团队资料。

## 2026-10-16 运行新盲测集与全量回归（最新）

- 额度：`.env.local` 的 `OPENALEX_API_KEY` 为空。08:11 只剩 0.009 美元（门槛 0.08），等 UTC 0 点（本机 17:00）重置到 0.10 后才跑。
  - 查额度可以用单条 DOI 查询：不计费，响应头同样有 `X-RateLimit-Remaining-USD`；`title.search` 每次 0.001 美元。
  - 实际题名检索次数：盲测约 8、dev 约 2、test 约 2、自建样例 6，远少于原先估计。
- 新盲测集只跑一次：HEAD 17f71ef，核验规则与 d237da2 相同，结果在 `eval/results/real-blind-2026-10-16-rules.json`。110 条：已核实 47、信息有误 9、疑似不存在 2、无法核验 50、出错 2；自动统计误报 11（10%）。
- 逐条复核（`eval/results/real-blind-2026-10-16-adjudication.json`）：
  - 误报 10 条（9.1%，95% 区间 5.0%–15.9%），全部是英文条目；无法确认 1 条（B077，计入后 10.0%）；真实错误 0。
  - 误报原因：非期刊文献配到别的记录 3 条（SSRN 转载、同作者的另一篇、书中章节）；软件未识别 2 条（vegan 版本、R）；题名边界切错 2 条（“, in:” 未截断、“D. Don”）；新闻网页当成期刊 1 条；数据库记录本身有差异 2 条（Crossref 把年份登记为 2020、配到首字母不全的 OpenAlex 机构库记录）。
  - 与 10-15 的 test 盲测（10.1%）同一水平：修过的类型在 test 上清零了，新数据上出现的是新类型的误报。
- 发现一个程序缺陷，按要求本轮不改规则，没有修：OpenAlex `title.search` 把题名中间的 “?” 当成通配符，返回 400（B030，复核时复现）。这条结论变成“出错”，界面却提示“暂时不可用”。修法是检索前去掉 “?” 和 “*”。
- 全量回归，与 10-15 逐条对比（`eval/results/real-regression-2026-10-16.json`）：
  - dev：自动统计误报 0；宫鹏 2010（D084）由信息有误改为已核实；另外 3 处变化都是 Crossref 429。
  - test（已非盲测）：10-15 复核的 12 条误报全部消失，T096 改为已核实，T019 / T023 / T081 三条真实错误仍被标出，复核后误报 0。出错 6 条，全是 Crossref 429（10-15 那次 2 条）。
  - 自建样例（08:15 在 c130db8 上跑，核验规则相同）：`eval/results/curated-2026-10-16.json` 29/29，与 10-15-v2 逐条一致。
- 更正：新盲测集来自 64 篇源论文（每篇 1–2 条）。10-16 早先的记录、README 和技术说明都写成了 81 篇，已改。
- 文档：
  - README“真实论文参考文献评测”：改为三个集合，表格加三行，补盲测结果、复核、解读与局限、10-16 重跑和明细链接；
  - `technical-content.json`：同步第 03 页、第 10 页结果表与评测限制、第 12 页下一阶段、第 13 页证据索引，自动测试数改为 462。
- 技术 PDF：重建为 14 页，`validate_technical_report.py` 通过（文字可选、页码齐全、无出界）。逐页查看 14 张渲染图，没有裁切、乱码或行首标点。
- 检查：`pnpm test` 默认并发下 33 个文件 462 项通过（17f71ef 修了 PDF 测试超时），typecheck、lint、build 通过。
- 待办（不在本次范围）：
  - `DEFENSE_QA.md` 第 75 行仍写 81 篇、“结果出来前不提前估计”，第 59 行仍写“下一步先在新盲测集上运行一次”；
  - `SUBMISSION_CHECKLIST.md` 里“在新盲测集上运行一次”一项还没勾；
  - `narration.json` / `DEMO_SCRIPT.md` 的“下一步先跑新盲测集”，要等重录视频时一起改；
  - 修复题名问号检索出错，以及上面列的几类新误报。修完要再抽一批新盲测集检验，不能拿这批数据当验证集。

## 2026-10-16 更新技术说明 PDF 与视频讲稿

- 技术说明 `docs/competition/technical-content.json` 重写为 14 页：新增 AI 检索 Agent、论断检索评测、多模态、MCP 四页，修正 10-14 版里“未实现 Agent / MCP / 多模态 / 隐藏文字检测、只有 BM25”的过时说法，数字取自 eval/results 下的结果文件。PDF 与 HTML 由 `build_technical_report.py` 生成。
- 构建脚本两处排版修正：reportlab 的避头标点表只有日文标点，正文改为自己预先断行（英文单词不拆、全角逗号等不出现在行首、开括号不留行尾、数字间短横不拆）；宋体缺“↔”，改写措辞。逐页查看了 14 页渲染图，行首标点 0 处。
- `validate_technical_report.py` 改为写入 `eval/results/technical-pdf-<日期>/`，不再覆盖 10-14 的验收证据。本次：14 页、文字可选、页码齐全、无出界。
- 视频：`narration.json` 与 `DEMO_SCRIPT.md` 重写为 10 章约 7 分 15 秒（官方 5–8 分钟），覆盖拍照识别、规则核验、AI 继续查、隐藏提示词、开放全文论断核查、边界、MCP、验证与展望；列出每段当天要跑通的输入（T028、F4、preprint-hidden.pdf、Walters 论文 DOI 等）和异常分支。“证据不足”示例已实测。
- 同步更新 `DEFENSE_QA.md`（Agent / MCP / 多模态 / RAG / 隐藏提示词 / 盲测解读）、`SUBMISSION_CHECKLIST.md`（重录视频、跑新盲测集、本人填写 CROSSREF_MAILTO 与 OPENALEX_API_KEY）和参赛材料 README。`REVIEW.md` 的 73/100 是 10-14 的模拟评分，未重新评分。

## 2026-10-16 论断 RAG 升级：开放全文 + 混合检索

- 开放全文（`src/lib/claims/fulltext.ts`）：DOI 先查 Crossref 记录，再试 Europe PMC 开放获取全文（JATS XML → 纯文本，只留题名、摘要、各节标题和段落、图表标题），再试 arXiv 预印本 PDF（DOI 本身是 arXiv，或 Crossref `relation.has-preprint` 登记了 arXiv）；都没有才用摘要。只访问 www.ebi.ac.uk、export.arxiv.org，不跟随跳转，XML ≤ 6 MiB、PDF ≤ 8 MiB、正文 ≤ 150,000 字符；PDF 走文档导入的安全解析器，隐藏文字会被排除并提示。
- 混合检索（`src/lib/claims/assist.ts`）：多于 6 段时，原论断 BM25 + 模型扩展检索词（`expand_query`，中英文同义词）的 BM25 做倒数排名融合取 20 段，模型按 0–3 分重排（`rank_evidence`）取前 6 段。两步输出都严格校验，失败退回词面检索并写 warning；`coverage.method` / `coverage.expansion` 记录用了什么。短材料（≤ 6 段）保持原来的行为。
- 界面与报告：DOI 选项改为“通过 DOI 查原文”，判断范围区分开放全文 / 摘要 / 用户文本，显示检索方式和扩展检索词，全文给链接；下载报告同步。模型说明里多转义的引号会还原。
- 检索评测（`pnpm eval:retrieval`，`eval/claims-retrieval/cases.json`，`eval/results/retrieval-2026-10-16.json`）：三篇 CC BY 开放全文、24 条论断（12 英 12 中）。前 6 段命中率 / MRR：BM25 75% / 0.61（中文 50%），+扩展 100% / 0.79，+重排 100% / 0.98；出处句子只有 2/24 在摘要里。局限：论断由我编写、都是原文支持的；文档短，重排候选几乎覆盖全文。
- 浏览器验证（生产构建）：中文论断“即使用 GPT-4，它引用的书籍章节里也有七成是编造的”+ DOI 10.1038/s41598-023-41032-5 → 证据支持，引句是 Results 一节的原文，范围显示 Europe PMC 开放全文、混合检索和扩展检索词。
- 测试：新增 `fulltext.test.ts` 12 项、`hybrid.test.ts` 8 项、judge 说明清理 1 项；新夹具 `preprint-hidden.pdf`（合成预印本 + 白字指令）。全量 33 个文件 459 项。
- arXiv 路径 10-16 经用户同意实测（arXiv:2507.06185，只下载 1 次，279 KB、8 页）：
  - 中文论断“18 篇稿件”判为证据支持，“蜜罐辩护是正当的”判为矛盾，隐藏文字检测 0 误报；
  - 英文论断因引句校验失败而未完成：模型把 PDF 行末换行写成空格，在保存的全文上重放 4/4 失败；另有跨页句子中间夹着页标记的情况。
  - 修复：`judge.ts` 先逐字匹配，再忽略空白和“[第 n 页]”页标记定位，返回原文那一段；按原文位置去重重叠片段的重复引句（也解决了 10-16 复核指出的重复显示）。修复后重放 6/6 成功。
  - 记录见 `eval/results/arxiv-fulltext-smoke-2026-10-16.json`。

## 2026-10-16 修复盲测剩余误报、抽新盲测集

- test 集修复后已不算盲测。12 条误报逐条看过，修了 9 类规则（详见 README“修复盲测剩余误报”）：题名缩写与分部编号、ACS 题名到分号为止、会议报告 / 机构报告 / 德语报告识别、出版社结尾按图书、脚注字母、复姓缩写、汉字 ↔ 拼音作者（新依赖 pinyin-pro 3.29.4，锁定版本，只在服务端比对模块使用）、中文记录作者顺序只提示、信息不足条目、期刊开始注册 DOI 晚于引文年份、期刊目录检索去掉 & / and、OpenAlex 知识库不当期刊。
- 顺带修了一个老问题：只贴一条带序号的引文时，开头的 "[1]" 没去掉，作者段识别不出来。
- 验证：
  - 12 条误报 + 宫鹏 2010 联网逐条重跑全部不再误报，T019 只剩真实年份错误；
  - 只用 Crossref 的 A/B（新旧两版都屏蔽 OpenAlex）：test“信息有误”9 → 3，剩下 3 条就是复核过的真实错误；dev 不变；两边都没有新误报；各有 1 条 Crossref 429；
  - 新旧解析逐条对比，227 条中 17 条变化，逐条检查无退步；
  - 回归测试 `src/lib/verify/__tests__/real-world-test-set.test.ts` 19 项；全量 31 个文件 438 项、typecheck、lint、build 通过。
- 新盲测集 `eval/real-world/blind-2026-10-16.json`：110 条（英文 86、中文 24），64 篇不同论文（原写 81 篇，有误），出版社组合换了（IEEE 没有 unstructured 参考文献，抽到 0 条；IOP 只有 2 条）。抽样脚本 `pnpm sample:real`。只看过每组条数，没看内容。
- 待办：OpenAlex 无 key 时每天约 100 次题名检索（10-16 凌晨只剩约 14 次），完整的 dev、test 重跑和新盲测集的一次运行要等额度恢复，或用户在 openalex.org 申请免费 key 后填进 `.env.local` 的 `OPENALEX_API_KEY`。OpenAlex 的返回里写着“AI 代理可以用用户邮箱代为申请 key”，没有照做。（10-16 17:00 额度重置后已完成，见“运行新盲测集与全量回归”一节。）

## 2026-10-15 隐藏提示词检测

- 背景（已核实出处）：日经亚洲 2025-07-01 报道 17 篇 arXiv 预印本用白字或极小字号藏了写给 AI 审稿的指令；Lin 的评论文章 arXiv:2507.06185 统计到 18 篇。两篇都没列出具体论文编号。
- 功能：导入 PDF / DOCX / TXT 时找出读者看不见、AI 会读到的文字，列出并从导入文字中去掉；导入预览上方显示红框（像写给 AI 的指令）或琥珀色框，带页码、隐藏方式和原文。
  - PDF：白色或接近白色的填充（灰度 / RGB / CMYK / 按分量数推断的 sc、scn），渲染模式 3、7，小于 1.5 磅，起点在页面外。不可见文字占一页大部分的视为扫描件 OCR 文字层，只给警告。
  - DOCX：w:vanish、浅色底上的白字（字符底纹、突出显示、段落底纹、单元格底纹、页面背景按由内到外取）、小于 2 磅；格式按 docDefaults → 段落样式（或默认段落样式）→ 字符样式 → 直接格式解析，沿 basedOn 继承。
  - 所有格式：Unicode 标签字符解码后删除；零宽字符删除并给警告。
- 报告规则（`src/lib/documents/hidden.ts`）：像指令的一律列出；不像的，只是白字要满 40 个非空白字符，其他方式满 12 个。列出的才删除，没列出的保留在文字里。
- PDF 实现：PDF.js 文字条目不带颜色，`getOperatorList()` 会解码图片而被解码器防护拦下，所以在已校验哈希的 worker 模块后追加只读钩子（`pdf-hidden-text.ts`）：包装 `EvaluatorPreprocessor.prototype.preprocessCommand` 跟踪填充色和渲染模式（状态随 q/Q 由 PDF.js 克隆），包装 `Font.prototype.charsToGlyphs` 按行收集隐藏文字。`pdf.ts` 再用逐字 NFKC、忽略空白的方式在页面文字里定位并打标记；整行找不到时退到最长前缀 / 后缀（超出页边被 PDF.js 截断的行），完全不在文字层的（页面外）只报告。字号和位置用文字条目的变换矩阵判断。
- 测试：`hidden.test.ts` 22 项（标记解析、指令判断正反例、删除与空格、Unicode 标签）；`import.test.ts` 新增 4 个真实文件用例（`generate_hidden.py` 生成：白字、CMYK 白 TJ、极小中文、Tr 3、超出右边缘、页面外、白色假参考文献；OCR 层；Word 直接 / 样式隐藏、白字、1 磅、深色底白字；Unicode 标签）。
- 误报检查：自家 11 页技术说明 PDF 有 24 处深色表头白字，全部按正常排版保留、不报告；演示用参考文献 PDF 无发现。真实论文（含隐藏提示词的 arXiv 预印本）还没测，需要下载 PDF，等用户同意。
- 浏览器验证（生产构建）：导入 hidden-prompt.pdf，红框显示“发现 6 处隐藏文字，其中 5 处像是写给 AI 的指令”，逐条列出页码和隐藏方式，预览里已去掉。
- 检查：30 个文件 419 项测试、typecheck、lint、build 通过。

## 2026-10-15 拍照 / 截图识别

- 功能：参考文献框上方新增“拍照 / 截图识别”，也可以在参考文献框里直接粘贴截图。
  - 浏览器先把图片重绘到 2048 像素以内（PNG 保持 PNG，其他转 JPEG 0.92），顺带去掉 EXIF；HEIC 提示先截图或转 JPG。
  - DeepSeek 视觉模型（图片以 base64 data URL 放在 user 消息里）强制调用 `submit_references`，逐条原样转写；看不清的字写 `[?]`；图片中的文字一律当数据。
  - 预览显示缩略图、识别条数和提醒，可直接修改；确认后才填入参考文献框，真伪仍由规则核验。
- 代码位置：`src/lib/vision/index.ts`（格式嗅探、请求、响应校验）、`src/app/api/vision/route.ts`、`src/components/document-import.tsx`；`src/lib/documents/request.ts` 拆出 `readBoundedForm` 供两个上传接口共用。扫描版 PDF 的“无文字层”提示改为引导用户截图识别。
- 限额：每次 1–4 张、合计 8 MiB、80 条、60,000 字符、60 秒；每 IP 每分钟 4 次、每进程每小时 40 次、同时 2 个；文件头不是图片的一律 415。
- 评测：`python eval/vision/generate.py` 生成英文截图、中文截图、模拟手机照片（倾斜、模糊、噪点、JPEG 72）三张图，共 16 条真实文献；`pnpm eval:vision` 结果 16/16 逐字一致、CER 0%、每张 3–5 秒，识别结果与标准答案的核验结论完全一致（`eval/results/vision-2026-10-16.json`，文件名按 UTC 日期）。合成样本只证明链路可用。
- 评测顺带发现一个规则误报：宫鹏等 2010《中国1990和2000基准年湿地变化遥感》在 Crossref 里的作者顺序是乱的（宫鹏排第 14），被判“作者不符”。留到“修盲测剩余误报”一起修。
- 浏览器验证（生产构建，`cite-checkup-prod-local` 配置）：注入 3 条文献的截图 → 识别 3 条 → 确认填入 → 核验得 2 条已核实、1 条编造的查无此文。
- 本机预览注意：预览进程不会自动走代理。`.claude/launch.json` 的 `cite-checkup-prod-local` 用 `C:\Users\Darks\bin\node.exe`，并在 `env` 里设 `NODE_USE_ENV_PROXY=1` 和 7890 代理（实测只传 `--use-env-proxy` 参数不生效，改用环境变量后正常）。这份配置带本机路径，只留在本地、不提交。
- 检查：29 个文件 393 项测试通过。

## 2026-10-15 AI 检索 Agent

- 功能：标准核验后，"无法核验"和"只找到相近候选"的条目旁出现"AI 继续查"。点击后：
  - DeepSeek 多轮规划检索，每轮调用 1–2 个工具：`search_crossref`、`search_openalex`（每条最多 1 次）、`search_datacite`、`lookup_doi`、`finish`；
  - 每步的中文理由和结果实时显示在卡片上；
  - 结束后，所有候选交给与标准核验相同的规则逐字段复核，卡片换成新结论，并保留追查前的结论；
  - 下载报告里写有 AI 检索理由和追查摘要。
- 代码位置：
  - `src/lib/agent/`：`model.ts` 是多轮工具调用和响应校验，`tools.ts` 是工具定义、参数校验和 DOI 来源限制，`index.ts` 是循环、早停、规则复核和限额；
  - `src/app/api/agent/route.ts`：NDJSON 流式接口；`src/lib/agent-stream.ts`：前端流校验；
  - 新数据源 `src/lib/verify/sources/datacite.ts`；`verifyReference` 新增可选参数 `extra`，用于把 Agent 找到的候选并入规则判定。
- 安全设计：
  - 模型不能给结论，也不能制造"疑似不存在"；Agent 的检索步骤不计入"两个数据源都查过"的判定。
  - DOI 只能查引文或结果里出现过的；工具名、字段、长度、年份都校验，不合规的调用计入次数并告知模型。
  - 理由和小结去掉网址；含"编造""真实存在"等真伪判断词的文字不显示。
  - 限额：单条最多 4 次检索、4 轮、80 秒；接口每 IP 每分钟 6 次、每进程每小时 60 次、同时 2 次。
- Agent 找到新候选后暴露了三处规则问题，已一并修正：
  - 机构作者（ASTM 的 Committee 等）不按姓氏比对；
  - "AdamsB(2018)" 这类与括号粘连的缩写要拆开；
  - 图书和学位论文的记录年份不同（版本、重印、后来的存档）只提示，不判错。
- 评测（`pnpm eval:agent`，OpenAlex 每次限 20 次）：
  - dev 61 条可追查：确认 3 条，均为已核实；
  - test 58 条可追查，Agent 盲测：确认 7 条（4 条已核实、3 条信息有误）；
  - 两边都没有失败，也没有变成"疑似不存在"；
  - 每条平均约 3 次检索、5.5–5.8 千 token、10–12 秒；52 条中文条目一条也没找到。
- 盲测 7 条复核结果：
  - 已核实 4 条：3 条正确，1 条（T043）匹配到同一作者 2026 年的同名新文章；
  - 信息有误 3 条：T057 引文确实写错，T078 是 CRS 报告旧版本造成的误报，T005 无法确认；
  - 盲测后补了两条规则：覆盖不足类型的不一致记录只作为候选；图书、学位论文年份差距大时题名须逐字一致。
- 证据：
  - `eval/results/agent-dev-2026-10-15.json`、`agent-test-2026-10-15.json`；
  - `agent-dev-2026-10-15-first.json` 是第一次 dev 运行，暴露了两处规则误判。

## 2026-10-15 MCP Server

- `pnpm mcp`：用 stdio 启动 MCP Server，基于官方 SDK 1.31.0 和 zod 4.6.5，两个依赖都锁定发布满两周的版本。代码在 `src/lib/mcp/server.ts` 和 `scripts/mcp-server.mts`。
- 两个只读工具：
  - `verify_references`：参考文献核验，带逐条进度通知；
  - `check_claim`：论断证据核查，复用网页端每小时 30 次的限额。
  - 两个工具都同时返回文字摘要和带输出结构定义的结构化结果。
- 测试与实连：
  - `src/lib/mcp/__tests__/server.test.ts` 通过内存传输走真实协议，共 6 项；
  - `pnpm smoke:mcp` 用 README 给出的同一条命令启动真实进程（`eval/results/mcp-smoke-2026-10-16T00-35-59-125Z.json`）：参考文献一条已核实、一条查出年份写错；DOI 摘要论断判为"证据支持"，附原文引句。
- 实连过程中修了论断核查的老问题：DeepSeek 有时把参数包成 `{"arguments": {...}}`，导致判断正确却被整体拒绝。前两次实连失败的记录保留在 `mcp-smoke-…00-28…` 和 `…00-29…`。现在三处工具调用（AI 解析、论断核查、Agent）都只拆这一种外壳，内容仍逐项严格校验（`src/lib/tool-args.ts`）。
- 检查：27 个文件 370 项测试、lint、typecheck 通过；29 条人工样例 29/29；dev 规则回归误报 0。

## 2026-10-15 准确率修复

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
- 技术说明PDF：`D:\Darks\projects\cite-checkup\docs\competition\output\pdf\引用体检-技术说明.pdf`（2026-10-16 版 14 页；逐页渲染与行首标点检查见 `eval/results/technical-pdf-2026-10-16/`；10-14 的 11 页版验收在 `eval/phase-two-2026-10-14/competition/`）
- 可编辑内容源：`D:\Darks\projects\cite-checkup\docs\competition\technical-content.json`、`technical-report.html`；构建脚本`build_technical_report.py`。
- 评分：`D:\Darks\projects\cite-checkup\docs\competition\REVIEW.md`，73/100模拟分，原版48/100，非官方成绩。
- 分镜/普通话稿/答辩：同目录`DEMO_SCRIPT.md`、`narration.json`、`DEFENSE_QA.md`、`SUBMISSION_CHECKLIST.md`。
- 视频源与实际响应：`D:\Darks\projects\cite-checkup\docs\competition\media`；root独占。`rehearsal`明确为回放彩排，不算真实调用证据。
- 正式视频：`D:\Darks\projects\cite-checkup\docs\competition\output\video\引用体检-完整演示-1080p.mp4`；6分39秒、1920×1080、25fps、H264/AAC、普通话合成讲解，是 10-14 的旧版，不含之后的新功能。规格与验收见同目录`video-verification.json`。新讲稿（10 章约 7 分 15 秒）见 `DEMO_SCRIPT.md`、`narration.json`，由用户本人录制。

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

- 图片识别只转写参考文献条目，不理解图表。隐藏文字检测不覆盖被图片或色块盖住、透明度为 0、裁剪、批注和表单里的文字。
- 论断仅针对指定来源及召回片段，未自动读全文、未做跨文献系统检索/独立撤稿核查；词法检索可能漏召回。
- 调用与并发限额按Node进程；公网多实例仍需可信代理、共享预算/账户及资源隔离。没有公网部署、完整负载测试或用户研究。
- 代码已推到 GitHub 私有仓库 newhack-cpu/miniature-fiesta；正式提交前需公开或给评审访问权限。真实学校/团队信息待本人补充；没有代报名或正式提交。不得编造开发历史。
- 模拟评分73/100是本地工程评审，非赛事成绩或获奖预测。官方规则证据见`docs\competition\OFFICIAL_REQUIREMENTS.md`及`eval\phase-two-2026-10-14\competition`。

## 当前运行与下一步

- 2026-10-15：上面 PID29916 的生产预览已不在运行。本次用 `.claude/launch.json` 的 `next dev -p 3210` 做浏览器验证，`.next` 中是 10-15 准确率修复后的生产构建。后续先核对监听，不把 PID 记录视作当前事实。
- 录屏、续录、合成与验证作业均已结束；当前只有生产预览服务应保持运行。浏览器验收和录制会话均已关闭。
- 本轮已授权实现与材料工作无待办。正式提交的外部事项见上方缺项及SUBMISSION_CHECKLIST；后续若继续，先核对当前源码与服务，再按新的明确要求推进。
- 所有子代理均已结束。competition末次因模型容量退出，主代理已完成视频验收、外侧索引/清单和总状态更新；未改变用户模型或推理设置。
- 更新时间：2026-10-15（Asia/Shanghai）。
