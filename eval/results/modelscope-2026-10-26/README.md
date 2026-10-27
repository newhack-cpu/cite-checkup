# 魔搭公网拍摄彩排（2026-10-26）

按 [拍摄脚本](../../../docs/competition/SHOOTING_SCRIPT.md) 的顺序，用 Playwright 驱动本机 Edge（不走代理）在魔搭公网 https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full 上真实操作。魔搭运行的是 20395c9，与 main 的 `src` 没有差别。第 8 段 MCP 只能在本机，单独测。

| 段 | 结果 | 记录 |
|---|---|---|
| 2 第一次打开 | 全新浏览器：魔搭先转圈加载，约 3 秒落印动画，之后出现“第一次来？”；“带我看看”→“下一步”到第 2 步（共 6 步），Esc 关掉 | `shoot-check-2.json` → `firstVisit`、`steps.tour` |
| 3 参考文献体检 | 示例 11 条 + 只贴 DOI + 《金融研究》易行健，共 13 条，首次约 12 秒；需要处理 5 条（第 4、8 条有误，第 6、7 条查无此文，第 9 条已撤稿），自动展开详情，第 4 条字段表有 Neural Computation；第 12 条按 DOI 补全；第 13 条已核实（来源：知网），详情有“打开知网页面”和“DeepSeek 搜索”“原文页面”两步；第 11 条图书待人工；规范参考文献 GB/T 7714、APA 可切换，未确认的条目末尾注明【请人工核查】等 | `shoot-check.json` → `seg3`；`shoot-check-2.json` → `steps.seg3` |
| 4 AI 继续查 | 英文会议论文先“待人工”（检索覆盖不完整），AI 检索 2 次：Crossref 没找到、OpenAlex 找到，规则确认后已核实（来源：OpenAlex），约 6 秒 | `shoot-check.json` → `seg4` |
| 5 截图识别 | 合成照片识别出 6 条，确认后填入输入框，约 4 秒 | `shoot-check.json` → `seg5`（`previewLines` 为 0 是脚本取错了文本框，填入结果见 `refsAfter`） |
| 6 隐藏提示词 | “发现 1 处隐藏文字，其中 1 处像是写给 AI 的指令”，第 1 页白色文字，约 2 秒 | `shoot-check.json` → `seg6` |
| 7 论断核查 | 读 Europe PMC 开放全文，证据支持，约 10–13 秒；“查看片段 source-1-c16”能展开原文 | `shoot-check.json` → `seg7`；`shoot-check-2.json` → `steps.seg7` |
| 8 MCP（本机） | 本机直连，不配代理：连接后 2 个工具；核验两条约 17.5 秒，已核实 1、信息有误 1（第 2 条年份写 2017，数据库 2015） | `docs/competition/media/video-2026-10-18/mcp/` 下 2026-10-27T05-29/05-30 两个文件 |

注意：

- 服务器把上游响应缓存 6 小时（`src/lib/verify/http.ts`）。第二轮重查同样的示例只用 0.4 秒，核查过程里标“缓存”，结论不变。
- 魔搭应用域名（`*.ms.show`）直接打开会跳回创空间页面，录屏画面会带魔搭的淡水印和右侧小按钮。
- 截图未入库，只留 JSON。
