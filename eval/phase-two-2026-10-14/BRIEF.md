# 本轮交接与实施约定

项目：D:\Darks\projects\cite-checkup。用户授权三项全部完成：正文论断与文献证据核查、PDF/Word 导入、重新评分及参赛演示材料。沿用 DeepSeek 与纸张/印章视觉；不重复审批、不更改模型配置、不输出秘密。不做外部发布。

## 产品边界

1. 参考文献体检继续原工作流。新增 PDF（文字层）/DOCX/TXT 导入预览，用户确认参考文献片段后再填入文本框；扫描/加密/损坏/超限文件清楚说明。不把文件或原文发送模型，除非用户明确点击 AI 相关功能。
2. 新增论断证据核查页签：输入一条正文论断，提供 DOI 检索摘要，或粘贴/导入用户自备全文。先切块检索，再让 DeepSeek 仅基于召回片段判断；输出支持/部分支持/矛盾/证据不足与可定位的原文引句、来源及范围限制。无证据时不臆测结论。上传来源标为用户提供，摘要不能冒充全文。
3. 完成后按现有官方评分维度重新评估；产出技术说明 PDF、演示操作稿、真实操作录屏及证据清单。团队姓名未知时不编造，不代为提交赛事。

## 所有权

- documents 代理：src/lib/documents/**、src/app/api/import/**、src/components/document-import.tsx、自有测试与fixtures。可修改 package.json / pnpm-lock.yaml / next.config.ts 添加解析依赖与必要服务端配置；只在依赖安装时拥有这些文件，先通知主代理。
- claims 代理：src/lib/claims/**、src/app/api/claims/**、自有测试与fixtures。不得修改已有 lib/ai、核验引擎、package.json、UI或状态文件。
- competition 代理：docs/competition/**、eval/phase-two-2026-10-14/competition/**。先核对规则和准备材料，最终得分与事实必须等待集成验收证据。
- root：页面/UI集成、已有Checker、README、PROJECT_STATE、总方案、最终检查/截图/录屏；共享接口在开发前沟通。

## 接口

- documents: DocumentImport React组件接受 onImport(text: string): void，disabled?: boolean，purpose?: 'references'|'evidence'。可选择提取的全文/参考文献区域，确认再应用。组件自己请求 POST /api/import FormData file，不依赖全局状态。导入返回纯文本与 warnings、页数等元数据，不返回可执行HTML。不需要依赖修改 Checker，由 root 插入。
- claims: types.ts 由 claims 代理定义并尽快告知root。POST /api/claims JSON 至少 claim:string、doi?:string、evidenceText?:string、evidenceLabel?:string；响应 JSON，含判断、理由、被检索片段、原文引用与来源。GET 可返回服务配置状态。浏览器 AbortController 可取消。输入、输出、并发、预算限制复用思路但不争用原文件。

## 验收

真实解析 PDF/DOCX fixtures、损坏/加密/过大/zip安全边界；RAG引句溯源、错误source ID/虚构引句/提示注入/缺证据/取消/密钥缺失；有意义的自动测试，lint/typecheck/build；真实 DeepSeek + 公开数据库至少一条摘要核查，以及受控支持/矛盾/不足用例；桌面与手机、报告导出、上传替换确认、已存在功能回归；材料实际渲染与视频可播放。PROJECT_STATE仅root维护。
