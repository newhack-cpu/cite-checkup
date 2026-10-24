# 引用体检：完善与参赛准备

- 项目：`D:\Darks\projects\cite-checkup`
- 当前目标：2026-10-18 新版双视频、Netlify 及魔搭国内试用入口已交付。魔搭 https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full 已 Running，匿名使用和主要功能通过；8 MiB 附近上传请求超时，先用小文件或粘贴文本。原 Netlify 入口保留。老师真实试用由用户安排；81/100 是此前工程模拟复评，不是官方成绩。
- 验收标准：原误判回归、真实DeepSeek/数据库链路、导入与证据边界、取消/未完成、桌面/手机、生产构建、技术PDF逐页渲染、5–8分钟1080p普通话MP4。
- 约束：沿用项目纸张/印章风格；模型不能决定文献真实性；不伪造证据或秘密；保留用户模型设置。2026-10-18 已按授权上线 Netlify 免费云部署，不依赖本机持续开机；没有正式参赛提交或编造团队资料。

## 2026-10-23（America/Los_Angeles）：技术说明 10-23 版、开发方场景测试、知网 DOI 核对

- 分工：用户决定技术说明由本会话做，另一个会话只做期刊论文；视频由用户交给 GPT 做；老师试用记录不等了，先用开发方场景测试代替（明确不是用户研究）。
- 合并另一个会话的标准体检中文期刊联网核查（8b52f90..40907d6），本会话补 SSRF 防护（620bf11：期刊官网网址来自搜索结果，只请求公网地址、逐跳检查跳转）和 Crossref 作者单位不当作者（随机 DOI 补全时发现）。
- 开发方场景测试（`eval/scenario-2026-10-23/`）：DeepSeek 按教育、医学、经济各写 12 条参考文献，运行前逐条查证真值（`truth.json`，每条附链接）。测试时的版本：编造 11 条查出 7、交人工 4；真实写对 22 条误报 0；真实写错 3 条查出 1、1 条判成已核实（知网 DOI 配错看不出来）、1 条误报。据此加知网 DOI 核对（读中国 DOI 注册机构解析页比对登记的题名、作者，只用来判断 DOI 属于哪篇，不据此判已核实），复测：编造查出 10、交人工 1，写对的误报 0，写错的查出 2、误报 1，已核实 18 条全对。只贴 DOI 随机 30 篇，8 项字段逐项一致 30/30。已有评测集里只有 1 条知网 DOI（D010，英文写法），结论不变。
- 测试：45 个文件 728 项，lint、typecheck 通过。
- 技术说明 10-23 版 21 页：新增 AI 技术选型、核心功能、场景测试两页，创新点拆成技术 / 应用，局限单独一页；表格单元格改为自己断行（不再出现行首标点），构建时检查标题宽度。验收 `eval/results/technical-pdf-2026-10-23/`，逐页看过。
- 同步：README（场景测试一节、知网 DOI、测试数）、答辩问答第 26 题、提交清单、讲稿第 09 章与演示稿测试数改为 728。
- 依赖：pnpm audit（npm 官方公告库）显示 next 16.4.0 有 2 个严重级、1 个高危公告，升到 16.4.1（20395c9）；MCP SDK 1.31.0 剩下的公告针对 HTTP 传输，本项目 MCP 只走 stdio，暂不升级。
- 魔搭：先部署 fe770c8，升级后再部署 20395c9（魔搭仓库 c9b4667，运行时 2026-10-24T05:44:24Z）；公网桌面、手机各测 6 条，结论全部符合，axe 0 处，记录 `eval/results/modelscope-2026-10-23/`。
- 仍待本人：团队信息、预指导（10-31 前）、按新界面重录视频、填写 `CROSSREF_MAILTO` 与 `OPENALEX_API_KEY`、正式提交。

## 2026-10-20～22：标准体检中文期刊联网核查（另一会话开发，10-23 合并）

- 做法：Crossref 没确认的中文期刊论文（含英文译名附中文原文的），用 DeepSeek 搜索接口（搜索引擎，不是大模型）按题名查知网、万方、维普，再补查维普和不限站点；读手机知网文章页内嵌数据和期刊官网 citation_* / DC / PRISM 元数据补作者、卷期，必要时按 ISSN、卷、起始页到 Crossref 定位；WebVPN 镜像、文库等转载站不当来源。代码 `src/lib/verify/cnjournal.ts`、`sources/cnpage.ts`、`sources/cnweb.ts`、`throttle.ts`。
- 规则：题名、刊名、年份一致，作者对得上，卷、期、起始页至少一项一致，才判已核实并写明来源；只差作者或卷期页码给相近候选和原文链接；作者对不上判信息有误。没有 DeepSeek 密钥时整步跳过。
- 额度与时限：搜索同时最多 3 个、间隔 250 ms（DeepSeek Search 限 5 QPS），结果缓存 6 小时；每次请求最多 30 条（`CN_SEARCH_BUDGET`），单条 25 秒，离 Netlify 50 秒时限不到 8 秒不再开始。
- 评测：已看过的六个集合 122 条中文期刊论文回归，待人工 91% → 32%，新口径误报 0（`eval/results/zh-regression-2026-10-19/`）；新抽 90 条中文参考文献只运行一次，中文期刊论文 40 条待人工 95% → 32.5%，已核实 15 条、相近候选 11 条逐条复核都是引文那篇（`eval/results/real-blind-zh-2026-10-19-adjudication.json`）；10-22 对照实验 20 条中文补跑，虚构 10 条没有一条判成已核实或信息有误（`eval/results/compare-2026-10-18/rules-cn.json`）。
- 已知短板：物理类引文“作者 年份 刊名 卷 页”没有题名（新样本 28 条），按题名查不了；引文只写“卷: 页”时知网没有卷号，只能给相近候选；官网只给英文刊名时（如汉斯）刊名对不上。新样本已经看过，再改规则要另抽样本。
- 10-24 补齐材料：答辩问答第 3、10、14、17、21、22 题（第 10、21 题原来还写着只有用 AI 功能才发给 DeepSeek、标准核验只核 Crossref 且不读页面），试用指南与试用记录表 xlsx（隐私、中文说明、Netlify 版没有跟着更新），提交清单，README 与对照实验报告写入中文补跑。

## 2026-10-18（America/Los_Angeles）：魔搭国内入口已上线，主要功能验收通过

