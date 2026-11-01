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
- [ ] 本地提交本次改动；执行 `bash deploy.sh`，跟踪本轮镜像 tag、备份、迁移预检与健康结果。
- [ ] 核实线上 dashboard-ui.json 为 v2、console/admin 页面及独立分享/文件/通知入口使用当前 V2 资源。
- [ ] 验证旧文件/文件夹链接跳转到独立地址并保留讨论参数；不写入生产测试业务数据。

## 部署前验证记录

- 默认选择器 7 项、服务端部署配置 44 项通过；bash 语法检查通过。
- V2 最终全量测试 135 文件、1090 项通过；V2 构建与 V1 回滚构建通过。
- 旧入口及认证链专项 8 文件、87 项通过，已复核登录后旧文件夹返回目标。
- 生产迁移预查无待应用 migration；正式结果以 deploy.sh 本轮检查为准。
- 日志位于本机 `/tmp/synapse-v2-cutover-final-tests.log`、`/tmp/synapse-v2-cutover-final-build.log` 与 `/tmp/synapse-v1-rollback-build.log`，尚无在线链接。

## 回滚

保留 V1 源码与构建选择。部署失败沿用 deploy.sh 的旧镜像恢复流程；需要主动回切时使用 `DASHBOARD_UI=v1 bash deploy.sh`。不恢复数据库或删除云盘对象来回滚前端。
