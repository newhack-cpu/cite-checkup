# 第二阶段独立审查

范围：只读 documents、import API、claims、claims API、ClaimChecker、DocumentImport、Workbench 与 claim-report。未读取环境文件或密钥，未联网，未修改产品源码，未重跑全套。

## 已确认的问题（已修复并独立定向复验）

### P1：PDF 解压内容流可绕过 worker 堆与文字上限，消耗宿主进程内存

- 位置：`D:\Darks\projects\cite-checkup\src\lib\documents\pdf.ts:73`；内容流处理位于同文件第 34–46 行。
- `resourceLimits` 配置了 V8 堆限制，但 PDF 解压产生的 ArrayBuffer 内存不受该限制约束。上传大小、页数与最终文字长度也不限制内容流解压量。
- 最小复现：一页 PDF，内容流通过 FlateDecode 压缩大量空格，只有 `Resource probe text.` 可提取文字。无需图片、字体资源或网络。
- 32 MiB 解压流仅需 33,246 字节上传；解析成功，实测 RSS 增加 103,604,224 字节。
- 64 MiB 解压流仅需 65,860 字节上传；解析成功，实测 RSS 增加 207,978,496 字节，峰值 335,126,528 字节。没有尝试更大的样本或诱发 OOM。
- 影响：未认证的合法小文件可通过现有校验，按文档容量成倍放大宿主服务内存消耗；两个并发上传已允许。25 秒超时无法作为内存上限。
- 复现脚本：`D:\Darks\projects\cite-checkup\eval\phase-two-2026-10-14\review\pdf-resource.test.ts`。
- 实测记录：同目录 `pdf-resource-observation.json`。
- 命令：`pnpm exec vitest run eval/phase-two-2026-10-14/review/pdf-resource.test.ts`。
- 修复建议：为 PDF 解析提供可执行的外部内存/解压预算。硬隔离优先使用带内存配额的独立进程或容器；若提前验证内容流，不能仅检查原始 `/Length`，需覆盖实际解压和嵌套过滤。补充此类高压缩比、少量输出文字的输入，要求在预算内明确拒绝，并复验正常 PDF 与取消释放。

其余已审范围未发现有证据的新高影响问题。此结论不等于全面安全保证；未进行真实模型提示注入测试或大内存压力测试。

## 修复后的独立验证

- `pdf-decoder-guard.ts` 为 SHA-256 固定版本的 PDF.js 解码器提供单流 8 MiB、累计缓冲分配 32 MiB 预算；将原生异步解压切换到受预算约束的解码路径，拒绝不受覆盖的特殊编码。
- 重新运行原始 32 MiB Flate 样例，现在按 `PDF_RESOURCE_LIMIT` / 413 拒绝。
- 独立新增 16 MiB `RunLengthDecode` 样例，确认不是仅限制 Flate 的特殊分支；同样按 `PDF_RESOURCE_LIMIT` / 413 拒绝。
- 两项独立测试通过，命令仍为上文的单文件 vitest 命令。复验记录保存在 `pdf-resource-verification.json`，修复前 `pdf-resource-observation.json` 保留。
- 最终复验中 Flate 样例的进程 RSS 增长为 40,349,696 字节，包含 PDF.js 与守卫代码启动开销；它不是总进程内存硬上限的证明。
- 最终实现改为随机私有临时目录中的已校验程序模块，以兼容 Next 的加载器；文件不包含用户上传材料，worker 终止后通过非递归方式清理。
- 最终版本定向命令：`pnpm exec vitest run eval/phase-two-2026-10-14/review/pdf-resource.test.ts src/lib/documents/__tests__/pdf-resource.test.ts`。2 个文件、9 项测试通过，涵盖 Flate、独立 RunLength、嵌套过滤、对象流、累计多流、正常受限流、复用 buffer 与未知源码拒绝。
- HTTP 端普通/中文 PDF 返回 200 为 documents 执行者回报；本审查者未重新调用 HTTP 端，其完整集成证据由主执行者与 documents 汇总。
