# 游戏大厅第九轮审核与修复

日期 2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，起点 `43eecb796`；完整功能基准仍为 `20fcd49c9...HEAD`。本轮聚焦后台失败隔离、成功响应边界和错误恢复，遵循三份定稿文件及已确认口径。

## Standards 与可用性

**P2：畸形成功响应被当作有效数据，界面崩溃或永久加载。** 原云代理将 HTTP 200 的 `{}` 当大厅数据，HallHome 访问缺失 games 时抛错；`{ok:true,data:null}` 则进入成功状态但一直 Skeleton。桌面 stats/table/history/version 等同样缺少运行时结构保障。

现非 bare 传输要求 `ok:true` 且 data 非 null/undefined，按已有 DTO 校验 20 个 MCP 操作和私有解散操作。大厅与扑克 schema 分属自身模块，云代理查注册表，不按扑克分支；已知和嵌套对象允许未来附加字段。JSON/DTO 畸形统一 GAME_INVALID_RESPONSE，不带原载荷、校验错误或私密字段。保留业务错误先处理、原取消原因和账号变更优先级，桌面 state/close 的 bare 传输保持。读操作可重试；写结果未知时先核对，act/创建保持原 actionId/creationId，不误发新操作；MCP 首读 poker.guide 的错误恢复表及系统 Skill 同步该规则，指南断言也先红后绿，`/tmp/game-review9-guide-red.log`、`/tmp/game-review9-guide-green.log`。

该轴 1 类 P2。新响应边界测试先 13 红、25 绿，`/tmp/game-review9-responses-red.log`；实际 GameHallApp+GameHallService 的 null→错误→重试恢复交互先失败，`/tmp/game-review9-response-ui-red.log`。修复后响应 44 项（21 操作、4 种 wait、两种 close、未来字段、嵌套类型、损坏 JSON 隐私与取消优先级）及取消/身份/恢复专项共 54/54 通过，`/tmp/game-review9-protocol-special-tests.log`。既有身份测试的成功 fake 改为合法 agent DTO，原账号隔离、id 和单次调用断言保留。

## Spec 与异常隔离

**P2：持续失败的最早批次会永久挡住后续健康项。** 实施计划阶段 3 要求每秒推进超时，产品要求空闲退款与满 90 天归档。原 deadline 与 archive 固定取最早 100，失败后仍占下次前缀；idle 的 lastMaintainedAt 在维护失败回滚时也不推进。100 项持续失败后，第 101 个健康项永远处理不到，单项 try/catch 不能解决跨批次饥饿。与前轮正常空闲房间轮转不同，本轮处理的是异常回滚后的前缀阻塞。

三条扫描各自记录内存键集：deadline(actionDeadlineAt,id)、idle(lastMaintainedAt NULL-first,createdAt,id)、archive(endedAt,id)。一轮固定资格截止，每批最多处理 100，失败/无变化也推进，空尾最多一次回绕，短批次结束本轮；重启从头，不引入持久化检查点或修改不可变记录。处理仍用本次 now，1 秒/30 秒/60 秒节拍、600 秒行动规则及数据库 90 天完整归档验证不变。idle 以查询时的维护时间快照推进，排除本轮成功维护行，既保留新待检查房间优先级，也避免已处理行移动到尾部再次入选。

该轴 1 类 P2。实际 Task/ArchiveService 配合外部持久化/操作故障替身：9 例先 6 红、3 绿，补整批 100 空尾回绕后 12/12 绿；各覆盖持续失败不挡 101、小批次恢复、满批回绕、新到期不延长旧轮及本次操作时钟。日志 `/tmp/game-review9-background-fairness-red.log`、`/tmp/game-review9-background-fairness-green.log`。

首次全量暴露了仅按 createdAt 轮转的回归：已有 100 个维护过的在线旧房间时，新 100 个待检查房间和冷房间排到第 201 项，原实库“两次 scan 清理”断言失败。未放宽原断言；补 2 项受控回归先 2 红 12 绿，恢复 NULL-first 与维护时间快照后 14/14 绿，原 review-regressions.spec.ts 实库 6/6 绿。日志 `/tmp/game-review9-idle-priority-red.log`、`/tmp/game-review9-idle-priority-green.log`、`/tmp/game-review9-idle-priority-db.log`。最终交叉只读复核无其他确定回归。

## 实际后端响应兼容证据

