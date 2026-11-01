# 云端数据表 v1 验收记录

日期：2026-11-01。仓库：`/Users/liyang/Documents/code/github/Synapse`，实施分支：`main`。初始开发验收只在本地执行，未对现有用户数据库迁移或压测；用户后续明确授权生产部署，结果见文末。未推送 Git 远端。

## 交付

- Console 云端数据表：自己的表／协作表、记录、字段、逐操作匿名与协作者权限、回收站、日志、API 示例、JSON／CSV 导出；密钥设置增加表资源范围。
- `/api/open/v1/tables` 与独立登录的 Console 接口共用业务服务。开放接口仅 API 密钥／匿名，Cookie 不升级身份；已有密钥默认不获得云表权限。
- PostgreSQL 元数据／JSONB 数据、版本冲突、事务批次、24 小时幂等、30 天恢复及有界清理，配套独立连接池和按表所属账号公平调度。
- 机器契约、[接口文档](../../../document/open-api/api/cloud-tables.md)、独立 HTTP Skill、模块边界与待发布说明同步。不增加桌面模块或 MCP，不增加第三方依赖。

## 自动验证

| 检查 | 执行方式 | 结果 |
| --- | --- | --- |
| 专项单测／机器契约 | `pnpm --filter @synapse/server exec vitest run src/cloud-tables src/api-keys src/open-api` | 18 文件、88 项通过 |
| 服务端全套单测 | `pnpm --filter @synapse/server exec vitest run --maxWorkers=1` | 196 文件通过、24 文件跳过；2306 项通过、137 项跳过 |
| 真实 PostgreSQL 16 集成和压力 | `pnpm --filter @synapse/server test:cloud-tables:e2e` | 19 项通过 |
| Console 单测全套 | `pnpm --filter @synapse/dashboard-v2 test` | 143 文件、1147 项通过 |
| Console 浏览器 | `pnpm --filter @synapse/dashboard-v2 test:browser src/features/cloud-tables/cloud-tables.browser.tsx` | 8 项通过，390／1280 宽度，含浮层展开、账号切换和幂等重试 |
| 服务端构建／生产类型 | `pnpm --filter @synapse/server build`；`pnpm --filter @synapse/server exec tsc -p tsconfig.build.json --noEmit` | 通过 |
| Console 构建／UI 边界／类型 | `pnpm --filter @synapse/dashboard-v2 build` | 通过，保留现有大 chunk 提示 |
| 服务端含测试的类型检查 | `pnpm --filter @synapse/server typecheck` | 未通过：既有未改动的 `notification.service.spec.ts:274` 报 TS2493（零参数 mock 的元组访问）；生产代码类型检查通过 |
| 文档站 | `pnpm --filter @synapse/document build` | 通过 |
| 独立 Skill | 系统 `skill-creator/scripts/quick_validate.py document/public/skills/synapse-cloud-tables` | 通过 |
| 反向代理配置 | `nginx:alpine` 容器中以只读配置、禁用网络执行 `nginx -t` | 通过 |
| 补丁空白 | `git diff --check` | 通过 |

PG 测试自动创建仅绑定 loopback 的临时容器／`cloud_tables_e2e` 数据库，校验数据库名和本机地址，运行仓库迁移；结束销毁容器。未继承真实存储／推送凭据。覆盖跨用户／跨表、本人记录、创建者伪造拒绝、Cookie／无效密钥、撤权后排队请求、结构与写入竞态、批次回滚、版本冲突、幂等与重放权限、回收恢复、数据库锁／执行取消、过期日志和凭据积压清理。

固定测试负载下，一账号持续突发时正常账号成功率 **100%**；正常账号基线 P95 **127.85 ms**、负载下 **144.60 ms**（1.13 倍）；既有核心接口 P95 **6.14 ms**。过载账号 64 次突发中 34 次成功、30 次受到繁忙保护。这是本机固定数据量的回归结果，不是生产容量或 SLA 承诺。

## 独立审阅与回归

独立只读审阅发现 5 项重要问题，均先复现再修复并通过回归：JSON 字符串编辑往返、归档必填字段恢复校验、长文本排序游标、字段元数据聚合内存、维护积压吞吐。补充同一请求在网络结果不明确时复用幂等键的浏览器回归。无未处理的审阅阻断项。

## 运行边界与回滚

- 本期保留可信团队使用分享内容的前提。分享 HTML 与 Console 的通用同源隔离仍未解决；分享网页不能按访问者身份访问私有表。
- 仅支持单服务实例。多副本前须增加全局资源协调，不能按副本复制预算。
- 每表 100 字段包括尚在 30 天保留期的归档定义。定义总量 1 MiB、单字段 64 KiB、活动默认值合计 64 KiB；JSON 请求最多 32 层／50000 节点。Console 单次导出保护为 16 MiB，大数据使用 API 分页。这些是单操作边界，不是账号容量配额。
- 迁移：`server/prisma/migrations/20261101090000_cloud_tables/migration.sql`；初始验收在临时测试库验证，后续生产执行状态见下文。
- 回滚应用时可保留新增云表及密钥资源列，避免删除用户数据；旧密钥 scope 不扩权。若需移除数据库结构，应先停用入口、备份数据并另行安排受控迁移。本次未执行生产数据库回滚。

