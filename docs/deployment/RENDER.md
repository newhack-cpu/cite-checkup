# 老师试用：Render 免费云部署

使用仓库根目录的 `render.yaml` 部署完整 Next.js Node 服务，支持动态接口、流式核验及 Node PDF worker。不能选择 Static Site。无需数据库、磁盘或购买域名。

## 首次部署

1. 注册 / 登录 [Render](https://dashboard.render.com/)，连接 GitHub 仓库 `newhack-cpu/miniature-fiesta`。
2. 打开 [本仓库的 Blueprint 部署入口](https://dashboard.render.com/blueprint/new?repo=https://github.com/newhack-cpu/miniature-fiesta)。配置已经指定 Free、Singapore、main、Node 22.22.3、pnpm 11.22.0。
3. 按提示填写服务端环境变量：

   | 名称 | 用途 |
   | --- | --- |
   | `DEEPSEEK_API_KEY` | AI 解析、论断核查、图片识别和 AI 继续查；复用本机 `.env.local` 中的有效值。 |
   | `OPENALEX_API_KEY` | OpenAlex 检索与撤稿核对；有值时复用本机配置，无值可留空，访问能力以平台政策为准。 |
   | `CROSSREF_MAILTO` | Crossref 联系邮箱；使用真实联系邮箱，无值可留空。 |

   只在 Render 的环境变量栏填写秘密，不要写入 YAML、Git、聊天或客户端变量。不要复制本机的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或 localhost 代理配置。

4. 确认只有一个 Free Web Service，点击 Deploy / Apply。部署成功后使用面板实际返回的 `https://…onrender.com` 地址；服务名称不保证等于最终域名。
5. 如已通过 Render 插件创建服务，继续已有服务，不要再重复应用 Blueprint。

## 上线验收

完成远端构建与健康检查后，实际验证：

- 首页和静态资源正常加载；手机布局可用。
- 标准参考文献核验有逐条结果，错误和未完成状态正常。
- AI 状态显示可用，真实执行一次 AI 解析和一次论断核查。
- 上传一个小 PDF / DOCX，确认不是只部署了静态网页或缺少 PDF 依赖。
- 中文 AI 继续查能返回检索过程；来源失败时保留已有候选。

本地已有生产验证不等于云端验收。云端尚未完成前不得把部署配置称为已上线网站。MCP stdio 服务仍由本地客户端启动，不属于这个公网网页服务。

## 免费实例的使用边界

- Render 免费服务闲置 15 分钟会休眠，下次访问通常约一分钟唤醒。老师试用前先打开一次。
- 免费实例提供有限 CPU 和 512 MB 内存，面向少量试用；长 PDF、多并发与联网请求可能超时，应以实际云端验证为准。
- 免费的是托管额度；DeepSeek 和数据源仍按已有账户计费及配额执行。服务目前没有登录系统，拥有网址的人都能使用；不要当作公开大规模服务推广。
- 保留现有单进程限额，不使用多实例。限额重启会清空，不能当作严格账户费用上限；公网代理 IP 行为仍需实际核对。
- 文件系统是临时的，上传材料不作为永久存档；下载报告由使用者自行保存。
- 自动部署已关闭，避免日常材料提交打断老师试用。更新时在服务面板手动部署最新提交。

官方资料：[Next.js 部署](https://render.com/docs/deploy-nextjs-app)、[免费实例限制](https://render.com/docs/free)、[Blueprint 参考](https://render.com/docs/blueprint-spec)。
