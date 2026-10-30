# 游戏大厅第六轮审核与修复

日期 2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，起点 `0fd48a044`。完整功能审核基准仍为 `20fcd49c9...HEAD`，本轮重点是长开页面、重复状态请求和服务生命周期；依据三份定稿文件、用户确认的冲突口径及后续界面要求。

## Standards 与可用性

- **P2：离桌后的档案对比筛选无法恢复。** 选择本人牌桌后，overview 持续更新，但 roomCode 留在本地。最后一个座位消失时筛选器隐藏，统计仍查旧房间；服务端正确拒绝无座位查询，页面重试也只会继续发失效房间。现仅在大厅成功确认座位不存在时切回本人全局统计。临时错误、离线和重连加载期间不把缺少数据当作离桌；依靠既有查询 key 隔离忽略旧房间迟到响应，不放宽统计权限。
- **P2：销毁后长轮询继续工作，取消边界可能返回成功。** 原 onModuleDestroy 只取消订阅并唤醒休眠；循环仍会再读数据库、创建定时器，服务停止后也接受新 wait。现停止状态先置位，关闭入口幂等，已有休眠唤醒后结束、在途读取完成后不再继续等待，新请求返回 503；读取完成和循环截止均检查取消/停止。pause 的清理与成功返回分离，abort 真正拒绝请求并释放计时器/监听/房间并发计数，不先 resolve 再 reject。服务停止不返回 table_closed，避免 Agent 据此重复入座。

该轴 2 类可用性/资源生命周期缺陷，均为 P2；没有借代码气味做无关重构。

## Spec

- **P2：重复暂离无限延长占位。** 产品文档第 13 节要求“连续 30 分钟处于暂离且房间无进行中的手，自动离桌退筹码”。原 sit 每次无条件写 session.lastActiveAt，已经暂离 29 分钟时重发 true 会重置维护计时。现重复已经生效的暂离只刷新心跳，不改变暂离起点；本人真正回座再暂离重新计时，手中 pending 仍从结算实际生效时起计。原 saveHand 的结算计时无需改变。退款、同桌资产守恒和无人在线清理保持原规则。

该轴 1 类，P2；没有新增控制对手权限、出牌控件、模型托管或座位令牌。

## 回归证据

新增 10 项回归（服务端 8、桌面 2）。暂离用独立真实数据库，3 例从 1 红 2 绿到 3 绿：重复请求不能续期、实际回座后重新计时、手后首次生效起算，验证退款与总点数守恒。日志 `/tmp/game-review6-sit-red.log`、`/tmp/game-review6-sit-green.log`。

档案测试保留实际 useGameQuery/useHallOverview，以假 API 和定时大厅刷新复现失效筛选，修复后验证全局恢复和迟到错误隔离；另验证临时错误、离线及重连等待保留有效选择。长轮询使用外部数据库边界替身和假时钟，实际运行 wait 控制流，4 项先红后绿，补充截止同时取消和连续 11 次取消不占满房间限额，共 5 项通过。日志 `/tmp/game-review6-wait-red.log`、`/tmp/game-review6-wait-green.log`。独立审查者复核等待生命周期修复，未发现确定回归。

## 验证与交付

- 游戏服务端专项：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review6_e2e pnpm --filter @synapse/server test src/game --maxWorkers=1`，22 文件、125 项通过，无跳过；日志 `/tmp/game-review6-game-server.log`。
- 游戏桌面专项：`pnpm --filter @synapse/desktop run test src/modules/game-hall app-capabilities/game-hall --maxWorkers=2`，19 文件、73 项通过；日志 `/tmp/game-review6-game-desktop.log`。
- desktop 完整 typecheck、`check:hard-constraints`、Renderer 构建通过；日志 `/tmp/game-review6-desktop-types.log`、`/tmp/game-review6-hard.log`、`/tmp/game-review6-renderer-build.log`。server API 生产构建通过，日志 `/tmp/game-review6-server-build.log`。
- 额外 server 全项目 typecheck 未通过，唯一错误仍为既有 `server/src/notifications/notification.service.spec.ts:274` TS2493，日志 `/tmp/game-review6-server-types.log`；生产构建通过不等于全项目类型检查通过。
- desktop 全量：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1,138 文件、11,590 项通过，2 项既有 native 测试跳过；日志 `/tmp/game-review6-desktop-full.log`。
- 首次 server 全量 2,222 项通过、1 项失败，失败是未修改的通知 HTTP 限流测试默认 5 秒超时；该文件独立复跑 9/9 通过（测试总计 173ms）。未改该文件源码、断言或超时，保留 `/tmp/game-review6-server-full.log`、`/tmp/game-review6-notification-http-retry.log`。
- 最终 server 全量在桌面测试结束后串行复跑：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review6_e2e pnpm --filter @synapse/server test --maxWorkers=1`，188 文件、2,223 项通过，无跳过；日志 `/tmp/game-review6-server-full-final.log`。
- `git diff --check` 通过；本轮交付只包含上述三项修复与配套测试、协议/规则和发布说明。

- 本轮只对新建的 loopback 专用数据库 `postgresql://game_review@127.0.0.1:55439/synapse_game_review6_e2e` 应用已有 95 份迁移，日志 `/tmp/game-review6-migrations.log`。没有新增迁移或操作业务库。
- 临时集群 `/tmp/synapse-game-review-pg.CQIvek/`，验证结束后已停止，保留测试数据和日志。使用合成账号，无真实凭据。
- 同步发布说明、模块边界、Agent 指南、系统 Skill 的协议与规则；20 个 MCP 索引、18 个 IPC 的数量、schema、权限与注册不变。
- 未启动开发服务器、应用或浏览器；本轮未重新执行真实双 AI 50 手或实机验收，不把单元/数据库回归等同于端到端验收。
- 仅在 main 本地提交，不 push、部署或发布。回滚仅撤销本次代码与配套文档，无数据库结构回滚；不得删除既有游戏资产或归档。
- 本文档和日志仅位于本地，尚无在线分享链接。
