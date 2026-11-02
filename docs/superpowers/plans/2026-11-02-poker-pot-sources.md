# 底池来源面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** 用户要求点击既有底池标题/金额/筹码堆，打开面板展示本手底池筹码来源分布。

**Architecture:** 复用原Roll费用入口/面板的父级互斥、800px HeroUI Modal、上下文关闭和焦点返回。公开可选potContributions从已有本手引擎total或完整归档动作及实际盲注生成，不依赖最近30条动作、当前座位余额或Roll记录反推。

**Tech Stack:** React、HeroUI 3.2.7、TypeScript、Zod、Vitest。

**Spec:** 本对话2026-11-02用户截图与“池底筹码的来源分布”要求；`docs/superpowers/specs/2026-11-02-poker-chip-presentation-design.md`。

## Global Constraints

- 当前main原地，不新增依赖、分支/worktree、迁移、查询或工具，不push/部署，不启动应用/浏览器。
- 原有筹码几何、金额滚动、飞行锚点及结算屏障不变；所有面板仅查询。
- 含盲注、跟注/下注/加注等实际累计投入，已弃牌不撤回，Roll费用独立不混入。
- 结算/取消时标明本手累计投入，不声称这些钱仍在池中或仍可下注；缺投影不伪造零。
- 姓名与身份只来自本手参与者快照，不公开userId/admissionId/牌面/私密note。游戏内容不写发布说明。

## 共享接口

`PokerPotContributions = { handId: string; status: "pending" | "settled" | "cancelled"; total: number; players: { key: string; seatNo: number; displayName: string; isMe: boolean; folded: boolean; amount: number }[] }`；`PokerTableView.potContributions?`。

## Review Focus

超过30条下注不丢来源；短筹码盲注金额准确；弃牌和同座换人归属不变；Roll不混入；热/冷及结算/取消口径一致。测试覆盖这些行为，视觉/真实焦点锁因无浏览器授权仅保留验收限制。

### Task 1：服务端与契约

- [x] 在shared/server新增失败测试：来源金额守恒、盲注、长历史、私密字段拒绝、归档/身份/取消及旧响应兼容。
- [x] 实现`server/src/game/poker/poker-pot-contributions.ts`并接入`poker-action.service.ts`；扩展`shared/src/game.ts`及响应schema。
- [x] 同步既有MCP描述、系统Skill/API/protocol及capability-registry；数量不变。运行专项、shared build和server类型检查。

### Task 2：底池入口与面板

- [x] 先写失败测试，再新增`PokerPotSourcesDialog.tsx`及`lib/pot-sources.ts`，来源按金额显示占比，零/缺失/状态明确。
- [x] Table底池区域使用语义button，保留动画锚点，与Roll/日志/玩家等面板互斥；换手/房间/账号/视角关闭，关闭/Escape返回焦点。
- [x] 同步game-ui；运行Dashboard相关/完整测试、tsc、check:ui及独立只读审查。
- [x] 检查diff，只暂存本任务文件并中文本地提交。未执行的浏览器或业务库验收如实记录。

## 实际验证

- Dashboard新增9项测试及相邻Roll/动画回归共17项通过。完整160文件/1311项中1310通过，云盘历史`keeps previously loaded version rows after multiple history pages`超时，未修改该测试；独立复跑对应文件14/14通过。日志：`/tmp/synapse-pot-sources-dashboard-test.log`、`/tmp/synapse-pot-sources-dashboard-retry.log`。
- Server新增来源8项通过，最终扑克目录回归231通过、149跳过。全量2579项中2421通过、156跳过，`DriveService`的1000文件准备及`short-allin`的1000手随机测试超时；两文件独立复跑177/177通过，未修改无关测试或超时阈值。日志：`/tmp/synapse-pot-sources-server-full.log`、`/tmp/synapse-pot-sources-server-retry.log`、`/tmp/synapse-pot-sources-server-poker.log`。
- Shared新增来源6项及相邻账本/统计共28项通过；全量327通过、1个既有失败：`package-entrypoint.test.ts`通知来源期望缺`game-poker`。不声称全量全绿。日志：`/tmp/synapse-pot-sources-shared-focused.log`、`/tmp/synapse-pot-sources-shared-full.log`。
- Shared build、Server类型、Dashboard tsc和check:ui、diff空白检查通过。独立只读审查未发现实质P1/P2，无需调整全局DESIGN。
- 上述日志均仅本地、暂无在线链接。未启动应用/浏览器/Playwright；实际展开视觉、窄屏几何及原生焦点锁未验收。服务测试使用隔离内存store和真实引擎，未访问业务库、执行迁移、部署或push。
- 可撤回本次代码回滚；无存储或资金变更。新Web连接旧API时来源缺失显示暂不可用，不能从最近动作或当前余额补造。
