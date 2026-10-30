# 德州扑克真人参与与短牌实施计划

> **For agentic workers:** Use superpowers:executing-plans；按文件所有权并行独立任务，集成后统一审阅和本地提交。

**Goal:** 实现用户批准的真人/AI 接管、32 张短牌、观战权限、沉浸牌桌和上下文维护。
**Architecture:** 服务端统一房锁与规则引擎裁决，入口决定调用来源。桌面经窄 bridge 操作；私密和教学投影分离。
**Tech Stack:** NestJS、Prisma/Postgres、Electron、React、TypeScript、现有 shadcn；不新增依赖。
**Spec:** `docs/superpowers/specs/2026-10-30-poker-human-short-deck-design.md`

## Global Constraints

- 当前 main、当前目录开发；不新分支或 worktree，不部署，不迁移业务库。
- 600 秒行动、30 分钟暂离清退、点数/陪练隔离不放宽。
- 不启动应用或浏览器；测试先红后绿，不伪报未运行的检查。

## Review Focus

- 旧 AI 在真人接管后所有座位写入口均失效。
- 原动作已提交但响应丢失，切换后重试不重复扣筹码。
- 教学明牌不能进入 MCP 决策投影或泄漏其他人的私密配置。
- 结算间隔不依赖客户端、服务重启后仍推进且不饿死其它房间。
- 私有恢复检查点不会撤销用户暂停、离桌或接管。

## Tasks

- [x] 1. 引擎：规则/盲注回归测试先失败；实现32张判型与规则快照；测试守恒和十人发牌。
- [x] 2. 服务端：控制权/权限测试先失败；实现版本校验、座位控制、私有检查点、入口来源和观战事件投影。
- [x] 3. 生命周期：结算5秒测试先失败；持久 nextHandAt、有界调度、历史规则及冷热兼容。
- [x] 4. Bridge/Skill：契约测试先失败；同步 schema/路由/preload、控制退出和上下文恢复协议、规则及能力表。
- [x] 5. Renderer：真人动作和投影/去重/缩放测试先失败；实现建房规则、同座接管、沉浸画布、结算与动画。
- [x] 6. 集成：server/desktop 专项与 typecheck、架构约束、全套适当验证；审阅修复，更新发布说明，仅提交本任务变更。

## 执行记录

- 初始工作区干净。按用户明确授权在 main 实施，优先于 skill 的 worktree 默认流程。
- 引擎、Renderer、契约/Skill 按互不重叠文件边界并行，根 Agent 负责服务端和集成。最终统一提交。
- 审阅修复：维护覆盖用户暂停、删除座位后旧 AI 重扣点、非 1/2 盲注统计错误、旧 MCP 替真人续心跳均已先复现再修复；根专项 10 项通过，包含热/冷统计和归档规则保留。
- Ruling: 使用永久扑克控制历史而非扩展大厅 GameSession 的业务字段，保持大厅边界；首次无历史 MCP 入座兼容，已有历史重新入座须桌面明确授权。
- Ruling: 同一房间锁内检查暂停原因和待离桌状态，维护不能把 user 意图改成 context_maintenance；不改变原重复暂离心跳与 30 分钟清退规则。
- Ruling: 实时事件仅最近两手/两分钟，过旧游标直接恢复最新状态，避免新增他人历史权限；MCP 决策与桌面教学视角分开。
- 服务端最终全套 `GAME_E2E_DATABASE_URL=<本机专用_e2e库> pnpm --filter @synapse/server test --maxWorkers=2`：204 文件、2326 测试通过。仅临时测试 Postgres 127.0.0.1:54329/synapse_poker_human_e2e，未触及业务库。
- 服务端生产代码 `tsc -p tsconfig.build.json --noEmit` 通过。全量 typecheck 仍有仓库原有 `server/src/notifications/notification.service.spec.ts:274` TS2493；该文件未修改。
- 桌面完整 typecheck 与架构硬约束通过。最终桌面全套 `pnpm --filter @synapse/desktop run test --maxWorkers=4`：1145 文件、11685 测试通过，原有两项 native 环境测试跳过；无失败或未处理错误。之前全套识别的能力数量/中文词典遗漏已修，动态导入与超时问题在无并发构建条件下未再出现。
- 未启动应用或浏览器，真实视觉验收和外部客户端跨压缩运行未执行；协议、状态机和布局数学已有自动化验证。本次无部署、业务库迁移或 push。
- 本机日志目录：`/tmp/synapse-poker-implementation-logs/`，尚无在线链接。
