# 游戏大厅第四轮审核与修复

2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，本轮起点 `3bad2f313`。功能审核基线仍为 `20fcd49c9...HEAD`，本轮聚焦前几轮未覆盖的跨房间资金锁序、座位复用后的行动人归属、多窗口与取消隔离。依据用户桌面三份定稿文件及对话确认的冲突口径，没有重做设计或扩大权限。

## Standards

未发现新的确定标准缺陷。只读核对多窗口、异步回调、查询尾随批次、认证刷新取消、MCP 来源与 UI 白名单；多窗口同时修改同一选手仍遵循现有最后保存契约，没有擅自增加乐观锁。网络权限策略当前生产均为同步判定，没有把理论上未返回的异步策略当成已复现问题。

## Spec

- **P2：座位被复用时，当前手日志把旧动作归给新玩家。** 产品要求每个动作显示“谁”；原 recentActions 只有 seatNo，SidePanel 根据当前座位占用者查名字。真实三人手牌中，旧玩家超时离场、新账号复用同座位，本手尚未结束，日志显示新玩家做了旧玩家的 fold。现在服务端从本手 GamePokerHandSeat 姓名快照投影可选 displayName（最多查 10 条，只取座位号和姓名）；没有动作时不增加快照查询。本人/公开视角一致，不公开 userId、note 或版本。UI 仅使用快照名，缺失时显示座位号，不猜当前占用者。服务端完整跨手真实 DB 用例及两个 React 展示用例先 RED 后 GREEN，历史 hand_detail 原本已使用快照，未重复改动。
- **P2：两房交叉入座遇到自动结算时死锁，合法操作失败。** 同账号允许多房间。R1 中旧 B 剩 1 筹码，A 入座先锁 A；R2 中旧 A 剩 1 筹码，B 入座先锁 B；两手自动盲注结算后分别退款又需要 B/A 锁。用真实 PostgreSQL、受控洗牌和并发栅栏证明一方失败，原始错误为 Prisma P2010、meta.code=40P01，数据库报告两个事务互等 ShareLock。现在 withRoom 只对确认回滚的 P2034 和 P2010/40P01 最多做三次完整尝试；每次重新读取房间、座位和账户，普通错误/其他 SQL 错误不重试，提交后订阅与推送不在重试循环内。两房各只成功一次，A/B 可用余额各 998000、每房 handNo=1 且 paused、四会话中两会话关闭、座位及点数和净盈亏守恒；持续冲突三次后停止，失败写入全部回滚。另保护同账号双桌离座及跨桌入/离并发。

Spec 2 类，均已修复；主要可用性问题为跨房间合法入座的死锁失败。未证明存在资金丢失或新增隐私泄露，不把死锁回滚误写成丢款。

## 验证

本轮新增 10 项回归测试（服务端 8、桌面 2）。真实数据库游戏专项 18 文件、109 项全部通过；行动日志 UI 与牌桌专项 6/6，通过 RED→GREEN 验证。两位审查者交叉核对本轮修改，提交副作用不进入重试，行动姓名的白名单与私密字段隔离保持。

- 服务端带真实测试库的最终全量：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review4_e2e pnpm --filter @synapse/server test --maxWorkers=1`，184 文件、2,207 项全部通过，无跳过；日志 `/tmp/game-review4-server-full-final.log`。
- 首次服务端全量 2,206 通过、1 失败，为既有 `update-intent.http.spec.ts` 的凭据限流测试超出默认 5 秒预算。该文件独立 15/15、完整复跑也通过；未改其源码、断言或超时。日志 `/tmp/game-review4-server-full.log`、`/tmp/game-review4-unrelated-update-http-retry.log`。
- desktop 完整 typecheck、`check:hard-constraints`、Renderer 构建通过；日志 `/tmp/game-review4-desktop-types.log`、`/tmp/game-review4-hard.log`、`/tmp/game-review4-renderer-build.log`。server 生产 API 构建通过，日志 `/tmp/game-review4-server-build.log`。
- 额外 server 全项目 typecheck 未通过，唯一错误仍为既有 `server/src/notifications/notification.service.spec.ts:274` TS2493，日志 `/tmp/game-review4-server-types.log`。不把生产构建通过称作全项目类型检查通过。
- desktop 全量：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1,136 文件、11,579 项通过，2 项既有 native 测试跳过；日志 `/tmp/game-review4-desktop-full.log`。
- `git diff --check` 通过。本轮仅 main 本地提交，无 push。

## 交付边界

- 使用独占数据库 `postgresql://game_review@127.0.0.1:55439/synapse_game_review4_e2e`，从空库应用既有 95 份迁移；日志 `/tmp/game-review4-migrations.log`。没有新增迁移，不连接或写入业务库，未部署、发布或 push。
- 临时集群 `/tmp/synapse-game-review-pg.CQIvek/`，本轮数据库验证后已停止并保留数据日志。测试只控制测试洗牌熵以稳定复现死锁，生产仍使用加密随机熵，未改下注规则、600 秒窗口或点数政策。
- 已同步行动 DTO、Agent 协议与指南、模块边界、注册清单和 `RELEASE_NOTES_PENDING.md`；20 个游戏 MCP 索引、18 个 IPC 数量不变，无新增工具或权限。
- 本轮未启动应用或浏览器，未重跑真实双 AI 50 手或手机验收。回退应用提交不删除任何游戏记录或资金数据；数据表、归档与幂等凭据不得作为代码回滚手段删除。
- 文档和日志目前仅有本地路径，尚无在线分享链接。
