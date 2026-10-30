# 游戏大厅第八轮审核与修复

日期 2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，起点 `ca8ff4866`。完整功能基准仍为 `20fcd49c9...HEAD`。本轮核对记录/归档读取、跨次入座、请求取消、普通导航和异常恢复，依据三份定稿文件与已确认口径。

## Standards

普通导航、分页、迟到响应隔离和错误恢复复核未发现新增确定缺陷。未将已允许的 offset 漂移或未经像素验证的布局疑点算作修复，不做无关重构。

最终独立复核确认：大厅仅存取 opaque 游标，没有按扑克分支解释；overview、account recent 白名单不投影它。SQL 参数化，热表/归档均保留本人参与校验。MCP/IPC 的 schema、权限与账号+roomCode 重连方式不变，无新凭证。该轴 0 项。

## Spec 与边界

产品 §7 的循环要求 hand_result 记录“本手结果”；实施计划阶段 3 要求自动行动提示只返回一次，既有恢复协议要求结果属于本次入座。发现两项 P2：

1. **重新入座误收上次超时。** 新 join 请求在 599 秒已捕获 now，但在旧座位 600 秒超时后才取得连接/房间锁，重建会话却记录 599 秒。该新座位后来正常退出/关桌时，旧 timeout.createdAt=600 秒仍被时间条件认为属于本次入座。热记录和归档均复现。
2. **合法新手结算漏发。** 新座位在 100 秒入座，另一个 99 秒已捕获的合法行动稍后提交并开启下一手。新座位真实参与该手，但 hand.startedAt=99 秒早于 session.startedAt=100 秒；退出后 wait 错误跳过本人结算，直接 table_closed。热记录和归档均复现。

不是只给 auto 查询增加 hand.startedAt 时间条件：那会漏掉同样时序下本次真正的超时。修为入座事务在房间锁内记录下一手手号，普通结果与自动事件统一按手号下界。复用一个可空 `GameSession.startCursor` 存游戏定义起点，大厅仅保存/替换且不公开；扑克解释它，没有新表或通用 epoch 框架，没有改变行动时钟、600 秒规则或引擎纯函数边界。

旧在座会话迁移回填 seat.joinedHandNo；缺少持久起点但仍有座位时可用该座位边界。真正未知的旧关闭会话保留原时间兼容，不能猜测或重写其历史。客户端不传新参数，重连依然只需当前账号+roomCode。该轴 2 项，均为 P2。

## 回归与迁移证据

- 使用注入时钟模拟连接/锁等待造成的请求提交乱序，实际运行服务与 Postgres，无服务替身。初始 auto 2 红 2 绿：`/tmp/game-review8-auto-epoch-red.log`；补普通结算后业务 4 红 2 绿：`/tmp/game-review8-session-boundary-business-red.log`；修复及旧数据兼容共 10/10 绿：`/tmp/game-review8-session-boundary-green-final.log`。旧数据 4 例显式确认座位已删除、session.closed 且 startCursor=null，确实覆盖时间兼容路径。
- Hall 通用存储回归先 1 红 3 绿，再 4/4 绿，验证其他游戏 opaque 字符串、重新入座替换/清空、余额不变且不公开字段。日志 `/tmp/game-review8-hall-red.log`、`/tmp/game-review8-hall-green.log`。
- 本轮新增 12 项（入座边界 10、Hall 1、迁移 1）。schema 切换期间的 `/tmp/game-review8-session-boundary-red.log` 是临时旧 Prisma Client 的 Unknown argument，不能当作业务 RED 证据。
- 新增第五份游戏迁移 `server/prisma/migrations/20261030120000_game_session_start_cursor/migration.sql`，只增加可空字段并回填当前扑克座位起点。既有 95 份先应用到新测试库，再应用该迁移，合计 96 份；日志 `/tmp/game-review8-migrations.log`、`/tmp/game-review8-cursor-migration.log`。Prisma Client 已重新生成，日志 `/tmp/game-review8-prisma-generate.log`。
- 回填测试在已迁移专用库构造旧形态活动座位，将新字段置 null，执行新迁移的原始 UPDATE 段；验证中途入座下界为 2、未知 joinedHandNo 仍 null、其他游戏 opaque 值不变、点数不变且不对外投影。列创建由空库 migrate deploy 验证，不把单独 UPDATE 测试冒称完整生产升级演练。日志 `/tmp/game-review8-backfill-test-final.log`。

## 最终检查与交付

- 服务端游戏专项：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review8_e2e pnpm --filter @synapse/server test src/game --maxWorkers=1`，24 文件、137 项通过，无跳过，日志 `/tmp/game-review8-game-server.log`。
- 服务端全量（相同专用库，`pnpm --filter @synapse/server test --maxWorkers=1`）：190 文件、2,235 项通过，无跳过；日志 `/tmp/game-review8-server-full.log`。
- desktop 完整 typecheck、`check:hard-constraints` 与 server API 生产构建通过；日志 `/tmp/game-review8-desktop-types.log`、`/tmp/game-review8-hard.log`、`/tmp/game-review8-server-build.log`。
- 额外 server 全项目 typecheck 仍未通过，最终唯一错误为既有 `server/src/notifications/notification.service.spec.ts:274` TS2493，日志 `/tmp/game-review8-server-types-final.log`。新迁移测试最初的 CommonJS 路径读取 TS1470 已改为 __dirname/join，回填测试及最终类型检查均已复跑，没有把新增错误留在既有问题名下。
- `prisma validate` 初次未提供 DATABASE_URL，因环境缺失 P1012 未执行完成；显式提供本机测试 URL 后通过，日志 `/tmp/game-review8-prisma-validate.log`、`/tmp/game-review8-prisma-validate-final.log`。仅用于 schema 校验，不连接业务环境。
- 桌面全量 `pnpm --filter @synapse/desktop run test --maxWorkers=2`：1,138 文件、11,595 项通过，2 项既有 native 测试跳过；日志 `/tmp/game-review8-desktop-full.log`。`git diff --check` 通过。

- 专用库 `postgresql://game_review@127.0.0.1:55439/synapse_game_review8_e2e`，合成账号，无真实用户凭据；未连接业务库或执行生产迁移。数据库验证结束后已停止 `/tmp/synapse-game-review-pg.CQIvek/` 集群，保留数据和日志。
- 同步发布说明、能力清单、模块边界、Agent 指南和系统 Skill 协议；仍为 20 个游戏 MCP 索引、18 个 IPC。发布必须先迁移再上线 API；回滚代码可以保留新增的可空列，不删除账户、会话或归档。
- 未启动应用、浏览器或开发服务器，未重跑真实双 AI 50 手或 120 秒进程重连；无部署、发布或 push，仅 main 本地提交。
- 文档与日志仅在本地，尚无在线分享链接。