- 用户已选择“魔搭云端构建”，目标为国内老师试用入口；不安装 Docker Desktop，不重写为 Streamlit，不替换或删除 Netlify。历史“时空呼吸”使用的是 Streamlit Cloud，未找到已完成魔搭部署的证据。
- 账号令牌已有效：通过官方 `GET /openapi/v1/users/me` 验证，账号 `kgkvybu111111`。实际查询可用免费 Docker 资源为 `platform/2v-cpu-8g-mem`（2 核 / 8 GB，resource_type=free）；没有选择收费资源。
- 账号阻塞已解除：用户补齐绑定后成功创建 `kgkvybu111111/cite-checkup`，公开 Docker 创空间、免费资源。平台页 https://modelscope.cn/studios/kgkvybu111111/cite-checkup ，分配应用域名 https://kgkvybu111111-cite-checkup.ms.show 。此前 HTTP 400“未绑定阿里云账号”为历史失败；不再要求重复登录或令牌。记录同目录 `account-inspection.json`、`studio.json`。
- 已推送到魔搭：83 文件清单经 SHA 校验和本项目已知秘密值检查后，通过独立 `deploy-repository` checkout 上传，提交 `2e99b82ee0e0a5566dde53267fce675a9019a17c`，远端 master 已核对；没有强推或向 GitHub 推送。DeepSeek key 单独写入 Secrets，普通变量为项目实际 `OPENALEX_SEARCH_BUDGET`，模型/API地址沿用应用默认值。令牌仅通过子进程环境与 GIT_ASKPASS 传入，远端 URL 无令牌。
- 云构建与运行：2026-10-19T06:29:24Z 触发，云效 build ID `7f1a8b43-25de-4252-853b-39e851f74e6b`。Docker Linux 依赖安装、Next 生产构建、TypeScript 及镜像推送成功；镜像 digest `sha256:2ebaf6e98ab81ee641ea12fae232436289a3a745a4c6f8d670ca601e4cf24483`。最终状态 Running、运行配置为免费 Docker。证据 `source-sync.json`、`environment.json`、`deployment.json`、`build-logs.json`、`studio-status.json`。
- 公开访问：全新未登录浏览器通过上述魔搭平台页正常加载应用 iframe，无需老师登录、填写令牌或本机保持开机。直接 curl 分配的 ms.show 域名会得到平台鉴权提示；这不是应用崩溃，也不是让老师使用部署令牌的理由。统一分享带 mode=full 的平台页面。
- 已完成配置：`D:\Darks\projects\cite-checkup\Dockerfile`、`.dockerignore`、`docs\deployment\MODELSCOPE.md`；`next.config.ts` 仅在 `DEPLOY_OUTPUT=standalone` 时开启独立输出，不改变现有 Netlify profile。镜像使用 Node 22.22.3 Debian bookworm-slim、pnpm 11.22.0、非 root 用户、0.0.0.0:7860。pnpm 11 的持久平铺设置使用 `pnpm_config_shamefully_hoist=true`，否则构建时检查布局会触发无 TTY 重装错误。
- 已筛选源码：`D:\Darks\projects\cite-checkup\output\modelscope-2026-10-18\source-manifest.json`，83 个文件、711510 字节，排除环境文件、Git 历史、视频、测试夹具和本机输出。`source` 内另有本地 node_modules/.next；上传时必须按清单建立独立 Git 仓库，不能直接把 source 整目录加入 Git。
- 本地已验证：standalone 生产构建及 TypeScript 检查通过，next.config.ts 的 ESLint 和差异空白检查通过；24 项运行检查通过（首页、10 个静态资源、3 个字体抽样、4 个无密钥 AI 状态、普通/中文 PDF、DOCX、32 MiB 解压扩展返回 413）。PDF worker SHA 匹配、canvas 原生模块加载成功、记录的解析路径均位于 standalone 内；临时文件清空。
- 验收证据：`D:\Darks\projects\cite-checkup\output\modelscope-2026-10-18\local-qa\verification.json`、`runtime-resolution.json`、`server-session.json`。本轮未加载模型密钥、未调用真实 AI、未重跑此前的 625 项全量测试；Netlify 云端验证结果不能冒充魔搭云端验证。
- 云端已验证：4 个 AI 状态 GET 为 200/available；普通 PDF、中文 PDF、DOCX 正文/参考文献全部符合；真实 AI 解析 2 条有字段证据且无降级；论断 4/4 且引句定位一致；中文 Agent 经维普确认；图片 5 条题名全部命中。7 个模型 POST 顺序完成、无重试。浏览器标准示例 11/11、12.4 秒，6.1 秒时已收到 3/11，确认逐步更新；实际下载报告成功。桌面 1440px 和移动设备模式 360px 已查看，无应用横向溢出。
- 总证据：`D:\Darks\projects\cite-checkup\output\modelscope-2026-10-18\cloud-verification.json`；子证据 `cloud-qa\cloud-imports.json`、`cloud-ai\verification.json`、`cloud-ai\cloud-ai-response.json`；截图 `D:\Darks\projects\cite-checkup\output\playwright\modelscope-cloud-desktop-home.png`、`modelscope-cloud-mobile-device.png`。新报告独立保存为 `output\modelscope-2026-10-18\browser-standard-report.md`，SHA256 `ca6aea1e7e08722a4ff375fa1aa6bc0ecc7670a2e76da89892b00b6fa13ceb1f`；浏览器 .playwright-cli 的同名临时报告现为魔搭版，勿再当作 Netlify 原报告。
- 明确限制：8 MiB 和 8 MiB+1 两个边界请求分别在 60.003/60.007 秒被验收端取消，均无 HTTP 响应，不足以判断上传链路还是网关原因；因此总记录 allChecksPassed=false，仅主要功能就绪。建议老师先用小文件，较大论文粘贴参考文献。云端极限资源、长请求/取消边界及各大陆运营商可达性未完整验证；没有宣称免费平台永久稳定或总体准确率。
- 平台外层表现：匿名登录信息查询 401、iframe 权限警告，移动端外层另有 setAttribute 脚本异常；应用验收请求均成功。桌面浏览器缩到390px时平台外框仍最小1280px；真实移动设备模式使用另一套外框，360px正常。不把此结果写成控制台零错误或所有窗口尺寸均通过。此前本地 Windows 验收与失败的 WSL 安装证据保留，不与本次 Linux 云构建混淆。
- 操作工具在忽略目录：`D:\Darks\projects\cite-checkup\output\modelscope-2026-10-18\manage.mjs`（inspect/create/status）、`prepare-source.mjs`、`auth.env`（只记录位置，不记录内容）。Node 原生 fetch 在当前网络超时，工具复用已有官方 Netlify CLI 安装的 node-fetch；未关闭 TLS 或读取浏览器 cookie。
- 根仓库部署配置已提交并推送 GitHub：`e5f28f5`，仅 `.dockerignore`、`Dockerfile`、`next.config.ts`、`docs/deployment/MODELSCOPE.md` 四文件。老师试用指南已在本地补国内入口与大文件限制，沿用原有未提交修改。魔搭实际运行源码仍是其独立仓库 `2e99b82e`，不是 GitHub 自动部署；未触发 Netlify 重建。
- 下一步：用户把魔搭入口和老师指南发给老师，收集真实使用反馈；大文件边界作为已知待核实事项。后续更新按 `prepare-source.mjs` → `sync-source.mjs` → `manage.mjs deploy` 顺序，先核对既有项目/清单；同步脚本仅在清单范围提交到魔搭，默认 master、不强推，不把令牌写进 remote。两站没有自动同步钩子。
- 运行/文件责任：本轮所有本地服务器、WSL 构建、4 个验收浏览器和代理任务均已结束；仅云端应用持续 Running，不依赖本机。本状态由主执行者维护。保留既有视频/评测等未提交改动，未代老师填写试用反馈或正式参赛提交。

## 2026-10-18（America/Los_Angeles）：Netlify 免费部署已上线并验收

