# 游戏大厅第二轮审核与修复

2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，本轮修改分支 `main`，起点 `f3f6d88e0`。审核范围仍是 `20fcd49c9...HEAD` 的完整游戏大厅功能，重点补查第一轮未覆盖的使用路径。事实依据为 `/Users/liyang/Desktop/德州扑克/产品设计文档.md`、`实施计划.md`、`提示词.md` 和用户已确认的冲突口径及后续视觉要求。

## Standards

- **P1：异步权限检查期间串用账号。** 游戏 dispatcher 在权限检查之后才让网络 service 捕获账号；A 发起包含私密提示词的请求，权限等待期间切到 B，原请求会以 B 执行。同账号重登及服务销毁也不能阻止等待中的旧调用。已将身份捕获提前至权限检查之前，检查通过后重新验证账号与 generation，沿用现有发送期间取消与响应隔离。真实 dispatcher/service 加延迟权限替身的三种失效路径先失败后通过；身份不变仍执行一次。对应 `desktop/app-capabilities/game-hall/main/dispatcher.ts`、`service.ts`。
- **P2：慢保存覆盖新草稿。** 档案保存期间输入新提示词、切换选手或新建，迟到响应会回填旧选手内容。现在按草稿会话判断是否仍可回填；同一草稿继续输入则保留新输入并承接返回 ID，避免新建后重复保存创建第二个选手。对应 `AgentProfiles.tsx`，四个真实 React 交互用例先失败后通过。

Standards 共 2 类，重点为发起账号与异步授权结果必须属于同一身份。未发现需要额外重构或新增依赖的依据。

## Spec

- **P1：缺席本手的暂离座位读到其他人的摊牌。** §12.4 要求摊牌只对参与者公开；原参与判断只比较 joinedHandNo，长期占座但本手未发牌的人也通过。现在必须同时在本手引擎座位中，保留 joinedHandNo 防座位复用保护。真实三人跨手用例先复现底牌泄露，再验证缺席者 owner/public 无任何底牌、自己旧底牌为空、实际参与者仍可看摊牌、历史权限正确。对应 `PokerActionService.view`。
- **P2：overview 无法识别已暂离状态。** 第一轮已修指南，但 GameSession 仍把 sitting_out 折叠成 waiting。现在由扑克在 sit 和结算时同步真实状态；当前手的暂离申请仍 active 并保留行动点，手后才 sitting_out，回座恢复 waiting/active，不重复扣点。seat_sit 保留 sittingOut 请求确认，新增 pending/status 表达实际生效情况。guide、Skill、协议、注册清单和长期边界同步；pending 时立即停止调用仍适用 600 秒超时离桌，不承诺保留座位，也不擅自替用户出牌。
- **P2：老房间刚离空便立即解散。** §12.7 要求无人在线 30 分钟且无进行中手才清理；原空桌仅按建房时间计算。现在用建房时间和该房间会话最近活动（包含 closed）的较晚者作为空桌起点。覆盖刚离空、满 30 分钟、无入座历史以及同账号同房间复用会话重入。无需新列或迁移。对应 `PokerService.maintain`。

Spec 共 3 类，重点为摊牌权限必须对应实际参加的那一手。人类仅观看、账号加 roomCode 重连、600 秒超时即移出、点数守恒、永久幂等凭据等既有边界保持。

## 验证与交付

本轮新增 15 个回归测试（桌面 8、服务端 7），并加强既有 guide 契约断言。游戏桌面专项 14 文件、51 项通过；真实数据库游戏专项 14 文件、80 项通过。核心新缺陷均观察 RED 再修复为 GREEN。另一审查代理复核本轮修复，身份隔离、网络服务与档案交互 12 项通过，未发现新的确定回归。

- desktop 完整 typecheck、`check:hard-constraints`、Renderer 构建通过；日志 `/tmp/game-review2-desktop-types.log`、`/tmp/game-review2-hard.log`、`/tmp/game-review2-renderer-build.log`。server 生产 API 构建通过，日志 `/tmp/game-review2-server-build.log`。
- 额外 server 全项目 typecheck 首次暴露本轮新隐私测试对 Prisma JSON 的类型使用问题，已改为逐项断言并复验；最终仅剩既有 `server/src/notifications/notification.service.spec.ts:274` 的 TS2493 错误，未动无关通知测试。日志 `/tmp/game-review2-server-types-final.log`，不得称为全项目类型检查通过。
- server 带专用数据库的首次串行全量：2,177 通过、1 失败，失败是既有 `problem-feedback-http.spec.ts` 上传超过 1 MiB 时的 `write EPIPE`；独立同文件重跑 8/8 通过，未改源码、断言或超时。日志 `/tmp/game-review2-server-full.log`、`/tmp/game-review2-unrelated-http-retry.log` 保留。
- 最终带真实专用数据库的 server 全量：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_game_review2_e2e pnpm --filter @synapse/server test --maxWorkers=1`，180 文件、2,178 测试全部通过，无跳过。日志 `/tmp/game-review2-server-full-final.log`。
- desktop 全量：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1,133 文件、11,568 项通过，2 个既有 native 测试跳过。日志 `/tmp/game-review2-desktop-full.log`。
- `git diff --check` 通过，本轮只在 main 本地提交，无 push。

数据库只使用本轮新建 `postgresql://game_review@127.0.0.1:55439/synapse_game_review2_e2e`，从空库部署仓库现有 95 份迁移，日志 `/tmp/game-review2-migrations.log`。没有新增迁移，没有业务库操作、部署、发布或 push。临时集群位于 `/tmp/synapse-game-review-pg.CQIvek/`，验证后已停止，数据和日志保留。本轮不启动应用或浏览器，不重复真实双 AI 50 手与实机推送；此前结果只能参考原验收记录，不能视作本轮重跑。

已更新 `RELEASE_NOTES_PENDING.md`。回退本轮应用提交不会删除历史数据；不要通过删除游戏表、归档、行动凭据或点数回滚。文档与日志目前仅在本地，尚无在线分享链接。
