# 2026-10-17 AI 能力复审

范围：当前源码、README/PROJECT_STATE 与已有真实调用记录；未读取 `.env`、未发起外部模型或数据库调用、未读取未使用的 `eval/real-world/blind-2026-10-17b.json`。未修改产品代码。测试/typecheck/UI 由主执行者核验，本子任务只额外执行了一个离线隐藏文本最小复现。

## 结论与评分建议

当前已有真正的多轮工具 Agent、开放全文 RAG、跨语言查询扩展和重排、视觉转写、可被 MCP 客户端调用的 stdio Server。10-14 版本“无 Agent / 无视觉 / 无 MCP / 仅摘要 BM25”的扣分已过时。

按项目保存的 AI 技术深度 35 分子项，建议 **29/35**：大模型 7/8、Agent 7/8、RAG 5/6、多模态 3.5/5、安全 3/4、MCP 3.5/4。此处只给 AI 分项建议，不替代主执行者核验官方维度与整体验收。相比旧 AI 分 23 是实质提升；现阶段剩余扣分来自效果验证和具体边界，不能单凭功能齐全给满分。

## 当前能力与证据

| 能力 | 代码核实 | 已存实测 | 边界 |
|---|---|---|---|
| 多轮 Agent | `src/lib/agent/index.ts:113` 循环调用模型，`:137` 执行工具，`:156`–`:160` 把工具结果回传；`:172` 最终仍由规则判定。`tools.ts:232` 真实调 Crossref/OpenAlex/DataCite/doi.org，`:255` 拦截无来源 DOI。 | `eval/results/agent-dev-2026-10-15.json:5`：61 条追查，确认 3；`agent-test-2026-10-15.json:5`：58 条追查，确认 7，平均 2.86 次工具、5465 token、9.6 秒，无新增 not_found。脚本 `scripts/eval-agent.mts:65` 调真实 runAgent，无 mock。 | test 的 7 条复核是 3 条正确已核实、1 条真实错误、2 条误配/误报、1 条无法确认（README:332 起）；之后修规则但没有新 Agent 盲测。两集合中文合计 52 条未新增确认。不能说 Agent 7/58 都成功解决。 |
| 开放全文 RAG | `src/lib/claims/sources.ts:142` 全文优先；`fulltext.ts:11` 固定主机白名单，`:53`–`:59` JATS 剔除表格、公式等；`claims/index.ts:48` 长材料走混合检索。 | `eval/results/mcp-smoke-2026-10-16T11-51-42-715Z.json:111` 真实 Europe PMC 全文支持结果；`arxiv-fulltext-smoke-2026-10-16.json` 真实下载一次 279302 字节/8 页，3 例初跑中英语引句校验失败，修复后同一下载文本 6/6 模型重放通过。 | 仅 Europe PMC 开放获取子集和 arXiv，并非任意论文全文；图表仅部分标题，表格数值/公式未覆盖。arXiv 修复后验证是保存全文重放，不是第二次完整下载链路。 |
| 混合检索 | `src/lib/claims/assist.ts:123` BM25 原查询 + 中英文扩展词 BM25，经 RRF 合并最多 20 段，模型重排到 6 段；输出校验和退化 warning 存在。该“混合”并非向量+BM25。 | `eval/results/retrieval-2026-10-16.json:7`：24 条，Recall@6 0.75→1，MRR .614→.979；中文 Recall .5→1。`scripts/eval-retrieval.mts:58`、`:60` 真实模型扩展和重排。 | 3 篇仅 14–31 段的论文，候选池覆盖大部分正文；24 条全部是评测者编写的支持论断。只验证检索，不是四分类判断准确率，也没有长文、反例和独立标注验证。 |
| Vision | `src/lib/vision/index.ts` 将图片 data URL 送 DeepSeek，要求 `submit_references`，仅转写；服务端强校验、用户确认后进入规则核验。 | `eval/results/vision-2026-10-16.json:4`：16/16 逐字一致，3 张图片 CER 0；`scripts/eval-vision.mts:48` 真调视觉模型。 | 三张图均由脚本合成，含模拟倾斜/噪点照片；不代表真实手机反光、透视、手写、复杂版面的表现，不理解图表。 |
| MCP | `src/lib/mcp/server.ts:70` / `:115` 注册两个工具；返回结构化结果，进度通知和取消信号已接入。 | `scripts/mcp-smoke.mts:18` 真 stdio 进程，`:34` / `:43` 真协议 callTool；最新已有冒烟 `mcp-smoke-2026-10-16T11-51-42-715Z.json` 两引用得到已核实/年份有误，论断得到全文支持。 | 当前是 stdio 本地接入；未验证 Claude/Cursor 实际客户端配置，也无远程 HTTP 服务。最新真实 MCP 记录在 near_match 变更前，新枚举由离线回归覆盖。 |
| 隐藏文字保护 | `documents/import.ts:45` 导入先检测清洗；`hidden.ts:150` 有明确阈值，`:167` 移除被报告内容。PDF 色彩/渲染模式、DOCX 隐藏样式、Unicode 标签已实现。 | `documents/__tests__/import.test.ts:82` 使用真实文件格式但内容为合成 fixtures；已有 arXiv 实测是对评论文章的 0 误报验证，不是含真实恶意隐藏内容论文的检出试验。 | 已知透明度、遮挡、裁剪等未覆盖；本次发现并复现 OCR 判定豁免漏洞，见下。 |