## 生产部署与线上验收（2026-11-01）

用户明确要求部署后端、Dashboard V2 和文档站供实际试用。使用现有 `deploy.sh`，指定 `DASHBOARD_UI=v2`，未发布桌面／iOS 版本，未群发通知。服务器为 `120.53.17.64`，部署目录 `/www/wwwroot/synapse`，公开地址 `https://synapse.d2.pub`。

- 首轮源码为 `main` 的 `3c37b6be1`，包含云表功能提交 `50a0d44ed` 和 API 文档提交 `3c48f97d6`；云表后端、迁移、V2 页面及文档等 8 个关键文件与上传源码校验和一致。
- 首轮 `deploy-20261101_165412` 构建、迁移预演、最终备份恢复验证和切换成功。生产 `synapse` 库的 `_prisma_migrations` 记录 `20261101090000_cloud_tables` 已完成且未回滚；五张 `CloudTable*` 表已存在。
- 迁移风险扫描标记新增非空列与三个唯一索引。逐项确认：既有密钥列带固定默认值，唯一索引仅针对新空表，无数据删除，首轮显式允许该迁移继续；第二轮没有待执行迁移。
- 首轮额外线上验收发现独立 Skill 原始文件下载 404。根因为文档站 `vite.publicDir` 复用 Dashboard 公共资源目录，新增文档资源没有自动分发。修复提交 `d3d152c4f` 显式复制原始 Skill、排除页面编译，并将两个 Markdown 及共享图标产物校验加入每次文档构建；本地及服务器两项产物测试均通过。
- 最终版本为 `synapse-server:deploy-20261101_170828`，镜像 ID `sha256:316d5c005f7f1cd8d628f67fe0bc9a9dbec3d8d5a4eb354e40998d47604c6da9`。2026-11-01 17:19（Asia/Shanghai）验收完成。Server、PDF renderer、PostgreSQL 均为 healthy；运行 Node 为 `22.23.4`，构建标记为 `{"ui":"v2"}`。运行镜像不包含 `server/test` 研究源码。
- 两轮均执行在线备份恢复与迁移预演、停服后的最终备份及实际恢复验证，临时恢复库已清理。未在生产中创建测试表／记录、使用真实用户密钥进行写入或执行压力测试。

最终公开 HTTP 冒烟 **11 项通过**：健康、Console 云表深链、V2 标记、完整 API 文档、19 项 OpenAPI 云表操作、原始 Skill 和 HTTP 参考、匿名目录拒绝、Cookie 不能替代密钥、无效密钥在查表前拒绝、无凭据 CORS。成功页面／文件为 200，拒绝用例为 401，预检为 204。部署脚本另验证管理员页面、PDF 请求及桌面更新凭据接口。启动初期的 000／502 随就绪重试恢复，最终通过；未用启动中的探测失败代替最终结果。

入口：

- [云端数据表 Console](https://synapse.d2.pub/console/tables)
- [API 文档](https://synapse.d2.pub/document/open-api/api/cloud-tables)
- [OpenAPI](https://synapse.d2.pub/api/open/openapi.json)
- [原始 Skill](https://synapse.d2.pub/document/skills/synapse-cloud-tables/SKILL.md)
- [HTTP 参考](https://synapse.d2.pub/document/skills/synapse-cloud-tables/references/http.md)

回滚与备份定位（均在服务器，未下载凭据内容）：

- 最新回滚镜像：`synapse-server:rollback-20261101_170828`、`synapse-pdf-renderer:rollback-20261101_170828`，回到首轮已支持云表、尚未修复 Skill 下载的版本。
- 最新最终备份：`/www/wwwroot/synapse/backups/synapse-final-before-switch-20261101_170828.sql`；对应 globals、env、PDF 状态在 `backups/globals/synapse-globals-before-deploy-20261101_170828.sql`、`backups/env/synapse-env-before-sync-20261101_170828.env`、`backups/pdf-renderer-rollback-20261101_170828.state`。
- 云表迁移前最终备份：`/www/wwwroot/synapse/backups/synapse-final-before-switch-20261101_165412.sql`，原应用镜像为 `synapse-server:rollback-20261101_165412`。恢复数据库会影响部署后的新数据，不能作为普通应用回滚步骤自动执行。
- 本机部署日志和冒烟结果：`.superpowers/cloud-tables/deploy-production.log`、`deploy-production-skill-fix.log`、`deploy-smoke.json`、`deploy-runtime-final.log`。这些是仓库根目录下的忽略文件，本记录保留了关键结果和持久恢复点。
