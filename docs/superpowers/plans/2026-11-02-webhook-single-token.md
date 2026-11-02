# Webhook 单段令牌实施记录

## 已确认目标

用户已确认外部只保留随机令牌，内部 ID 不变；重置仅换令牌；部署时允许清空所有用户的旧 Webhook 与调用历史。本次只实现并验证代码，不部署、不执行真实数据库清理。

## 实现与验证

- [x] `shared/src/urls.ts`、`server/src/webhooks/`：单段地址、按唯一令牌哈希查找、创建与重置保持内部 ID 和自动化 `publicId` 稳定。
- [x] 单元与 HTTP 回归：新地址可用、旧双段地址 404、重置使旧令牌失效且保留配置/历史、停用与删除返回通用 404、正文限制仍为 256 KiB。
- [x] 日志、历史、Live 下行遮蔽整个令牌段；Nginx 关闭该入口 access log；部署与重启探针使用单段路径。
- [x] 一次性 Prisma migration 先清回执，再清历史与 Webhook（含软删除），再建 `secretHash` 唯一索引；隔离 SQL 夹具覆盖外键顺序、账号保留与唯一性。
- [x] 同步模块边界、控制台指南与待发布说明；核对 MCP/系统 Skill 继续使用稳定 `publicId`，不新增注册能力。

## 部署及回滚

迁移：`server/prisma/migrations/20261102120000_webhook_single_token/migration.sql`。沿用部署脚本的备份、预演和风险扫描；审查后按既有 `ALLOW_RISKY_MIGRATIONS=1` 机制放行。Prisma 只执行一次，后续正常部署不会重复清理。历史方案中的双段路径、hash-only 旧数据保留规则由本次用户决策和 `docs/agents/module-boundaries.md` 的云端 Webhook 规则替代。

本次不连接真实数据库。隔离 SQL 夹具使用 SQLite 执行 PostgreSQL/SQLite 共通语句，不能替代部署时 PostgreSQL 备份恢复和迁移预演。清理后数据恢复依赖部署前备份；仅回退代码不能恢复旧数据。

## 验证结果

- Webhook 专项：7 个文件、81 项通过；共享 URL：6 项通过；Dashboard Webhook/历史：22 项通过。
- 服务端 API 构建、Dashboard 构建/类型检查/UI 边界、Prisma schema 静态校验通过。未启动应用或浏览器，未做视觉验收。
- 全量服务端：2393 项通过、156 项跳过、2 项失败：`src/deploy-config.spec.ts` 的旧 Skill 导入 Nginx 配置断言，以及 `src/dev-scripts.spec.ts` 的 healthz/readyz 启动等待断言。
- 全量 shared：330 项通过，`src/package-entrypoint.test.ts` 的通知来源导出预期与当前产物不一致，1 项失败。
- 服务端完整 typecheck 被另一项未提交文件 `server/src/cloud-skills-retirement.spec.ts:3` 的 CommonJS/import.meta 错误阻断；未修改该文件。
- 完整验证日志位于 `/tmp/synapse-webhook-server-test.log`、`/tmp/synapse-webhook-shared-test.log`、`/tmp/synapse-webhook-server-typecheck.log`、`/tmp/synapse-webhook-server-build.log`、`/tmp/synapse-webhook-dashboard-typecheck.log`、`/tmp/synapse-webhook-dashboard-build.log`，无在线文档链接。数据库迁移尚未对任何真实环境执行。