## 本次具体发现

### P2：只凭不可见文字占比认定 OCR，漏掉不可见指令

`src/lib/documents/pdf.ts:104` 在不可见字符 ≥30 且占总字符 ≥50% 时直接把页面认作 OCR；`:112` 跳过该页所有 invisible run，不检查页面是否存在扫描图像，也不再检查这些 run 是否含显式指令。结果会让本该检测的不可见指令进入导入正文。

离线复现：`eval/review-2026-10-17/ai-probe/invisible-ratio.pdf` 只有一个可见标题和 Tr=3 的不可见指令，707 字节，没有任何图片；调用当前 `importDocument` 的记录是 `ai-probe/result.json`：

- `hidden: null`；
- warning 错称它是扫描件 OCR 层；
- `retainedInstruction: true`，指令完整保留在返回 `text`。

可复跑 `pnpm exec tsx eval/review-2026-10-17/ai-probe/probe.mts`。这证明预处理漏检，不证明下游模型一定会遵从指令；本次没有调用模型。建议 OCR 例外仍扫描明确指令，并核实 OCR 图像/文字对应关系后才豁免，另加这一最小文件回归。该问题使“隐藏提示词防护已完整阻断”的说法不成立，但不抹去已有检测的工程价值。

### P3：MCP 给客户端的能力说明落后于实现

`src/lib/mcp/server.ts:118`–`:125` 仍声称 DOI 仅摘要、检索仅 BM25；实际上 `:143` 共用当前全文+混合检索实现，真实 MCP 冒烟也返回 `europepmc_fulltext`。应同步工具 description 和 DOI 参数说明，避免客户端错误解释范围。当前返回 source.scope 本身正确。

### 评测缺口：真实调用 ≠ 真实场景总体正确率

现有证据充分证明集成链路可用，并包含真实故障和失败记录，透明度较好；但 Agent 当前规则尚缺新数据复验、Vision 缺真照片、RAG 判断缺独立标注的支持/矛盾/不足集合。最新规则盲测误报与中文覆盖由主执行者单独评审，不应以 29/29 自建样例、24/24 检索或16/16合成视觉覆盖其限制。

## 文件与执行情况

- 产品文件：未修改。
- 新增审查说明：本文件。
- 新增最小复现：`ai-probe/probe.mts`、`ai-probe/invisible-ratio.pdf`、`ai-probe/result.json`。
- 离线复现命令退出 0；未重复全套 test/typecheck、未触发任何付费或外部网络调用。
- 下一步由主执行者合并评分和UI/工程检查；本子任务不代改漏洞、不改全局状态文件。
