# 筹码堆与派发呈现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认筹码原型接入真实牌桌，保持资金与协议语义准确。
**Architecture:** 服务端只读投影精确逐笔面额计数和最近资金动作；共享纯函数实现面额与簇状布局。Renderer 以权威快照驱动可取消的展示批次，真实动画完成回调驱动结算屏障，系统结算组件保持 HeroUI。
**Tech Stack:** TypeScript、React 19、HeroUI 3.2.7、CSS/WAAPI、现有 Vitest。
**Spec:** `docs/superpowers/specs/2026-11-02-poker-chip-presentation-design.md`

## Global Constraints

- 当前 main 原地开发，不新增依赖、不更改资金规则或数据库，不 push/部署。
- 相同面额连续分组；按每笔下注拆分；普通与Roll隔离；实际服务端派彩。
- 游戏内容不进入发布说明；响应扩展同步schema、描述和指南。

## Review Focus

- 最近动作截断或重连不能把累计额重新换成大面额。
- Roll choose 不能重复收费；座位重用和历史座位不能串入资金。
- 轮询与新动作不能撤销未完成派发，旧手回调不能打开新手结算。
- 结算首次挂载和减少动态效果不能死锁结算屏障。
- 大量小筹码与窄屏保持可读且限制DOM。

### Task 1: 精确筹码数据与布局

Files: shared/src/game.ts、game-poker-response-schemas.ts、新增 game-poker-chips.ts；server/src/game/poker/poker-chip-projection.ts、poker-action.service.ts；配套shared/server测试。
Interfaces: PokerChipState {pot,roll,recent}；每堆面额计数；recent含公开seq/seatNo/amount/fund/id。
- [x] 写失败测试：501 vs五笔100、短盲注、超过30条分页、Roll start只记一次、同色簇状布局、数量限制。
- [x] 运行失败测试，新增共享纯函数与只读分页投影，接入桌面响应与schema，运行通过。

### Task 2: 筹码与滚动数字组件

Files: Dashboard新增 PokerChip/PokerChipPile/RollingAmount、chips.css；Seat.tsx、Table.tsx和配套测试。
Interfaces: 面额计数渲染同色分组；数字动画可取消并支持减少动态效果；座位筹码和双底池有真实DOM锚点。
- [x] 写失败测试：真实剩余金额、双底池独立、连续更新/进位/重置/无动画模式。
- [x] 实现共享视觉与三场景样式，不改变业务动作和系统组件，运行通过。

### Task 3: 权威事件、派发与结算屏障

Files: lib/table-motion.ts、hooks/useTableMotion.ts、新增筹码呈现helper/hook、ChipMotion.tsx、SettlementPanel.tsx、Table.tsx；配套测试。
Interfaces: 动画单元按fund和value持有幂等ID；真实完成回调释放余额、底池与结算屏障。
- [x] 写失败测试：直接入池、Roll分离、真实shares及补偿、快速追加不丢批次、首次/重连不回放、派发完成前不弹窗、换手/身份/布局取消。
- [x] 实现可取消动画批次与显示状态，替换旧collect路径；运行通过。

### Task 4: 联合验证、文档与交付

- [x] 运行 dashboard 全套测试、shared/server专项和typecheck、Dashboard UI边界与构建。
- [x] 按仓库授权只用固定数据和已允许的测试方式验证；不擅自启动应用/服务或浏览器。视觉不能实际验证时明确记录。
- [x] 更新游戏规则/Agent指南/系统Skill与能力清单说明（数量不变）；不更新游戏发布说明。
- [x] 最终独立代码审查，必要修复与验证；本地只提交本任务文件，报告提交和未验证范围。

## 执行记录

- 用户已逐项确认原型并明确要求实现，直接在当前对话执行，不重复申请设计批准。
- 初始工作区干净；采用当前main，用户规则优先于Skill默认worktree流程。
- 保留既有useTableMotion的行动/轮次/庆祝反馈，真实资金动画改由独立筹码展示状态管理；旧collect不再渲染，没有扩大重构。
- 共享模块同时生成ESM及CJS；Node实际加载CJS入口验证501拆分及求和成功。
- 最终独立审查发现两项并完成失败测试到通过的修复：同手座位重用取消旧派发并恢复权威余额；隐藏/恢复与断流通过动画generation同步取消数字和筹码，避免结算屏障提前放行。定向3文件11用例通过，无遗留Critical/Important或Minor。
- 本次未启动应用、服务器或浏览器，实际宽窄屏满座视觉未验收；jsdom验证真实Table的普通派发、Roll派发、数字完成与结算屏障。服务端环境依赖集成测试保持跳过，不计为通过；未执行数据库迁移、部署或推送。
- 最终验证：Dashboard 153文件/1254用例通过；服务端扑克25文件/180用例通过、25文件/139用例环境跳过；共享筹码4用例通过；Dashboard build（含shared build、check:ui、tsc）、server tsc、真实CJS加载与git diff --check通过。构建保留既有大分块提示。