- 用户最新决定：不再使用 Render，改用 Netlify；用户已完成 Netlify 网页登录。Render 仅浏览过面板，没有创建服务、付费资源或上传秘密。下方 Render 配置留作历史，不再执行其部署步骤。
- 已新增：`D:\Darks\projects\cite-checkup\netlify.toml`、`D:\Darks\projects\cite-checkup\docs\deployment\NETLIFY.md`；显式启用官方 Next.js / OpenNext 适配器、Node 22.22.3、锁文件 pnpm 11.22.0，未创建静态 Drop 站点。
- 平台适配：构建标记 `NEXT_PUBLIC_DEPLOY_TARGET=netlify` 统一文档/图片合计 4 MiB；check/agent/claims/vision 路由从入口共用 50 秒预算，超时流发 fatal、保留已有结果、取消下游且释放预约；非流式返回 504。非 Netlify 默认上限与底层库/MCP预算保留。共享文件为 `src/lib/deployment-limits.ts`、`src/lib/request-deadline.ts`。
- 本地已验证：40 文件 625 项测试、lint、typecheck、Netlify profile 生产构建通过；独立复核未发现阻塞部署问题，安装版 NextRequest 正文复制/取消探针通过。生产版 3212 的 vision 状态显示 4 MiB，小 PDF/DOCX 返回预期正文与 DOI；390px 无横向溢出。本地一次标准核验触发 50 秒未完成提示、表单正常恢复，不计作完整成功。证据 `D:\Darks\projects\cite-checkup\output\netlify-2026-10-18\local-verification.json`。
- 已提交并推送：`0c3ab2d87c28a4dc000eb13e02f69d28b3f3fd50` 为 16 个部署适配/测试/说明文件；`cf1b845615b2765af7f9b60ba4d55f1468247036` 显式启用适配器，为线上源码版本；`9e257bd` 只补正式网址及验收说明，没有再次部署。既有视频、状态、评测等未提交修改保留。
- 接入已完成：用户已授权官方 Netlify CLI 27.13.0。C 盘同目录 rename 实测 EXDEV，D 盘通过；仅对 CLI 进程将 APPDATA 指向 `D:\Darks\.netlify-cli`（不改全局环境），凭据留该目录不进项目、不打印。不读取浏览器 cookie。
- 已上线：`https://cite-checkup-ql514740.netlify.app`；面板 `https://app.netlify.com/projects/cite-checkup-ql514740`；站点 ID `e40e1a96-ff64-4d59-b866-3aea90f28b37`。部署 `6ad59f2e255dbb55546fb0b7`，构建 `6ad59f2e255dbb55546fb0b5`，状态 ready，2026-10-19T04:41:38.548Z 发布，1 个 Next.js 服务端函数。账号 Free / credit-free、300 credits、自动充值 false；未启用收费资源。DeepSeek API 使用原有额度，并非免费服务。
- 已配置必要运行时变量：项目已有 DeepSeek 密钥、模型、API 地址、OpenAlex 检索预算及 Node 22 runtime；秘密通过官方 API 写环境变量，未打印或入库。没有擅自补填项目缺少的 OpenAlex key / Crossref 邮箱。源码 ZIP 来自 cf1b845 的 git archive，SHA256 `02B4FD0F77C0B0EAD5A454331D2EC53085AF473A3C6FE2FA481A8CF8CE40B0EA`，不含 `.env.local`。没有 GitHub 自动部署钩子，后续推送不会自动更新站点；需再次触发源码 ZIP 构建或关联已有项目，不要重复建站。
- 云端已验收：首页及静态资源；4 个 AI GET 状态 HTTP 200 / available；PDF、DOCX、中文 PDF 导入全部正文/参考文献断言通过；真实 DeepSeek 解析 2 条、论断核查 4/4 通过；浏览器标准示例 11/11、约 7 秒完成并实际下载报告；中文 Agent D094 经维普确认作者/题名/年份；图片识别 5 条英文题名全部命中；390px 无横向溢出、4 MiB 标签正确；新浏览器控制台 0 错误/警告。只说明这些样本，不等于所有真实用户输入都已验收。
- 证据：总记录 `D:\Darks\projects\cite-checkup\output\netlify-2026-10-18\cloud-verification.json`；同目录 `cloud-imports.json`、`cloud-agent.ndjson`、`cloud-vision.json`、最终 build 日志；`D:\Darks\projects\cite-checkup\eval\results\ai-smoke-2026-10-19T04-43-49-837Z.json`、`claims-smoke-2026-10-19T04-44-05-561Z.json`；`D:\Darks\projects\cite-checkup\output\playwright\netlify-cloud-desktop.png` / `netlify-cloud-mobile.png`；下载报告 `D:\Darks\projects\cite-checkup\.playwright-cli\引用体检报告-2026-10-19.md`。
- 已解决的部署失败：首次源码 ZIP 构建未自动装载适配器，产生 0 个函数、首页/API 404；在 netlify.toml 显式声明官方插件后重建修复，最终部署与功能检查全部针对 cf1b845。原始失败日志保留，不与最终成功混淆。
- 部署任务无剩余实现待办。已更新老师试用指南的公网入口与 4 MiB / 50 秒限制；下一步由用户安排老师真实试用并收集反馈。本轮 3212 临时服务器与验收浏览器均结束，原 3210 服务未主动关闭；部署不依赖本机进程。临时工具及证据在项目 output 目录，没有秘密值。
- 其他线索：上传边界测试发现既有 TXT 多 MiB 连续空格可能使清理正则过慢，未在本次部署适配中扩大修复；不把它记为本轮已解决。

## 2026-10-18（America/Los_Angeles）：Render 配置历史（已被 Netlify 方案替代）

- 当前目标：将完整网站部署到免费云服务器，让老师直接浏览和试用；不依赖本机持续开机。
- 方案：Render 单实例 Free Node Web Service，新加坡；保留当前 Next.js API、PDF worker 和流式核验。Sites 的 Workers 运行环境不适合直接承载现有 Node worker/原生依赖，未创建 Sites 或临时隧道。
- 已完成：`D:\Darks\projects\cite-checkup\render.yaml` 和 `D:\Darks\projects\cite-checkup\docs\deployment\RENDER.md`；Node 22.22.3（本机生产 Node 同版本）、pnpm 11.22.0、锁文件安装、0.0.0.0:$PORT、首页健康检查、关闭自动部署、秘密通过服务端环境变量注入。无付费资源或数据库。
- 已验证：YAML 通过 Render 官方 JSON Schema；`git diff --cached --check` 通过。此次只增加部署配置及说明，未改业务代码，复用当天 589 项测试及生产构建证据，未将本地验证称为云端验收。
- 已提交并推送：`a8b6ea8`，只含上述两文件，无 Claude 署名；既有视频、状态、`.claude/launch.json` 等未提交修改保留。
- 部署入口：https://dashboard.render.com/blueprint/new?repo=https://github.com/newhack-cpu/miniature-fiesta 。如果插件已创建服务，应继续已有服务，勿重复套用 Blueprint。
- 当前限制：用户随后明确跳过本次 Render 插件安装/连接，不再建议或依赖该插件。改用已推送的 Blueprint 网页入口；仍需用户完成 Render 注册/登录及 GitHub 授权。未创建云服务、未取得公网 URL、未上传本地秘密。
- 下一步：用户通过上述 Blueprint 入口登录，确认 Free 计划，将必要的 `.env.local` 服务端变量填入 Render（不复制 localhost 代理），点击 Deploy / Apply；取得面板网址后继续通过公开 HTTP 和浏览器验收首页、静态资源、标准核验、PDF/DOCX 导入、AI 解析/论断与中文检索。不要要求插件或将配置已推送称为网站已上线。
- 免费边界：闲置 15 分钟休眠，约一分钟唤醒；512 MB / 0.1 CPU，PDF 与真实 API 耗时待云端实测；托管免费不等于 DeepSeek 调用免费。用户已被告知休眠和原有 AI 额度。
- 本轮无新启动的持续运行进程；原本机 3210 生产服务未更改。

## 2026-10-18：双视频已交付

- 用户已授权制作正式参赛视频与给老师看的操作教程；老师试用由用户联系安排。已选择云希男声 `zh-CN-YunxiNeural`，合成音标明来源。
- 基线 `474c66a`；工作目录 `D:\Darks\projects\cite-checkup\docs\competition\media\video-2026-10-18`，分工与要求见 `BRIEF.md`。未改产品 `src`，未提交或推送；保留原有 `.claude/launch.json` 修改。
- 正式成片：`D:\Darks\projects\cite-checkup\docs\competition\output\video\引用体检-完整演示-1080p.mp4`，464.061333 秒，62,449,228 字节，SHA256 `3cfd1f472d36dbaa8eec21f545123b50233ccb7ff22d8ab022dcd77802e53205`。
- 老师教程：`D:\Darks\projects\cite-checkup\docs\competition\output\video\引用体检-老师操作教程-1080p.mp4`，246.741333 秒，37,237,694 字节，SHA256 `d8d609be1f9e23dd0a3e78507482fe0008261aae6c53c0467fac768097c50790`。两片均为 1920×1080、25 fps、H.264/AAC，云希普通话合成旁白与烧录中文字幕，另附同名 SRT。
- 已验证：两片完整解码、媒体规格、音视频末端、全部 17 章语音/字幕范围、真实源片段对应通过；实际查看两张逐章联系表及 23 张全尺寸帧，覆盖 17 章。旁白 17 条完整性/削波检查及四章本地 ASR 抽查通过；没有人工听审，视觉验收为抽帧而非逐帧观看。独立验收为工作目录 `final-video-QA.json`、`visual-QA.json`；正式目录 `video-verification.json`、`tutorial-video-verification.json` 分别绑定最终 SHA256。
- 当天生产检查：38 文件 589 项测试、build、typecheck、lint 通过。真实 AI 解析与论断冒烟 4/4 通过；修复 `scripts/smoke-ai.mts` 将正常解析提示误判为降级的问题，并增加 AI 字段证据断言后实连通过。MCP 列工具/核验参考文献成功，`check_claim` 冒烟曾超时，未声称全通过；正式 MCP 片段只展示真实参考文献核验。
- 录制与重录：参考文献录屏等待及选择器问题已修后重录；主片论断首次引句校验未通过，只重试一次后获得有效全文引句；教师知网来源页加载为空白，重录为真实打开新标签并返回候选说明，未伪称阅读成功。原始失败保留。长等待剪短均标记，合成材料有标识，无响应回放、循环或冻帧补时。细节见工作目录 `recording-notes.json`、`raw-verification.json` 和 `docs/competition/media/README.md`。
- 旧 MP4、旧验收和旧时间记录已在替换前备份并校验，目录 `D:\Darks\projects\cite-checkup\docs\competition\output\video\history-2026-10-14`。新版章节时间与来源记录在 `D:\Darks\projects\cite-checkup\docs\competition\media\recording-timing.json`；正式交付清单在工作目录 `delivery-manifest.json`。
- 按 VIDEO_PROMPT 的真实生产运行与本地 Playwright/FFmpeg 流程制作；ChatCut 本会话缺少可调用工具，没有云端上传。云希使用隔离 edge-tts 7.3.1，未修改全局依赖。没有调用 MiniMax。
- 运行状态：所有录屏浏览器和录制任务已结束；生产服务 `http://127.0.0.1:3210`（PID 29136）保留供用户试用，已核实 HTTP 200；服务日志和交接见工作目录 `capture/service-handoff.json`。MCP 3211 的临时演示服务及其 stdio 子进程已关闭，已核实无监听；证据为工作目录 `mcp/shutdown.json`。
- 本轮视频任务无制作待办。下一步由用户观看并安排老师按 `D:\Darks\projects\cite-checkup\docs\competition\TRIAL_GUIDE.md` 实际试用，取得真实反馈后再修改材料；不编造人数、用时或使用意见。没有正式参赛提交、公开部署或 Git 提交/推送。

