# 游戏大厅代码审核与自动修复记录

日期：2026-10-30。仓库：`/Users/liyang/Documents/code/github/Synapse`，修改分支：`main`。本轮起点 `18a68988067f437a48d43170612b6c599bdcce49`，审核整个功能从 `20fcd49c9b3804b220987ca7e8c1962deede95be` 开始的提交及本轮修复。

事实依据：`/Users/liyang/Desktop/德州扑克/产品设计文档.md`、`实施计划.md`、`提示词.md`，以及用户在当前对话确认的冲突处理和后续 UI 要求。App 顶栏保持统一规范，游戏内部维持已接受的独立视觉；没有增加人类出牌、托管模型或控制对手暂离的入口。

## Standards：可用性与工程契约

1. 房间深链只更新 roomCode，不重置 PokerApp 的记录/档案 tab，导致收到深链却看不到牌桌。现在同步切回房间 tab；新增两个真实 React 重渲染用例，修复前失败。
2. 创建请求完成后无条件导航；用户已离开页面或切换账号，迟到响应仍能触发旧回调。现在写操作绑定挂载周期、账号和请求票据，旧结果返回 null，旧请求的 finally 不会释放新请求锁。已完成的服务端写入不会因此撤销。
3. 读取失败只有 toast，无可恢复的页面状态；首次失败和离线会一直显示占位，部分档案/预览显示为空。现在大厅、房间、记录、档案、版本与预览显示错误和重试；普通刷新失败保留上次数据并显示错误，成功后清除错误；离线不发请求。回归覆盖失败→重试、旧数据→失败→恢复、账号切换时拒收旧数据。
4. guide/Skill 指示已有座位直接 wait；暂离座位只返回 waiting，导致明确要求继续也无法回座。现在先检查 overview.status；sitting_out 仅在用户明确继续时 seat_sit(false) 后 wait，仅查看和重连不自动回座。系统 Skill、协议、Agent 指南与服务端 guide 同步。

## Spec：统计与持久化语义

1. 全下跟注被一律算作翻前加注和进攻。现在从全桌动作、实际盲注和每街累计投入还原行动前最高注额，区分全下下注/加注/跟注，热表与归档走相同统计。覆盖等额、短筹码、翻牌后跟注、累计投入后的真加注、多人与不连续座位。
2. 超时通知只查询热表；90 天归档后尚未消费的 lastAutoAction 丢失。现在已关闭会话可从热表及归档恢复通知，仍以 lastEventId 原子消费一次；活跃会话不扫描归档，候选限制在本次会话之后。
3. PostgreSQL 非 UTC 会话时区下，timestamp 与 CURRENT_TIMESTAMP 的隐式转换破坏时间边界。归档函数及两处不可变记录 guard 统一按 UTC 比较，扫描 cutoff 与参数显式使用 UTC；历史迁移不改，通过新增迁移纠正。空房间创建时间和 30 分钟清理边界也实际验证，未复现时区问题，保留回归但没有修改创建行为。

已复现问题均先增加失败用例再修复。两条独立审查轴未发现其他已证实的资金、私密字段、行动幂等或引擎规则缺陷；这不表示已证明不存在任何缺陷。

## 本轮验证

- 本轮新增 23 项回归用例（桌面 8、服务端 15）；游戏桌面专项 12 文件、43 项通过。命令：`pnpm --filter @synapse/desktop exec vitest run src/modules/game-hall app-capabilities/game-hall --maxWorkers=2`，日志 `/tmp/game-audit-desktop-focused.log`。
- 真实 PostgreSQL 游戏专项：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review_e2e pnpm --filter @synapse/server exec vitest run src/game --maxWorkers=1`，11 文件、73 项全部通过，无跳过。
- desktop 完整 typecheck、`check:hard-constraints`、Renderer 构建通过。日志 `/tmp/game-audit-desktop-types.log`、`/tmp/game-audit-hard.log`、`/tmp/game-audit-renderer-build.log`。
- server 生产 API 构建通过，日志 `/tmp/game-audit-server-build-final.log`。额外的 `pnpm --filter @synapse/server run typecheck` 未通过：既有 `server/src/notifications/notification.service.spec.ts:274` 的 mock.calls 被推断为零长度 tuple（TS2493）。该文件不在本功能差异内，本轮未修改；日志 `/tmp/game-audit-server-types.log`。生产构建排除测试，不能将其通过写成全项目 typecheck 通过。
- 普通 server 全量测试曾通过 169 文件、2,126 项，数据库用例默认跳过；日志 `/tmp/game-audit-server-full.log`。打开专用数据库后额外跑默认并发全量，2,170 通过、1 失败：维护测试按真实当前时间扫描了另一用例以 1970 年模拟的房间，导致其座位超时移除。该数据库套件按仓库指南要求串行运行，未改断言或提高超时掩盖；失败日志 `/tmp/game-audit-server-full-with-db.log` 保留，后续串行全量结果如下。
- 最终 server 带真实专用数据库的全量测试：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review_e2e pnpm --filter @synapse/server test --maxWorkers=1`，177 文件、2,171 项全部通过，无跳过；日志 `/tmp/game-audit-server-full-with-db-serial.log`。
- 最终 desktop 全量测试：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1,131 文件、11,560 项通过，2 个既有 native 测试跳过；日志 `/tmp/game-audit-desktop-full.log`。
- `git diff --check` 通过。本轮保留 main，只做本地提交，无 push。

## 交付边界

本轮不 push、不发布、不部署，不连接或迁移业务数据库。数据库验证仅使用自建 loopback PostgreSQL `127.0.0.1:55439/synapse_game_review_e2e`。新增 `server/prisma/migrations/20261030110000_game_poker_archive_utc/migration.sql`，仅替换归档函数与两处不可变记录保护函数的 UTC 时间比较，不改旧迁移。任务测试库共应用 95 份仓库迁移，验证结束后已停止临时 Postgres，数据和日志保留在 `/tmp/synapse-game-review-pg.CQIvek/`；业务环境未执行。本功能当前有四份游戏迁移，发布前应按顺序执行。回退本轮应用代码不会删除归档、行动凭据或点数；不得通过删除表、归档或历史记录回滚。

此前两个真实 AI 连续 50 手和新会话重连的结果见 [原验收记录](./2026-10-30-game-hall-validation.md)；本轮不把此前结果称为重新执行。本轮没有启动桌面应用或浏览器，未重复视觉截图、实机推送或真实 AI 长局。

本文件仅有仓库本地路径，尚无在线分享链接。