- `/tmp/game-review9-real-responses.cjs` 使用实际构建后的 GameApiService、Hall/Poker 服务和独立 Postgres，经 JSON 序列化后交给实际 GameHallService 与新校验器；HTTP fetch 边界由内存适配，不启动 API 服务器或应用，不冒称真实 MCP/HTTP 联调。
- 21 操作、45 次序列化响应全部保持 deepStrictEqual，覆盖 4 种 wait、空桌/在局/关闭、公开及本人视角、行动幂等、补助、版本、记录、stats comparison 和两种 close；另确认公开座位不凭空出现 hole 属性。提醒发送替身计数 1，无真实通知/推送。最后补首读 guide 恢复规则后再构建并重跑仍通过，日志 `/tmp/game-review9-real-responses.log`、`/tmp/game-review9-real-responses-final.log`，临时客户端构建日志 `/tmp/game-review9-client-build.log`。
- 本轮新增 59 项回归（服务端 14、桌面 45），没有新增依赖、迁移或能力；仍为 20 个 MCP 索引、18 个 IPC，校验器属于内部响应边界。同步发布说明、模块边界、能力清单、Agent 指南及系统 Skill 恢复协议。

## 验证与交付

- 首次 server 全量 2,245 通过、2 失败：上述本轮 idle 维护回归，以及未修改的 Drive 鉴权用例返回 401（预期 200）。两者分别修复与独立复跑：原维护文件 6/6、Drive 文件 82/82 通过，没有修改 Drive 源码、断言或超时。日志 `/tmp/game-review9-server-full.log`、`/tmp/game-review9-drive-retry.log`。最终全量在修复后重跑，不能把首轮当作全绿。
- desktop 最终完整 typecheck、`check:hard-constraints` 通过，日志 `/tmp/game-review9-desktop-types.log`、`/tmp/game-review9-hard.log`；最终 server API 生产构建通过，日志 `/tmp/game-review9-server-build-final-guide.log`。额外 server 全项目 typecheck 仍只报既有 `server/src/notifications/notification.service.spec.ts:274` TS2493，日志 `/tmp/game-review9-server-types-final.log`。
- desktop 全量 `pnpm --filter @synapse/desktop run test --maxWorkers=2`：1,140 文件、11,640 项通过，2 项既有 native 测试跳过；日志 `/tmp/game-review9-desktop-full.log`。客户端代码自最终类型检查后未变；服务端维护优先级与 guide 的后续修正未改变客户端实现或响应契约。
- 第二次 server 全量游戏测试均通过，但未修改的 Drive 两项返回 404/401、问题反馈 HTTP 两项遇到 ECONNRESET/EPIPE，合计 4 失败、2,245 通过；日志 `/tmp/game-review9-server-full-final.log`。这两个文件联合独立复跑 90/90 通过，`/tmp/game-review9-http-retry.log`；未修改其源码、断言、超时或跳过配置。随后继续串行完整复跑，不把专项通过当作完整通过。
- 第三次普通 server 全量：2,247 通过、2 失败，仍为未修改的 Drive 过期分享用例返回 404（预期 302）、问题反馈超限上传 EPIPE，所有游戏测试通过；日志 `/tmp/game-review9-server-full-complete.log`。普通单命令全量未达到全绿，不能用独立复跑替代这一结论。
- 最后按进程分组验证：主体（排除上述两个 HTTP 文件，保留既有 e2e 排除）189 文件中 188 通过、1 失败，2,158 项通过、1 项通知 HTTP 用例 5 秒超时，日志 `/tmp/game-review9-server-isolated-main.log`；Drive/问题反馈联合 2 文件 90/90 通过，日志 `/tmp/game-review9-server-isolated-http.log`；通知 HTTP 独立 1 文件 9/9 通过，日志 `/tmp/game-review9-notification-http-retry.log`。因此全部 191 文件、2,249 项用例均取得通过证据，但不存在一次完整执行或一次完整分组执行全部通过的结果；HTTP 波动原因未确定，没有修改无关用例、断言、超时或跳过配置。停止重复全量重跑，保留这一验证限制。
- `git diff --check` 通过。本轮两类修复、59 项新增回归、既有游戏回归及实际后端响应兼容验证均通过；桌面完整验证通过。服务端普通全量 HTTP 波动及额外全项目类型检查的既有错误未在本轮修复。

- 专用库 `postgresql://game_review@127.0.0.1:55439/synapse_game_review9_e2e` 从空库应用既有 96 份迁移，`/tmp/game-review9-migrations.log`。没有业务库操作、真实账号凭据或部署；验证结束后已用 pg_ctl fast stop 停止 `/tmp/synapse-game-review-pg.CQIvek/` 集群，保留数据与日志。
- 本轮未运行应用、浏览器、开发服务器或真实双 AI 50 手/120 秒重连；没有 push、部署、发布，仅 main 本地提交。回滚本次代码不改变数据库结构或删除资产。
- 所有文档、脚本和日志仅在本地，尚无在线分享链接。
