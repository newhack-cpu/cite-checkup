# 魔搭创空间容器部署

已部署为国内老师试用入口，原 Netlify 网址保留。最新运行状态与验证证据见项目根目录 `PROJECT_STATE.md`。

## 访问入口

- 老师试用：[引用体检 · 魔搭](https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full)。已用全新、未登录的浏览器实际完成核查和报告下载，不需要安装软件或本机持续开机。
- 管理页面：[创空间详情](https://modelscope.cn/studios/kgkvybu111111/cite-checkup)。应用域名是 `kgkvybu111111-cite-checkup.ms.show`，平台通过正常页面和 iframe 建立访客访问；直接用 curl 请求该域名会遇到平台鉴权提示，不要给老师部署令牌。
- 备用：[Netlify 入口](https://cite-checkup-ql514740.netlify.app)。两处独立部署，GitHub 推送不会自动同时更新。
- 本次使用账号实际返回的免费 2 核 / 8 GB Docker 资源，没有启用付费硬件。DeepSeek 请求仍消耗原项目的模型额度。

## 本次验证与限制

2026-10-18（America/Los_Angeles）已完成 Linux 镜像构建与启动，标准示例 11/11、流式进度、报告下载、PDF/中文 PDF/DOCX 小文件导入、真实 AI 解析、4 个论断案例、中文检索及图片转写均通过。桌面 1440px 与移动设备模式 360px 已查看，应用没有横向溢出。

应用声明上传上限为 8 MiB，但本次两个接近该上限的请求都在 60 秒内未取得响应，被验收端取消；无法据此确定是上传链路还是平台网关限制。**老师试用先用小文件，较大论文可复制参考文献文本**。小文档成功不等于整个 8 MiB 范围已验证。平台外层页面有匿名登录查询 401、iframe 权限提示及移动端脚本告警，应用各功能请求成功；不声称控制台完全无错误。

免费平台的实际休眠、长请求及不同运营商可达性仍需真实使用观察，老师试用记录由用户收集。完整证据保存在 `output/modelscope-2026-10-18/`。

## 运行方式

- 使用魔搭 **Docker 创空间**，由云端从源码构建，不要求本机安装 Docker Desktop。
- `Dockerfile` 固定 Node 22.22.3 / pnpm 11.22.0，采用 Debian bookworm-slim 与锁文件安装；PDF.js 的原生依赖随 Linux 构建安装。
- Docker 构建设置 `DEPLOY_OUTPUT=standalone`，生成 Next.js 独立运行产物；其他部署方式不设置该变量，保持原来的输出形式。
- 应用以非 root 用户运行，监听 `0.0.0.0:7860`。同时复制 `public` 和 `.next/static`，并保留 PDF worker、CMap、字体和原生依赖。
- `.dockerignore` 只允许应用源码及必要构建配置进入上下文，排除 `.env`、Git 历史、测试夹具、输出目录和视频。密钥只在云端 Secrets 中配置，不能放进 Dockerfile、镜像或 Git。
- 本镜像没有设置 `NEXT_PUBLIC_DEPLOY_TARGET=netlify`，使用普通 Node 部署的 8 MiB 应用上限；魔搭网关实际上传及超时边界尚未验证通过，不能套用 Netlify 的 4 MiB / 50 秒结论。

## 账号与云端步骤

1. 登录魔搭，完成 Docker 创空间要求的阿里云账号绑定及实名认证。
2. 在 [访问令牌页面](https://modelscope.cn/my/myaccesstoken) 获取令牌。当前协作使用本机已忽略目录 `output/modelscope-2026-10-18/auth.env` 的 `MODELSCOPE_API_KEY`，不发到聊天或提交到仓库。
3. 查询账号实际可用 Docker 资源，只使用免费资源；不能根据文档示例硬编码资源规格或自动转为付费资源。
4. 创建或复用 `cite-checkup` Docker 创空间，核对同名项目归属。将经过筛选的应用代码推送到它的 Git 仓库，再触发云端构建。保留既有 Netlify 项目。
5. 通过 Secrets 配置本项目有效的 `DEEPSEEK_API_KEY`；已有 `OPENALEX_API_KEY` 时同样放入 Secrets。普通变量可设置 `DEEPSEEK_MODEL=deepseek-flash`、`DEEPSEEK_BASE_URL=https://api.deepseek.com`、`OPENALEX_SEARCH_BUDGET=20`，联系邮箱使用项目实际配置。不要上传本机代理地址或魔搭部署令牌到应用运行环境。
6. 等实际构建和运行成功后取得公开访问地址；平台 Studio 页面、嵌入的应用地址与需要鉴权的 API 地址不能混为一谈，老师入口必须验证无需部署令牌也能使用。

## 验收

- 检查首页、字体/静态资源、390px 手机布局、四个 AI 状态 GET，以及匿名访问。
- 使用 PDF、中文 PDF、DOCX 小夹具检查实际正文和参考文献；确认 PDF worker 与 canvas 原生模块来自最终运行产物。资源膨胀探针仅在本地隔离服务执行。
- 实测 Crossref、OpenAlex 的出站请求、标准核验、中文检索、AI 解析、正文论断、图片转写及报告下载。页面能打开不能替代这些验证。
- 检查网关是否缓冲流式响应、上传边界、取消与超时提示；免费资源的休眠/配额以账号当前状态为准。
- 不把开发机或代理网络的可达性称为大陆各运营商可达；老师真实网络试用另外记录。

如以后需要本机 Docker 验证，可运行：

```sh
docker build -t cite-checkup:local .
docker run --rm --name cite-checkup-local -p 127.0.0.1:7860:7860 --env-file .env.local cite-checkup:local
```

上述 `.env.local` 必须是本项目的运行时配置，不包含部署令牌或本机代理；此命令只提供本机访问，不会自动创建公网网址。

## 官方依据

- [魔搭 Docker 创空间](https://modelscope.cn/docs/studios/docker)
- [魔搭官方部署接口与前置条件](https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/SKILL.md)
- [Next.js standalone 输出](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

准备文件、实际构建、最终云端验收分别记录，不将三者混写。