## 2026-10-18：中文检索补查维普失败时保留首轮候选

- 起因：上一节通读发现、用户转来的问题：`cnJournalSearch` 首轮在知网、万方找到同题名文章（没有作者）后补查维普，补查一旦遇到限流、余额不足或连接失败，整个检索抛错，首轮候选跟着丢掉，卡片只剩“数据源暂时不可用”。
- 修复：`src/lib/verify/sources/cnweb.ts` 补查遇到 `UpstreamError` 时保留首轮结果，返回 `supplementError`；取消、总时限到了照常抛出。`src/lib/agent/tools.ts` 把首轮候选照常交给规则，检索步骤写“补查维普作者未完成（原因）”，并告诉模型候选只来自首轮。
- 测试：新增 7 项（补查 429 / 402 / 503 / 连接失败都保留首轮结果；补查时取消照常中止；首轮失败仍报数据源不可用；Agent 端到端补查失败仍给知网候选）。其中 5 项先在旧代码上确认失败，修复后通过。全量 38 个文件 589 项、typecheck、lint、生产构建通过。
- 浏览器：生产版桌面实测 D095，补查正常时结果不变（知网相近候选 + 链接），控制台无报错。补查失败分支真实接口触发不了，只由测试覆盖。
- 材料：测试数 582 → 589（README、技术 PDF 第 11 页、讲稿第 09 章、演示稿、提交清单）；`docs/competition/README.md` 的 7 分 35 秒改为 7 分 40 秒；“本人录制”统一为“本人录音，没有录音时按 VIDEO_PROMPT.md 用合成音并注明”。技术 PDF 重建仍 14 页、行首标点 0 处，重验记录 `eval/results/technical-pdf-2026-10-18/`。
- 仍未处理：PDF 验收 JSON 的 `visualReview` 由脚本固定写“pending human image inspection”，需要本人看图后确认；其余待办见下一节。
- 独立复核（用户再次询问“现在呢”）：当前 HEAD `474c66a`；已对照 `db06b64..474c66a` 核对补查失败保留候选、错误提示、取消传播和新增测试。定向重跑 `cnweb.test.ts`、`agent.test.ts` 共 2 文件 59 项全部通过；本轮未重跑全量、构建、浏览器或付费模型调用，未改业务代码。
- 材料独立核对：当前制作入口已统一 589 项测试、约 7:40 与配音说明；最新 PDF 实物哈希和 10-18 验收记录一致，视觉检查仍待确认。现有 MP4 哈希与旧验收记录一致，时长 398.593 秒，仍非新版成片。
- 提交时不加 Claude 的 Co-Authored-By 行（用户已清理过历史署名）。本文件仍只在本地修改，没有提交。

## 2026-10-18（America/Los_Angeles）：当前项目通读

- 本次目标：用户要求先看一遍当前项目；仅梳理代码、近期改动、已有评测与参赛材料，不启动功能修改或视频制作。当前 HEAD 为 `db06b64f4e9365cab55c8f6695ca71036ffbe0af`。
- 已核对：页面与两条核查流程、Agent 中文检索及候选判定、PDF OCR 修复、MCP、现有中文评测和第五批裁定、参赛清单。中文检索与逐条 AI 解析已落地，旧记录中的相应修复待办已完成；81/100 为此前版本的模拟评分，本次未重新评分。
- 本轮重新执行并通过：38 个测试文件、582 项测试；`pnpm typecheck`；`pnpm lint`。未重新构建、启动浏览器验收、调用真实模型或重渲染 PDF；未读取密钥或第五批原始盲测集。
- 现有证据：中文 75 条找到论文页面候选 33 条，仅规则确认 1 条；第五批 108 条复核误报旧口径 6、新口径 5。这些数字不等于总体准确率或中文核验成功率。
- 新发现待办（静态代码核对，未动态复现）：`src/lib/verify/sources/cnweb.ts` 中补查维普抛错会使整个检索失败，丢掉首轮已有候选。后续修复应保留首轮结果并覆盖补查失败分支。
- 材料仍需收尾：新版视频未交付；参赛材料 README 的 7:35 / 本人录音说明与最新 VIDEO_PROMPT 的约 7:40 / 可选神经合成音不一致；PDF 验收 JSON 的 visualReview 仍标 pending，需与历史人工查看记录对齐；真实试用、第二标注者、清洁环境复现、团队信息与本人提交仍待完成。
- 本轮仅补充本状态，保留原有 `.claude/launch.json` 和状态文件未提交修改；无持续运行作业。下一步按用户指示继续，优先处理上述候选保留问题及材料一致性。

## 2026-10-17（America/Los_Angeles）：清理 Git 提交共同作者署名

- 用户要求先清除 GitHub Contributors 中的 Claude 署名；本次只处理历史提交署名，未修改 Claude Code 的未来署名设置。
- 已清除 main 全部 27 条提交中的 Claude Co-Authored-By 行，并以明确旧 HEAD 的 force-with-lease 推送；远端 HEAD 已核实为 `db06b64f4e9365cab55c8f6695ca71036ffbe0af`，本地 main 与 origin/main 已同步。
- 已逐条验证 27 个文件树完全相同，原作者、提交者、时间及其他提交头保留；工作区和暂存区原有修改保持不变（`.claude/launch.json`）。无需重跑业务测试。
- 旧 HEAD：`8b3cf89c1339bd6d4582a1f4cd2b98e29913c912`。历史引用的旧提交号可通过映射查询；未重写旧评测记录。
- 已验证的原始历史备份：`D:\Darks\projects\cite-checkup\.git\attribution-cleanup-20261017\before-cleanup.bundle`；完整旧新提交映射及验证结果：同目录 `verification.json`。备份只保存在本地。
- 本清理记录保存在本地 PROJECT_STATE.md，未另加远端提交。现有 detached worktree 未改动；后续在旧 checkout 继续开发前应先对齐新历史，避免重新合入旧署名。
- 本次清理任务无待办；项目其他待办仍按以下记录执行。

## 2026-10-17 晚：中文期刊联网检索

