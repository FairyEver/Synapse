# 程序机器人陪练房 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 正式游戏提供房主可管理的程序机器人陪练房，真人由外部 AI 出牌，练习筹码不进入大厅点数。

**Architecture:** 固定房间 mode，通用 GameSession funding 隔离资金；机器人使用内部参与者而非账号，复用房间锁和引擎。持久化机器人行动时间、创建凭据及参与者快照，正式/练习查询覆盖热表和归档。

**Tech Stack:** 现有 NestJS/Prisma/Postgres、Electron/React/shadcn、Vitest、pnpm；不加依赖。

**Spec:** `docs/superpowers/specs/2026-10-30-poker-practice-bots-design.md`（已确认）。

## Global Constraints

- 当前仓库 main 原地开发，不分支、不 worktree、不 push、不部署、不写业务库。
- 点数房默认，房间模式固定；陪练 GameSession buyIn/inPlay/returned 为零/null。
- 不托管模型，人类不能出牌；真人 600 秒窗口、重连、隐私与不可变归档保持。
- 每阶段先看到测试失败，再实现、跑该阶段检查；最终一次本地中文提交。

## Review Focus

- 陪练离桌/超时/解散/维护及并发计分桌不得增加账户点数，覆盖 Task 1/2。
- bot.add 丢响应后重试、已删除后重试不得重复或复活，覆盖 Task 2。
- 多实例及旧行动调度不得在新手重复下注，覆盖 Task 3。
- 只有机器人、真人暂离或掉线不能造成无限自转或房间永不维护，覆盖 Task 2/3。
- 归档、版本计数和异步页面切换不能混入练习战绩或泄露暗牌，覆盖 Task 4/5。

### Task 1: 通用资金隔离与迁移

**Files:** `server/prisma/schema.prisma`、新增 migration、`server/src/game/hall/hall.service.ts`、新增 `server/src/game/poker/__tests__/practice.spec.ts`。
**Interfaces:** `HallService.join(..., input: JoinSession & {funding?: "points"|"practice"}, now)`；practice 传 buyIn=0；`leave` 对 practice 非零退款拒绝；overview session 增 funding。

- [x] 新建实库测试：陪练零扣款、零占用、零退款，点数房并行正常；practice 不能转 funding，数据库拒绝非零记账。
- [x] `GAME_E2E_DATABASE_URL=<专用本地_e2e库> pnpm --filter @synapse/server test src/game/poker/__tests__/practice.spec.ts --maxWorkers=1`；先 FAIL。
- [x] 新增 mode/funding/participantKind/actionSource、botActionAt 与永久 bot 创建记录；旧行默认 points/human，迁移不改旧行动。实现 Hall 通用分支，补助/流水仅 points。
- [x] 专用库迁移与 Prisma generate 后重跑；Expected: 本阶段测试 PASS。

### Task 2: 陪练生命周期和机器人管理

**Files:** `poker.service.ts`、`poker-lifecycle.ts`、新增 `poker-bot.service.ts`、`practice.spec.ts`。
**Interfaces:** `createRoom(...,{mode?})`；`PokerBotService.add(userId,roomCode,creationId,now?)` → `{botId,seatNo}`；`remove(userId,roomCode,botId,now?)` → `{pending}`。

- [x] 测试机器人无 User/Account/Session、权限/容量、创建重试/删除不复活、手中增删、输光、无人/暂离暂停、30 分钟清理及资金不变；运行先 FAIL。
- [x] room 锁查询新增字段；practice join 建零会话，refund 不兑点，saveHand 不写练习占用；bot 创建记录保留，内部 ID 与人类身份分离；新手至少一个 eligible human。
- [x] 原游戏回归及 practice 测试 PASS；不改原计分断言。

### Task 3: 纯策略、共用行动提交和调度

