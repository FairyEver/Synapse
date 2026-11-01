# Dashboard V2 正式默认与旧链接兼容实施计划

**目标：** 普通部署默认构建 V2，沿用线上域名和所有独立阅读、分享地址；旧控制台文件及文件夹详情转到 V2 独立阅读器。完成验证后部署服务器。

**依据：** 本次用户明确授权；`docs/agent-guides/server-dashboard.md`、`dashboard-v2/MIGRATION.md`。用户已明确将旧文件夹地址从原 404 边界调整为独立阅读跳转，云盘管理列表仍保持退役。

## 约束

- 在当前仓库的 main 分支开发，不新建分支或 worktree，不新增依赖。
- 保持用户/管理员会话隔离，保留分享密码、讨论 query/hash 和服务端下载、render、零脚本 reader。
- 未设置或置空 DASHBOARD_UI 选择 V2；显式 v1 保留完整重建回滚能力；无效值仍在任何远程操作前拒绝。
- 普通服务端部署不扩展为桌面/iOS 整版发布、版本 bump、CI/Release 调度或群发通知。
- 只提交本次文件，部署前确认共享工作区没有被混入其他未完成修改。

## 1. 默认构建与部署身份

- [x] 先更新 `scripts/deploy/dashboard-ui.test.mjs`，验证默认/空值选择 V2、显式 v1 回滚和命令行字段；观察失败。
- [x] 更新选择器、`deploy.sh`、`server/Dockerfile`、`server/compose.yml` 和配置示例，统一默认值。
- [x] 容器静态产物生成 dashboard-ui.json，以便上线核实实际构建版本，不以通用健康页面代替版本证据。
- [x] 运行选择器行为测试、部署配置测试及 shell 语法检查。

## 2. 旧文件和文件夹地址

- [x] 先补 console/dashboard 两个旧前缀、items/folders 两类详情、编码 ID、query/hash 的失败回归。
- [x] 在统一 Web 入口策略兼容旧详情，保留全盘列表 404 和独立分享/通知地址。
- [x] 验证 Vite 开发/预览和生产 bootstrap 都消费同一入口策略；同步迁移清单的长期边界。

## 3. 集成与上线

- [x] 同步当前规则、部署指南和待发布说明，保留历史验收记录的时间语义。
- [x] 运行 V2 全量测试、V1 回滚构建、V2 构建、服务端部署配置测试和独立代码审阅。
- [x] 本地提交本次改动；执行 `bash deploy.sh`，跟踪本轮镜像 tag、备份、迁移预检与健康结果。
- [x] 核实线上 dashboard-ui.json 为 v2、console/admin 页面及独立分享/文件/通知入口使用当前 V2 资源。
- [x] 验证旧文件/文件夹链接跳转到独立地址并保留讨论参数；不写入生产测试业务数据。

## 部署前验证记录

- 默认选择器 7 项、服务端部署配置 44 项通过；bash 语法检查通过。
- V2 最终全量测试 135 文件、1090 项通过；V2 构建与 V1 回滚构建通过。
- 旧入口及认证链专项 8 文件、87 项通过，已复核登录后旧文件夹返回目标。
- 生产迁移预查无待应用 migration；正式结果以 deploy.sh 本轮检查为准。
- 日志位于本机 `/tmp/synapse-v2-cutover-final-tests.log`、`/tmp/synapse-v2-cutover-final-build.log` 与 `/tmp/synapse-v1-rollback-build.log`，尚无在线链接。

## 首次上线与缓存补修

- 首次部署 `deploy-20261101_110516` 成功，服务与渲染器健康，线上标识为 V2；未执行业务 schema 迁移。
- 浏览器验收复现普通导航命中旧 V1 HTML，新 query 命中 V2；补充入口 HTML/JSON 缓存重新校验，其他静态资源不改。配置回归先 2 项失败，修复后 45 项通过。
- 缓存补修已通过第二轮部署；已缓存的旧 HTML 无法由服务器追溯修改，旧页需刷新一次。
- 首次部署日志 `/tmp/synapse-v2-cutover-deploy.log`、浏览器证据 `/tmp/synapse-v2-cutover-stale-html-evidence.json`，均为本机文件，尚无在线链接。

## 最终线上验收

- 代码提交：`0248f18ec`（默认 V2 与旧链接兼容）、`cfba0a8ad`（入口缓存重新校验）；在本机仓库 main 修改、提交，未 push。
- 第二轮 `bash deploy.sh` 成功（528 秒），生产服务与 PDF 渲染器镜像为 `deploy-20261101_111828`，均 healthy；数据库也 healthy，无待应用迁移。
- 线上 `/console/dashboard-ui.json` 返回 `{"ui":"v2"}`。console、admin、文件、分享、通知入口均使用当前 V2 资源，HTML/JSON 返回 `Cache-Control: no-cache, must-revalidate`；JS 资源可加载且没有新增禁用缓存头。
- 浏览器普通刷新后确认 `/console/settings` 为 V2；旧 `/dashboard/drive/items/:id` 保留 hash 和版本参数并加载实际 Markdown、历史版本弹窗。旧 `/console/drive/folders/:id` 保留 query/hash 并列出实际目录 6 个子项；已有文件分享可阅读实际内容。
- 浏览器登录页中旧文件夹返回目标已变为 `/drive/items/:id?surface=standalone`，创建账号链接继续携带 query/hash。未提交认证表单，未验证管理员密钥登录或真实通知投递；管理员登录页面与通知 SPA 资源入口已核对。未写入生产测试业务数据。
- 配置专项最终 45 项通过，新生产镜像内 `nginx -t` 通过。V2 功能代码在最终 1090 项全量通过后未再变动。
- 构建存在已有 pnpm 二次依赖校验缺少 `node-pty` patch 的提示；冻结依赖安装与最终构建成功，本任务未改该既有构建流程问题。浏览器记录中的异常来自扩展 IO 错误和未登录管理员会话的预期 401，未发现本次已验收页面加载失败。
- 最终部署日志：本机 `/tmp/synapse-v2-cutover-cache-deploy.log`；浏览器证据：本机 `/tmp/synapse-v2-cutover-final-browser-evidence.json`，尚无在线文档链接。
- 最终切换前数据库备份：服务器 `/www/wwwroot/synapse/backups/synapse-final-before-switch-20261101_111828.sql`；首次切换前（V1）备份：`/www/wwwroot/synapse/backups/synapse-final-before-switch-20261101_110516.sql`。Drive 使用 COS，部署脚本未执行本地 Drive 打包。
- 最近一轮回滚镜像 `synapse-server:rollback-20261101_111828` 为首次上线的 V2；切换前 V1 镜像仍为 `synapse-server:rollback-20261101_110516`。主动回 V1 可按下方显式选择重建，不恢复业务数据库。

## 回滚

保留 V1 源码与构建选择。部署失败沿用 deploy.sh 的旧镜像恢复流程；需要主动回切时使用 `DASHBOARD_UI=v1 bash deploy.sh`。不恢复数据库或删除云盘对象来回滚前端。