- 视频前的改动已完成并提交；视频按 `docs/competition/VIDEO_PROMPT.md` 交给 GPT 做。
- 起因：用户问 DeepSeek 的 Search API 能不能覆盖中文，同意接着做，做完再重做视频。
- 实现：
  - `src/lib/verify/sources/cnweb.ts`：调用 DeepSeek `/v1/tools/search`，查询限定 `site:cnki.net OR site:wanfangdata.com.cn OR site:cqvip.com`（官方文档写法），只解析维普、知网、万方的期刊论文页；同题名记录都没有作者时，再只查一次维普。
  - Agent 新工具 `search_cn_journals`，只接受题名，站点由服务端写死。
  - `match.ts`：网页记录没有作者时不算同一篇；`verify.ts`：网页候选的提示为“在知网找到题名、刊名、年份一致的文章，但没有作者信息，请打开链接核对作者”，没有作者的候选不生成规范写法。
  - 卡片上“打开知网页面”之类的链接，报告写来源页面；GB/T 写法支持只有期号、没有卷号。
- 评测（`pnpm eval:agent --lang=zh`）：
  - dev 33 条（看过）：找到论文页 17 条，确认 1 条（D094，维普，已核实），题名、年份（刊名）一致、只差作者 14 条，英文译名引用中文文章 1 条，题名相近的另一篇 1 条（D099）。
  - test 20 条（看过）：找到 9 条，一致 6 条，英文译名 3 条。
  - 第五批 22 条（第一次运行）：找到 7 条，一致 6 条，英文译名 1 条，确认 0 条。
  - 三个集合都没有变成“疑似不存在”的；逐条看过 33 条候选，没有错误确认。每条平均 2.3–2.7 次工具调用、约 5.8 千 token、7–8 秒。记录：`eval/results/agent-{dev,test}-2026-10-17-zh-cnweb.json`、`agent-blind-2026-10-17b-zh-cnweb.json`。
- 试过没用上的：Fetch 抓知网、万方页面拿不到作者，还要 20 秒以上；12 条没找到的期刊论文换四种查询写法，只多找到 T098。
- 浏览器：生产版桌面 1440、手机 390 实测 D094（已核实，来源：维普，带维普链接）和 D095（知网相近候选，带链接），无横向溢出、控制台无报错。看截图时发现两处并修好、补了测试：没有作者的候选也给了缺作者的规范写法（已去掉）；有一次桌面上模型对 D094 一次检索都没做就结束（中文期刊论文还没查这三站就要结束时，服务端退回一次 finish；评测里没查中文库的 2 条是图书和网页，不受影响）。修好后桌面、手机再测，两条都正常。
- 验证：38 个文件 582 项测试、typecheck、lint、生产构建通过。
- 文档：README（功能表、Agent 工具、“中文期刊联网检索”一节、判定原则、评测表、隐私、局限、致谢）；技术 PDF 第 1、5、11、13、14 页（重建后仍 14 页，行首标点 0 处，逐页看过改动页）；答辩问答第 3、10、14、17 题，新增第 21 题；演示稿第 04 段加中文演示，目标 7:40；讲稿第 04、09、10 章，共 460 秒；提交清单、试用指南、视频任务说明。仓库已公开，技术 PDF 和清单同步。

## 2026-10-17 白天：按复评修复四项（已提交 e93229f、79ea56e）

- 起因：08:50 复核（我的估分约 74.5，另一会话的复评为 81），用户同意按清单修。基于 HEAD 0eae187，改动都在工作区，未提交。
- OpenAlex 合并记录：OpenAlex 现在把示例第 05 条（arXiv 10.48550/arxiv.1706.03762）归在登记 DOI 为 10.65215/2q58a426 的 W2626778328 下，旧代码把 DOI 不一致当“无法识别的数据”，卡片显示“撤稿状态交叉核验未完成”并让人“稍后重试”。现在 `openalexByDoi` 把这类记录放进 `merged`：题名、第一作者对得上且无撤稿标记，就算核验完成；带撤稿标记或对不上，只提示人工核对，不判撤稿。结论不变，只影响注释和步骤。浏览器复查：示例 11 条 9.3 秒，第 05 条为干净的“已核实”。
- PDF 隐藏文字的 OCR 豁免（复评 P2）：判为扫描件 OCR 层，现在要求该页画了覆盖过半版面的图像，或该页 90% 以上文字不可见；OCR 层里像指令的行仍然报告并去掉。复评的 707 字节样例改为检出。新夹具 `ocr-scan.pdf`、`invisible-majority.pdf`（`generate_ocr.py` 生成）。技术说明 PDF 无误报，预印本夹具结果不变。
- 文案：MCP `check_claim` 说明改为开放全文优先 + 混合检索；首页标题改为“三道检查，查不到再交给 AI”；README 修正收录范围的表述、OCR 规则、Agent 中文 0/52 里 47 条是额度用完，并补上第四批复核后的修复与回放。
- AI 辅助解析：改为只发送规则没解析出题名的期刊、会议、预印本和认不出类型的条目，逐条校验、坏条目单独退回；摘出的刊名只校验不采用；比对表标“AI 摘出”；页面提示发送、补上、退回的条数。用录下的同一批应答对照（只用 Crossref）：dev 发送 6 条、test 发送 29 条，结论与标准规则逐条相同。改版中途 test 暴露的 T066、T092 两处退步已修，并补了测试。
- 验证：37 个文件 553 项测试、typecheck、lint、build 全过；桌面 1440、手机 390 截图检查“AI 摘出”标记与提示，无横向溢出，控制台无报错。
- 晚上（17:05 起）：
  - **第五批盲测** `blind-2026-10-17b`（108 条，英 84、中 24，63 篇源论文）规则模式只跑一次：已核实 51，自动统计旧口径 8 / 新口径 7；逐条复核误报旧口径 6（5.6%，2.6–11.6%）、新口径 5（4.6%），真实错误 1（DOI 截断）、无法确认 1（工作论文年份）。误报原因：数据库元数据与论文不一致 2、配到另一件作品 2、工作论文 / 学位论文没识别出来 2。中文 24 条只看汇总，留作评估中文检索。记录：`eval/results/real-blind-2026-10-17b-{rules,ai,adjudication}.json`。
  - **AI 辅助解析对照**（规则组录应答、AI 组回放）：dev 无变化；test 多核实 2（T028、T070）、多抓 1 条真错（T057）；第五批无变化。过程中又修两处：输入检查对双重编号整批拒绝（去两次编号）；B052 会议论文被 AI 摘出题名后判疑似不存在（AI 摘出的题名查不到不作为疑似不存在的依据）。改后用最终代码重放第五批规则模式，108 条逐条相同。记录：`eval/results/ai-parsing-ab-2026-10-17.json`。
  - **Agent 中文重测**（`--lang=zh`，OpenAlex 给足）：dev 33、test 20 条，OpenAlex 实际检索 52 次，仍 0 条。0/52 不是额度造成的。
  - **DeepSeek 联网搜索探针**：官方 `/v1/tools/search`（自研引擎，每千次成功请求 0.75 美元）对 10 条中文期刊引文找到 7 条，6 条命中知网 / 万方 / 维普论文页；Fetch 抓维普有作者刊名年期，知网手机版有题名刊名年期，万方抓不到。记录：`eval/results/deepseek-search-probe-2026-10-17.json`。是否接入等用户决定。
  - dev / test 用今天的规则重跑（`real-{dev,test}-2026-10-17-*.json`）：与 f36bd3e 回放一致，无退步。
  - 37 个文件 556 项测试、typecheck、lint 通过；README、技术 PDF（重建 14 页，逐页查看改过的页）、答辩问答（第 14、17、18 题，新增第 20 题）、提交清单、演示脚本、讲稿（03、09 章）已同步。新增 `docs/competition/VIDEO_PROMPT.md`（交给 GPT 重做视频）、`TRIAL_GUIDE.md`（老师试用指南）。
- 下一步：等用户决定是否接入 DeepSeek 中文检索（建议先做再录视频）；提交并推送需用户同意；视频按 VIDEO_PROMPT.md 在改动提交后再做；作品赛预指导 10-31 15:00 截止（须先缴省赛费）。

## 2026-10-17 当前代码复评

