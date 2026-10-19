# Netlify 免费试用部署

本项目包含 Next.js 服务端 API、流式核验和 PDF worker，必须使用 Netlify 的 Next.js / OpenNext 适配器，不能把静态目录拖到 Netlify Drop 当作完整应用。

## 从 GitHub 部署

1. 在 Netlify 登录后选择 **Add new project → Import an existing project → GitHub**。
2. 授权仓库 `newhack-cpu/miniature-fiesta`，选择 `main` 分支；有现成项目时继续该项目，避免重复创建。
3. 使用 **Free** 计划；构建命令 `pnpm build`，发布目录 `.next`，仓库根目录为基础目录。`netlify.toml` 会提供这些设置。
4. 在项目环境变量中添加下表配置，作用域须包含 **Functions**（Free 若没有作用域选择，使用默认全部作用域）。秘密值只能放 Netlify 环境变量，不得写入代码或 `netlify.toml`。
5. 部署完成后按下方清单验收。首页成功不等于 AI、导入或流式接口已经通过。

| 环境变量 | 值或用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 本项目 `.env.local` 中的有效密钥；AI 解析、检索与论断必需 |
| `DEEPSEEK_MODEL` | `deepseek-flash`，或本项目已验证的配置 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `OPENALEX_API_KEY` | 本项目已有的 OpenAlex 密钥 |
| `OPENALEX_SEARCH_BUDGET` | `20` |
| `CROSSREF_MAILTO` | 本项目用于 Crossref 礼貌池的联系邮箱 |
| `AWS_LAMBDA_JS_RUNTIME` | 可在面板明确设为 `nodejs22.x`；不能写进 `netlify.toml` |

不要上传 `.env.local` 文件本身，不要复制 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 等指向本机的代理变量。未配置 DeepSeek 时标准规则仍可用，AI 功能按界面提示降级。

## 构建与平台适配

- `netlify.toml` 固定 Node 22.22.3；pnpm 11.22.0 取自 `package.json` 的 `packageManager`。安装使用锁文件并按 Netlify 的 Next.js / pnpm 指引展开依赖。
- `netlify.toml` 显式启用 `@netlify/plugin-nextjs`，不锁定旧版本，由平台下载当前 OpenNext 适配器。源码 ZIP 云构建实测不会自动附加该适配器；漏掉声明会只发布 `.next` 文件、生成 0 个函数，导致首页/API 404，即使构建状态显示成功。
- 构建变量 `NEXT_PUBLIC_DEPLOY_TARGET=netlify` 使浏览器与服务端共同采用 **4 MiB** 文件/图片合计上限、**50 秒**请求处理预算，给平台 60 秒截止时间留余量。该变量是公开能力标记，不包含秘密；修改后需要重新构建。
- 非 Netlify 构建仍保留原本 8 MiB 上限及各流程的时间预算。
- Netlify 的同步与流式函数均有 60 秒上限，二进制请求经 Base64 编码后实际约 4.5 MB。路由中的 `maxDuration` 不能提高平台上限。大批核验可能只完成一部分，界面应提示未完成；建议老师先试少量条目。
- PDF worker 使用临时目录与平台原生依赖；保留项目现有文件追踪设置，必须在 Linux 云环境实际验收。
- 额度仍是进程内限额，不是分布式配额或账户系统。小范围老师试用不代表可承受不限量公开调用。

## 免费范围

截至 2026-10-18，新的 Free 计划为 0 美元/月、300 credits/月，硬上限且不自动充值；旧账号以其面板显示的计划为准。构建、访问和函数消耗额度，托管免费不代表 DeepSeek API 免费。本次不启用收费资源、升级或自动充值。

## 云端验收

- 记录真实项目 URL、Git 提交和部署结果；检查首页、静态资源、手机排版。
- 检查 `/api/check`、`/api/agent`、`/api/claims`、`/api/vision` 的 GET 状态，不输出秘密。
- 设置 `SMOKE_BASE_URL=https://实际项目.netlify.app`，执行 `pnpm smoke:ai` 与 `pnpm smoke:claims`；真实模型调用使用原有 API 额度。
- 用 `src/lib/documents/__tests__/fixtures/paper.pdf`、`paper.docx` 和 `chinese.pdf` 测试 `/api/import`，核实实际正文与参考文献。
- 浏览器实际执行标准核验、AI 检索、导入确认及报告导出；验证流式进度、取消与超时提示。云端不要运行限定 localhost 的高负载安全探针。

## 官方依据

- [Next.js 适配器与功能](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [Node / pnpm 构建依赖](https://docs.netlify.com/build/configure-builds/manage-dependencies/)
- [函数限制和 Node 运行时](https://docs.netlify.com/build/functions/configuration/)
- [Free 计划与额度](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)

实际部署结果与云端验收记录以项目根目录 `PROJECT_STATE.md` 的最新条目为准。