**Files:** 新增 `bot-policy.ts`、`poker-bot.task.ts` 与测试；修改 action/lifecycle/module。
**Interfaces:** `chooseBotAction(input: BotDecisionInput, random: number)` → `{action,to?}`；`PokerActionService.actBot(code, expected:{handId,actionSeq,seatNo}, now)`；`PokerBotTask.scan(now?)`。

- [x] 纯策略合法动作/金额及公开输入测试、多实例重复调度/过期点/重启/101 房间公平推进测试，运行先 FAIL。
- [x] 共用锁内提交，真人拒绝机器人身份；机器人 source=rules_bot，timeout 仍 check/fold；持久 botActionAt，1 秒节拍、100 房上限、稳定轮转，每房一动作。
- [x] 策略、调度、原行动/超时回归 PASS。

### Task 4: 查询、归档、共享契约及 MCP

**Files:** `shared/src/game.ts`、game-api/controller、poker-read/nudge/archive、game-hall bridge/response schemas、能力清单与 Skill。
**Interfaces:** create/lobby/history/stats mode；bot.add/remove 两项索引及 bridge；room/table/record source/kind/mode，hall session funding；wait waiting 报文不变。

- [x] 先测 points 默认过滤、practice 明确查询、热冷统计/版本手数、机器人 nudge 拒绝、旁观/对手暗牌、22 MCP/20 IPC 与权限，运行先 FAIL。
- [x] 查询按不可变 room mode 过滤热冷数据；详情保留当时 kind/source；旧归档缺字段兼容；更新归档函数完整校验及响应 schema。
- [x] 游戏 server/client 契约专项、API build 与 desktop typecheck PASS。

### Task 5: 桌面可用流程

**Files:** Lobby/LobbyView、Table/Seat/StatusBar/SidePanel、HandRecord/档案、MySessions、game API/hooks 和测试。
**Interfaces:** 仅 UI 房间管理 bot.add/remove，沿用 useGameMutation/账号隔离；不增加真人入座、行动或 wait bridge。

- [x] 创建陪练、标签、房主管理、失败重试复用创建标识、移除 pending、机器人状态无提醒、历史/统计模式切换迟到隔离测试，先 FAIL。
- [x] 复用组件与固定牌桌样式，统一顶栏不变；创建标识包含 mode，解散练习不承诺退点。
- [x] 游戏桌面专项、typecheck/hard-constraints PASS。

### Task 6: 全面验证与本地交付

**Files:** 模块约束、能力表、系统 Skill、Agent 指南、RELEASE_NOTES_PENDING、本计划验证记录。

- [x] 专用库连续多手、机器人增删/重连/超时/归档资金隔离验证；真实 AI/应用不启动时如实记未验证。
- [x] server test/build:api；desktop typecheck/check:hard-constraints/test。无关既有失败保留日志、不放宽断言。
- [x] 一位独立只读审阅者复核资金、权限、调度和可用性，重要发现先补红测再修复。
- [x] diff/check、仅暂存本次文件、本地中文提交，记录短哈希，不 push。

## 执行记录

- 2026-10-30：设计已确认；在当前会话原地实施，沿用用户“不另建分支、必要验证后本地提交、不 push”的授权。详细执行证据随阶段更新。
- Task 1–5: complete，细项红绿及风险回归见`2026-10-30-poker-practice-bots-validation.md`。
- Ruling：摘要保存mode取代仅靠Room join，防止旧独立累计汇总被过滤；增加第二份增量迁移，未改原10001手断言。
- Final review: 独立只读审阅发现通用Hall并发退款回归，实库同步屏障先红后绿；补手中离桌/解散/超时、真人/机器人输光与101坏房轮转。服务端最终197文件2273项通过，桌面1142文件11647项通过/2跳过，types/hard/IPC/API构建通过。
- Final: minor (deferred): 待解散时添加机器人按钮未细化禁用状态，服务端明确拒绝；无资金/权限绕过。
- Final: Ruling：真实AI/桌面实机未重新执行，不冒称通过；版本计数依赖Room模式保留，未来若新增物理删房必须同步迁移查询。