- 对象：`D:\Darks\projects\cite-checkup`，当前审查 HEAD `0eae187247d1d7c9f4d888fd9c07fb6ec2b4c590`；审查开始为 `f36bd3e`，新增提交仅补 B040 测试，产品代码未变。本轮只评审，未修改产品，未读取新的 `eval/real-world/blind-2026-10-17b.json`。
- 评分：按重新取得的官方六维度，工程模拟 **81/100**（旧 73），AI 29、创新 20、前端 9、实用 7.5、体验 9、社会商业 6.5。不是官方成绩或获奖预测。
- 有效报告：`D:\Darks\projects\cite-checkup\docs\competition\REVIEW-2026-10-17.md`；原始官方口径、工程日志、两份独立审查和 PDF 最小复现在 `D:\Darks\projects\cite-checkup\eval\review-2026-10-17\`；桌面/手机截图在 `D:\Darks\projects\cite-checkup\output\playwright\review-2026-10-17\`。
- 已验证：全套测试 37 文件 539 项通过，随后针对最新提交所在文件补测 30 项通过；typecheck、lint、生产 build 通过。浏览器实际查看桌面 1440×1050、手机 390×844，任务切换、方向键、示例填入、DOCX 预览确认、切换保留输入通过；手机检查无横向溢出，控制台无错误。本轮没有重新执行外部模型调用，AI/MCP/检索依据现有实测和当前源码；没有重渲染 PDF。
- 修正下方历史状态：`f36bd3e` 已修复第四批暴露的覆盖类型/解析/机构作者问题，并提交 `eval/results/replay-2026-10-17.json`；下方“没有为它改规则”、相应修复待办是修复前快照。最新回放第四批为 36 核实、5 有误、3 相近、1 疑似不存在、66 无法核验，按既有裁定仍有 B040/B057 两条误报。回放只证明已见集合回归；旧 17/111 是修复前盲测，不能叫当前准确率，修后也没有新独立盲测成绩。
- 新发现：`src/lib/documents/pdf.ts:104/112` 只凭不可见字占比认定 OCR 并跳过隐藏检查；离线无图 PDF 复现 `hidden:null` 且不可见指令进入正文。仅证明预处理漏检，未测试模型是否遵从。MCP description 仍写摘要/BM25；README 对刊物覆盖保证过强；中文 Agent 52 条中 47 条遇到 OpenAlex 预算耗尽，不能只归因为数据源限制。
- 待办及下一步：修 PDF OCR 豁免并补回归；校正 MCP/首页/技术材料的过时或过强说明；固定规则后用公平预算的新样本验证并引入第二标注者；真实用户试用；同步技术 PDF 与新版视频。团队信息、评审访问、清洁环境复现及本人提交仍待完成，公网部署仍为可选。
- 负责人及运行任务：主执行者维护本状态和最终复评；AI/评测子代理已交付独立审查，不修改产品。临时评审浏览器和本地预览在本轮结束时关闭，不依赖持续作业。

## 2026-10-17 第四批盲测：新口径检验（修复前历史快照）

- 抽样：在 81f6f67（“相近候选”单列）之后用 `pnpm sample:real --out=eval/real-world/blind-2026-10-17.json --seed=3` 抽样，111 条（英文 87、中文 24），63 篇源论文；与 dev、test、blind、blind2 的源论文和原文重叠都是 0（脚本只统计重叠数）。只看了每组条数：IEEE 仍为 0 条，IOP 3 条，其余各 12 条。
- 运行：02:10–02:12（UTC-7）只运行一次，`NODE_USE_ENV_PROXY=1 pnpm eval:real eval/real-world/blind-2026-10-17.json --out=eval/results/real-blind-2026-10-17-rules.json`。运行前确认 `src`、`scripts` 与 HEAD 一致，与抽样隔开约 3 分钟。结果：已核实 30、信息有误 11、相近候选 3、疑似不存在 9、无法核验 58、出错 0；自动统计旧口径 23、新口径 20。
- OpenAlex 额度（代理出口，单条 DOI 查询读 `X-RateLimit-Remaining-USD`，不计费）：运行前 0.065 美元，运行后 0.051 美元，约 14 次题名检索，没有因额度不足跳过检索。复核没有用 OpenAlex 题名检索。
- 逐条复核（`eval/results/real-blind-2026-10-17-adjudication.json`，格式同 blind-2026-10-16b，多了新口径字段和 `byGroup`）：
  - 旧口径（相近候选也算）：误报 20 条，18.0%（95% 区间 12.0%–26.2%），全部英文；其中疑似不存在 9 条。
  - 新口径（相近候选不算）：误报 17 条，15.3%（9.8%–23.2%）；相近候选 3 条单列，都是真实文献、候选都不是同一篇。
  - 真实错误 3 条（B003 作者写成 “Outcomes M.”；B037、B038 出自同一篇源论文，把中国作者的名当成姓），系统都标为信息有误；无法确认 0。
  - 误报原因：覆盖范围外类型没识别、被判疑似不存在 7（手稿、德语报告、法院裁定新闻稿、无编号预印本、专利、IHO 标准、JICA 简报）；刊物不在 Crossref / OpenAlex 1（Vortex）；引文格式解析 6（“Journal Pre-proof” 水印残字当题名、题名中的分号、空逗号 2、粘连的 “van derValk”、DOI 里的 U+2010 连字符）；配到另一篇或转载 2；IUCN 记录把机构登记为作者 1；相近候选 3。
  - B002 是唯一一条把真实引文说成“疑似编造”的：作者、刊名、文章号、DOI 全对，只是没写题名，水印残字被当成题名。
  - 有小错但系统报的不是这些的，按口径仍计误报并在 reason 注明：B048（出处写的不是书名）、B070（日期、地点写错）、B079（作者项是 “JICA Project Brief Note” 拆出来的）。
- 解读：新口径只去掉 3 条（18.0% → 15.3%），剩下的误报主要是覆盖范围外类型和引文格式。旧口径 18.0% 高于前三次盲测（10.1%、9.1%、11.7%），区间与第三批部分重叠；Cambridge 一组 12 条里 7 条误报（4 篇源论文，引的是法律政策文件、数学论文、专利、航海标准），被标出的 23 条里 7 对来自同一篇源论文，按条目算的区间偏窄。中文 24 条全部无法核验。
- 这批数据已经看过，之后不再算盲测；没有为它改规则或重跑。
- 复核取证：Crossref、PubMed（Europe PMC 接口）、DataCite 按 DOI 查询，其余用网页检索找原始出处；IMO 决议用 WebFetch 打开时存下了一份 PDF（762 KB，在本机工具结果目录，未放进仓库），B056 的网址只发了 HEAD 请求。
- `scripts/__tests__/real-results.test.ts` 现在核对 13 个结果文件，通过。
- 文档：README“真实论文参考文献评测”（五个集合、旧口径表格加一行、第四批结果一节、明细链接）、`DEFENSE_QA.md` 第 14、18、19 题、`SUBMISSION_CHECKLIST.md`、`DEMO_SCRIPT.md` 时间表 01:25 一行、`technical-content.json` 第 4、11、13、14 页。
- 讲稿：`narration.json` 第 03 段改为三批新盲测 9%、12%、18%，最新一批去掉相近候选为 15%；同时删了几处虚字，这一段从 260 字变为 264 字，按约 250 字/分钟仍在 65 秒内，各段秒数和总长 455 秒不变，全稿约 1730 字。
- 技术 PDF：重建为 14 页，validate 通过（文字可选、页码齐全、无出界；`eval/results/technical-pdf-2026-10-17/` 覆盖了当天早先的验收，旧版可从 git 历史中的 PDF 重新生成）。
  - 第一次构建第 4、11 页放不下：第 4 页那段压缩重写；第 11 页把第二、三批合成一行，新增第四批一行。
  - 逐页看了 14 张渲染图，修了三处排版：表格单元格把开括号“（”留在行尾、“评测限制”一段行尾空出一截、第 4 页末行只剩一个字。
  - 终版与上一版渲染图比对，只有第 4、11 页变化；脚本检查行首标点 0 处、行尾开括号 0 处。
- 待办：
  - 覆盖范围外类型（专利、标准、法院文件、手稿、项目简报）和未写编号的预印本改判为无法核验，英文转写的中文期刊同样处理；
  - 修引文格式的几处（水印残字、分号、空逗号、粘连前缀、DOI 里的 Unicode 连字符）；
  - 请第二人独立标注、扩大样本，按源论文做聚类区间。改完要另抽新集检验，不能用这批。

## 2026-10-17 “相近候选”单列

- 用户 10-16 夜在三个方案里选定 A：新增结论 `near_match`（相近候选），不再与确认有误的条目一起算“信息有误”。另两个方案（保持 mismatch、按 matchStatus 分组；并入“无法核验”）没有采用，评估记录在会话笔记里。
- 引擎（`src/lib/verify/verify.ts` 的 `judgeNotSame`）：
  - 只找到相近候选、没有 DOI 证据的条目，以及 OpenAlex 额度用完、又没有 DOI 问题的条目，判为相近候选：issues 为空，说明写在 notes 里，summary 为“找到相近文献，但不能确认是同一篇，请人工核对”。
  - DOI 未注册或指向别的文献、另有相近候选的条目仍是信息有误（DOI 的错误是确定的）；额度用完时 summary 改为“DOI 有误；找到相近文献……”。
  - Agent 对覆盖范围外类型的“同名记录有出入 → 无法核验 + 候选”不变。
- 类型：`Verdict` 改由 `types.ts` 的 `VERDICTS` 常量派生；check-stream、agent-stream、MCP、`/api/check`、`eval`、`eval-real` 原来各写一份的结论列表都改为引用它。
- 界面：
  - 新印章、筛选标签和图例“相近候选”，新颜色 `--color-iris`（#6b4f8a，在卡片底色上对比度 6.4:1）；
  - 健康度不计入相近候选；顶部在“发现 N 条需要处理”之外单列“M 条相近候选待核对”；
  - 卡片默认展开，照样显示比对表、候选写法和“AI 继续查”；
  - “信息有误”的图例改为“确认是同一篇，但……写错了；或引用的 DOI 未注册、指向别的文献”。
- 报告：
  - 修正版清单：相近候选保留原文并标【仅找到相近候选……】，DOI 写错又有候选的标【DOI 有误，仅找到相近候选……】；
  - Markdown 报告：开头加“结论统计”，每条结论前加结论名（summary 本身以结论名开头的不重复）。
- MCP：
  - `verify_references` 的结论枚举加 `near_match`，工具说明写明它不是确认的错误；
  - counts 多一个键，文字摘要单列相近候选；服务端版本 0.1.0 → 0.2.0。
- 评测（`scripts/real-results.ts`）：
  - `eval:real` 同时打印两种误报口径。旧口径（相近候选也算）写入 `falseAlarms`，与历史文件同义；新口径写入 `falseAlarmsNew`，另附 `calibers` 说明，每条结果多记 `matchStatus`。
  - `eval:agent` 兼容旧结果文件（mismatch 且 summary 含“相近”）。
  - 历史结果文件没有改写。
  - 没有另抽新盲测集，不报新口径的效果；dev、test、blind、blind2 都已看过，不能拿来报新口径效果。
- 测试：
  - 新增 `verdict-meta.test.ts` 3 项和 `scripts/__tests__/real-results.test.ts` 6 项。后者有一项逐个核对 12 个历史结果文件，按旧口径重算的误报数与文件记录一致。
  - verify（相近候选两种情况、DOI 写错三种情况）、report、check-stream、Agent 资格、MCP 用例都已更新或补充。
  - `pnpm test` 36 个文件 509 项、typecheck、lint、build 通过。
- 浏览器验证（生产构建，`cite-checkup-prod-local`）：
  - 应用里的浏览器面板窗口被隐藏、截不了图，改用本机 Playwright 无头 Chromium（桌面 1440、手机 390）截图并逐张查看。
  - 输入为“载入示例”的 11 条，加第三批盲测集 B004、B046 两条（只用来展示界面，这批数据已看过）。
  - 结果：示例 11 条为已核实 5、信息有误 2、疑似不存在 2、撤稿 1、无法核验 1；两条加的为相近候选；健康度 60，相近候选不计入。
  - 筛选、下载报告、修正版清单都正常，无横向溢出、无页面错误。手机上“发现 N 条需要处理”原来会断成两行，已改成整段换行。
- 文档：
  - README：七类结论、判定原则、两种口径、MCP、测试数；
  - `DEFENSE_QA.md`：第 14、18 题，新增第 19 题；
  - `SUBMISSION_CHECKLIST.md`、参赛材料 README；
  - 讲稿：`narration.json` 第 03 段加一句相近候选，第 09 段测试数改为 509，第 10 段的“下一步”去掉已完成的单列；03 段 60 → 65 秒、10 段 40 → 35 秒，总长仍为 455 秒；`DEMO_SCRIPT.md` 时间表、演示输入（加 B004 作相近候选示例，当天先试）同步，脚本核对时间表首尾相接、与各段秒数一致。
- 技术 PDF：`technical-content.json` 第 4、11、13 页和材料日期改为 10-17 后重建，仍为 14 页；validate 通过（`eval/results/technical-pdf-2026-10-17/`）。逐页看了 14 张渲染图，没有裁切、乱码；行首标点 0 处。
- 待办：
  - 新口径的效果要另抽新盲测集，规则定稿后只运行一次并逐条复核；（10-17 已完成，见“第四批盲测：新口径检验”一节。）
  - 英文转写的中文期刊、未写编号的预印本改判为无法核验；
  - 请第二人独立标注、扩大样本。

## 2026-10-16 晚 修复新盲测集误报、第三批盲测

- 规则（b4dd66d，`src/lib/verify` 下 extract / match / verify 三个文件）按 `real-blind-2026-10-16-adjudication.json` 的五类误报修改，详见 README“2026-10-16 晚修复新盲测集的误报”：
  - 非期刊文献配到别的记录（B027 / B054 / B056）：覆盖范围外类型年份差两年以上时，要求题名几乎一致且第一作者对得上；年份差只提示版本或转载、不直接建议补 DOI（记录是期刊论文时年份仍要对上）。机构署名的报告 / 宣言不与个人作者的收录记录配对；机构署名的期刊论文只跳过作者比对。
  - 软件（B080 / B081）：R-Core-Team、R Foundation、CRAN 写法 “Package vegan.”；软件包总 DOI 的年份、作者差异只提示。
  - 题名边界（B011 / B074）：“, in:” 截断；“E. coli”、“D. Don” 不当句号。
  - 网页（B003，另含 B030）：去掉网址和访问日期后再找期刊特征；署名与发布者同名按网页。B030 在问号修复后从“出错”变成“疑似不存在”，是修复暴露的新误报，一并修了。
  - 第 5 类的判断：两条都改了规则。B015 能用第二个数据源判断（OpenAlex 记为 2014，卷期也是 2014 年），改为 Crossref 与 OpenAlex 年份不一致、引文与 OpenAlex 一致时只提示；B084 是记录缺中间名首字母，改为引文多一个首字母不算错（首字母对不上仍算错）。两条都只放过“数据库自身不一致或不完整”的情形，不放过引文与两个数据源都不一致的写法。
- 测试：新增 `real-world-blind-set.test.ts` 19 项；Agent 的报告候选测试拆成两种情况（第一作者也不同的旧版报告不再算同一篇）。`pnpm test` 34 个文件 491 项、typecheck、lint、build 通过。
- 回放：改规则前用 64b4832 的代码录下 blind-2026-10-16、dev、test、自建样例的全部数据库应答（缓存只在本机临时目录），改完回放：blind 只剩 B077（无法确认），其余 11 条不再误报；dev、test、自建样例结论不变。解析逐条对比 447 条中 10 条变化，都是改进。
- 正式回归（`eval/results/real-regression-2026-10-16-v2.json`，21:22–21:28）：dev 误报 0，3 处变化都是 429；test 只标出 T019 / T023 / T081，8 处变化都是 429；自建 29/29，与 10-16 逐条一致。本机直连 Crossref / OpenAlex 超时，评测都设 `NODE_USE_ENV_PROXY=1` 走代理（额度按代理出口计）。
- 第三批盲测集 `eval/real-world/blind-2026-10-16b.json`：定稿后用 `pnpm sample:real --seed=2` 抽样，111 条（英文 87、中文 24），62 篇源论文，与已有集合重叠 0；只看了每组条数。21:31 只运行一次（`real-blind-2026-10-16b-rules.json`）：已核实 37、信息有误 9、疑似不存在 4、无法核验 61、出错 0。
- 逐条复核（`real-blind-2026-10-16b-adjudication.json`）：误报 13 条（11.7%，95% 区间 7.0%–19.0%），全部英文；真实错误 0、无法确认 0。原因：作者段格式（单名作者、空逗号）2、会议报告粘连未识别 2、非期刊文献配错或被当成期刊 / 会议 4、OpenAlex 记录有问题 2、题名中间的问号 1、英文转写的中文期刊（ISTIC 注册 DOI）2。另有 2 条引文自身有小错但系统报的不是这些错，按口径仍计误报。
- 解读：三次盲测 10.1%、9.1%、11.7%，区间大幅重叠；逐类补规则在看过的集合上清零，在新数据上没有降低误报率。本轮没有为第三批数据改规则。
- OpenAlex 用量（代理出口）：dev 约 2、test 约 3、自建样例约 6、第三批盲测约 12 次题名检索，复核又用了约 4 次；剩约 0.07 美元。
- 待办：误报是长尾的，下一步考虑把“只找到相近候选”的条目（第三批 13 条里 6 条）与确认有误的分开呈现、英文转写的中文期刊和未写编号的预印本改判为无法核验，并请第二人独立标注、扩大样本；这些都还没做。第三批盲测集已经看过，再改规则要另抽新集。（相近候选单列已于 10-17 完成，见“相近候选单列”一节。）

## 2026-10-16 运行新盲测集与全量回归

- 额度：`.env.local` 的 `OPENALEX_API_KEY` 为空。08:11 只剩 0.009 美元（门槛 0.08），等 UTC 0 点（本机 17:00）重置到 0.10 后才跑。
  - 查额度可以用单条 DOI 查询：不计费，响应头同样有 `X-RateLimit-Remaining-USD`；`title.search` 每次 0.001 美元。
  - 实际题名检索次数：盲测约 8、dev 约 2、test 约 2、自建样例 6，远少于原先估计。
- 新盲测集只跑一次：HEAD 17f71ef，核验规则与 d237da2 相同，结果在 `eval/results/real-blind-2026-10-16-rules.json`。110 条：已核实 47、信息有误 9、疑似不存在 2、无法核验 50、出错 2；自动统计误报 11（10%）。
- 逐条复核（`eval/results/real-blind-2026-10-16-adjudication.json`）：
  - 误报 10 条（9.1%，95% 区间 5.0%–15.9%），全部是英文条目；无法确认 1 条（B077，计入后 10.0%）；真实错误 0。
  - 误报原因：非期刊文献配到别的记录 3 条（SSRN 转载、同作者的另一篇、书中章节）；软件未识别 2 条（vegan 版本、R）；题名边界切错 2 条（“, in:” 未截断、“D. Don”）；新闻网页当成期刊 1 条；数据库记录本身有差异 2 条（Crossref 把年份登记为 2020、配到首字母不全的 OpenAlex 机构库记录）。
  - 与 10-15 的 test 盲测（10.1%）同一水平：修过的类型在 test 上清零了，新数据上出现的是新类型的误报。
- 发现一个程序缺陷，按要求本轮不改规则，没有修：OpenAlex `title.search` 把题名中间的 “?” 当成通配符，返回 400（B030，复核时复现）。这条结论变成“出错”，界面却提示“暂时不可用”。修法是检索前去掉 “?” 和 “*”。
  - 10-16 晚已修：OpenAlex 题名检索前把 “?” “*” 换成空格（规则核验和 Agent 的 `search_openalex` 共用这一处），4xx（429 除外）出错时改为提示“查询被数据源拒绝”。盲测数字保持原样，没有重跑；只联网实测了一次 B030 题名（200，0 条候选，花 0.001 美元），效果等下一批新盲测集检验。
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
- 文档同步（10-16 晚补做）：`DEFENSE_QA.md` 第 14、18 题改为新盲测结果（64 篇、9.1%、与上次相当）和新的下一步；`SUBMISSION_CHECKLIST.md` 勾选盲测项、测试数改为 462；`narration.json` 第 03、09、10 段和 `DEMO_SCRIPT.md` 同步盲测结论与 462 项测试，讲稿字数基本不变；README 的测试数补到 462。
- 讲稿删减（10-16 晚）：`narration.json` 从 2059 字删到 1710 字，每章删 14%–20%；10 章结构、id、动作和演示顺序不变，边界说法和数字不变。各段按约 250 字/分钟加操作停顿重估，总时长由 7 分 15 秒改为 7 分 35 秒；`DEMO_SCRIPT.md` 时间表、`SUBMISSION_CHECKLIST.md` 和参赛材料 README 已同步。
- 问号修复后的文档同步（10-16 晚）：774969e 新增 9 项测试，`pnpm test` 为 33 个文件 471 项通过。README、`SUBMISSION_CHECKLIST.md`、`DEMO_SCRIPT.md`、`narration.json` 第 09 段和技术说明第 10 页的测试数改为 471；`DEFENSE_QA.md` 第 14 题和技术说明第 12 页的“下一步”去掉已修的问号缺陷；技术 PDF 重建并验收。
- 待办：上面列的几类新误报（题名问号检索出错已修）。修完要再抽一批新盲测集检验，不能拿这批数据当验证集。（10-16 晚已完成，见“修复新盲测集误报、第三批盲测”一节。）

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
- 技术说明PDF：`D:\Darks\projects\cite-checkup\docs\competition\output\pdf\引用体检-技术说明.pdf`（2026-10-17 版 14 页；逐页渲染与行首标点检查见 `eval/results/technical-pdf-2026-10-17/`；10-14 的 11 页版验收在 `eval/phase-two-2026-10-14/competition/`）
- 可编辑内容源：`D:\Darks\projects\cite-checkup\docs\competition\technical-content.json`、`technical-report.html`；构建脚本`build_technical_report.py`。
- 评分：`D:\Darks\projects\cite-checkup\docs\competition\REVIEW.md`，73/100模拟分，原版48/100，非官方成绩。
- 分镜/普通话稿/答辩：同目录`DEMO_SCRIPT.md`、`narration.json`、`DEFENSE_QA.md`、`SUBMISSION_CHECKLIST.md`。
- 视频源与实际响应：`D:\Darks\projects\cite-checkup\docs\competition\media`；root独占。`rehearsal`明确为回放彩排，不算真实调用证据。
- 正式视频：`D:\Darks\projects\cite-checkup\docs\competition\output\video\引用体检-完整演示-1080p.mp4`；6分39秒、1920×1080、25fps、H264/AAC、普通话合成讲解，是 10-14 的旧版，不含之后的新功能。规格与验收见同目录`video-verification.json`。新讲稿（10 章、约 1700 字、约 7 分 35 秒）见 `DEMO_SCRIPT.md`、`narration.json`，由用户本人录制。

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
- 代码在 GitHub 仓库 newhack-cpu/miniature-fiesta，10-17 已公开；仓库名若要改，改后同步 README 和提交表单。真实学校/团队信息待本人补充；没有代报名或正式提交。不得编造开发历史。
- 模拟评分73/100是本地工程评审，非赛事成绩或获奖预测。官方规则证据见`docs\competition\OFFICIAL_REQUIREMENTS.md`及`eval\phase-two-2026-10-14\competition`。

## 当前运行与下一步

- 2026-10-15：上面 PID29916 的生产预览已不在运行。本次用 `.claude/launch.json` 的 `next dev -p 3210` 做浏览器验证，`.next` 中是 10-15 准确率修复后的生产构建。后续先核对监听，不把 PID 记录视作当前事实。
- 录屏、续录、合成与验证作业均已结束；当前只有生产预览服务应保持运行。浏览器验收和录制会话均已关闭。
- 本轮已授权实现与材料工作无待办。正式提交的外部事项见上方缺项及SUBMISSION_CHECKLIST；后续若继续，先核对当前源码与服务，再按新的明确要求推进。
- 所有子代理均已结束。competition末次因模型容量退出，主代理已完成视频验收、外侧索引/清单和总状态更新；未改变用户模型或推理设置。
- 更新时间：2026-10-15（Asia/Shanghai）。
