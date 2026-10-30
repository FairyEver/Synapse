# 游戏大厅第五轮审核与修复

日期 2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，起点 `0bcff2086`。完整审核范围仍为 `20fcd49c9...HEAD`，本轮聚焦创建结果不确定、关闭状态、首次并发初始化。依据用户三份定稿文件、已确认的冲突口径及后续界面要求；未增加人类出牌、托管模型或座位令牌。

## Standards 与可用性

- **P2：新建成功但响应丢失，原表单重试重复创建。** 当前只有 act 有强制回执幂等；本轮没有把“所有写入必须幂等”假称原规格要求，而是补齐实际 UI 恢复缺口。room.create 与 agent.upsert 新建支持可选 creationId(UUID)，按当前账号与实体类型生成稳定实体 ID，利用已有主键和账户归属校验去重，不新增回执表或迁移。房间重复标识恢复首次 roomCode，包含已解散房间，不改变原参数；新选手同草稿可继续编辑保存，仍按既有 upsert/版本规则更新，同内容不新增版本。拿到选手 id 后仅传 id，不能与 creationId 同传，空 id 也拒绝，避免误创建空主键。
  - UI 同一建房参数重试复用标识，改参数或关闭重开意味着新意图，换标识；新选手草稿编辑/失败重试复用，明确新建换标识。没有按名称或内容合并用户有意创建的对象。
  - 同时保护关闭后重新打开建房表单时的迟到响应，旧成功结果不关闭新表单或跳转。已有账号变化、卸载与草稿 generation 保护保留。
  - 旧客户端不传 creationId 仍走原随机创建。新桌面使用此字段，必须遵守已有的服务端先部署、桌面后发布顺序；该标识仅用于创建去重，重连仍只用账号+roomCode。
- **P2：已解散牌桌仍显示等待开局/旁观中。** Table 和 StatusBar 原先没有优先处理 closed，未开局房间关闭后看不出已结束。现在 closed 优先显示“房间已解散”，不显示提醒或倒计时，保留返回入口和公开视角隐私保护；没有自动关窗或新增操作权限。

该轴 2 类。创建恢复是可用性补齐，关桌是确定状态误报；没有用新增确认弹窗或实现说明占据界面。

## Spec

- **P2：首次账户并发初始化报唯一键冲突。** 同账号可同时多个房间，多窗口 overview 也应可用；原 lockAccount 的 Prisma upsert(update:{}) 实际走 SELECT→普通 INSERT，既有用例先建立账户/用同房锁串行，没覆盖首次跨房。真实数据库用第一条未提交的新账户事务作栅栏，pg_locks/pg_stat_activity 证明 10 路入不同房与 10 路 overview 正在等待该主键；放行后原代码两组各 10 路均报 P2002，实际 SQL 没有 ON CONFLICT。
  - 修为数据库 INSERT ON CONFLICT DO NOTHING，然后沿用原 FOR UPDATE。只提供必填 updatedAt，使用 UTC；初始点数仍来自既有默认 1,000,000，不覆盖已有余额、盈亏或补助时间，不加入泛化 P2002 重试。
  - 验证第一次 10 房入座都成功，初始点数只创建一次，总额 1,000,000、可用 990,000、占用 10,000；第一次 10 路 overview 全部成功；已有账户的余额/盈亏/补助时间不重置。

该轴 1 类，主要问题是首次合法并发请求失败；没有证据表明原失败回滚造成重复发钱。

## 测试与交付

本轮新增 17 项回归（服务端 8、桌面 9）。真实数据库游戏专项 20 文件、117 项全绿；游戏桌面专项 18 文件、71 项全绿。新增场景均先复现失败再修复，UI模拟响应丢失，实库创建测试覆盖冷并发与同标识重试、大小写 UUID、关房后重试、不同账号/新意图隔离、提示词版本及不合法标识。独立审查者复核后端/前端创建语义、所有权与版本并发保护，未发现确定回归。

- 服务端带真实测试库的最终全量：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review5_e2e pnpm --filter @synapse/server test --maxWorkers=1`，186 文件、2,215 项通过，无跳过；日志 `/tmp/game-review5-server-full-final.log`。
- 首次服务端全量 2,214 通过、1 失败，为既有 `update-intent.http.spec.ts` 凭据签发限流用例返回 404（预期 200）。该文件独立复跑 15/15、完整复跑均通过，没有修改其源码、断言或超时；日志 `/tmp/game-review5-server-full.log`、`/tmp/game-review5-unrelated-update-http-retry.log`。
- desktop 完整 typecheck、`check:hard-constraints`、Renderer 构建通过；日志 `/tmp/game-review5-desktop-types.log`、`/tmp/game-review5-hard.log`、`/tmp/game-review5-renderer-build.log`。server API 生产构建通过，日志 `/tmp/game-review5-server-build.log`。
- 额外 server 全项目 typecheck 未通过，唯一错误仍是既有 `server/src/notifications/notification.service.spec.ts:274` TS2493，日志 `/tmp/game-review5-server-types.log`；不把生产构建通过称作全项目类型检查通过。
- desktop 全量：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1,137 文件、11,588 项通过，2 项既有 native 测试跳过；日志 `/tmp/game-review5-desktop-full.log`。
- `git diff --check` 通过。仅在 main 本地提交，无 push。

- 独占数据库 `postgresql://game_review@127.0.0.1:55439/synapse_game_review5_e2e` 从空库应用既有 95 份迁移，日志 `/tmp/game-review5-migrations.log`。没有新迁移或业务数据库操作，未部署、发布、push。
- 临时集群 `/tmp/synapse-game-review-pg.CQIvek/`，本轮数据库验证后已停止并保留数据及日志。测试使用合成账号与样本，没有真实凭据。
- 已同步 bridge、shared 输入 schema/描述、系统 Skill、协议、Agent 指南、模块边界、能力清单及 `RELEASE_NOTES_PENDING.md`。仍为 20 个游戏 MCP 索引、18 个 IPC，未增加工具或权限。
- 本轮未启动应用/浏览器，未重复真实双 AI 50 手或实机手机验收。回滚代码不删除账户、房间、选手、历史归档或幂等凭据。
- 文档和日志仅位于本地，尚无在线分享链接。
