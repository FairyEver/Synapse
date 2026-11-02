# Roll 玩家信息与决策界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击玩家区域查看个人/全桌换牌统计，普通与超级换牌阶段均可对照公共牌。

**Architecture:** 复用table.state/room.get返回公开汇总；服务端合并热/冷Roll记录、按唯一ID去重和账号聚合，仅投影桌上座位。Dashboard复用父面板互斥和现有牌面，新增按需玩家信息Modal，不增加HUD或网络入口。

**Tech Stack:** TypeScript、PostgreSQL/Prisma、NestJS、React 19、HeroUI v3、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-02-poker-roll-visibility-design.md`

## Global Constraints

- 当前main原地开发；不新增依赖、不操作业务数据库、不部署、不push。
- 游戏内容不进入发布说明；同步相关规则、MCP描述/schema和权威Skill。
- 已授权无头Chromium固定数据验收；保留控制/资金/倒计时和现有三场景contain。

## Review Focus

- start/choose与热冷存储不会重复计数。
- 同名、重进和同座位换人不串账，公开统计不含私牌。
- 空房、旧响应、长名字和大金额不伪造零或裁切。
- 玩家切换/账号切换/房间切换后不显示旧信息。
- 点击玩家区域和关闭弹窗不影响画布、正常出牌或控制权。

### Task 1: 服务端和共享统计契约

**Files:** shared游戏类型/响应schema，`poker-roll-stats.ts`、`poker-action.service.ts`，专项/临时离线SQL测试。

- [x] 建立失败回归后实现公开汇总；最终按最新方案移除分页和额外输入参数。
- [x] 临时离线PostgreSQL真实执行热冷去重、身份、choose和当前座位限定；不连业务库。
- [x] 完成最终类型检查与游戏服务回归。

### Task 2: 玩家信息和换牌界面

**Files:** `Table.tsx`、`Seat.tsx`、`PokerPlayerInfoDialog.tsx`、`PokerRollDialog.tsx`、座位聚焦样式，UI单元/浏览器测试。

- [x] 用户后续取消常驻摘要，撤除相关组件、分页hook和场景几何修改。
- [x] 建立点击玩家查看个人/全桌统计、旧响应/换人/切账号、公共牌回归并实现。
- [x] 最新9项固定数据Chromium通过，覆盖390×667/844、850×700、1280×800和长内容。
- [x] 完成最终构建与专项/集成回归。

### Task 3: 同步、复核、交付

- [x] 同步游戏规则、边界、能力注册说明与权威Skill，保持注册数量不变。
- [x] 独立只读审查最终实现；修复目标恢复时旧信息弹窗自动重开的焦点问题，新增回归RED→GREEN。
- [x] diff聚焦、验证结果入档，仅本地中文提交本任务文件。

## 执行记录

- 用户确认原方案后授权直接实现，并允许无头Chromium；之后明确改为按需玩家信息，原常驻方案撤销。
- 临时离线SQL测试通过，无业务库读写、迁移、部署或push。
- 初版常驻布局9项通过后撤销；最终玩家信息布局重新运行9项全部通过，不能混用初版证据。
- 独立后端审查未发现重要缺陷；超大房间的历史聚合性能尚无长期量级测试，不据此宣称性能已验收。最终UI审查已返回，无未处理的重要问题。

## 最终验证

- `pnpm --filter @synapse/server exec vitest run src/game --maxWorkers=2`：235通过、146按既有环境条件跳过，不声称真实业务库/全套数据库验收。
- `GAME_ROLL_STATS_SQL_TEST=1 pnpm --filter @synapse/server exec vitest run src/game/poker/__tests__/roll-stats.spec.ts src/game/poker/__tests__/roll-stats-sql.spec.ts src/game/poker/__tests__/roll-boundaries.spec.ts`：23通过，含临时单用户PostgreSQL真实聚合SQL。
- `pnpm --filter @synapse/dashboard exec vitest run src/game-center/games/poker --maxWorkers=2`：最终260通过。已有牌型说明的焦点测试将focus调用纳入act并等待双rAF，保持原断言；不是移除或放宽焦点要求。
- `pnpm --filter @synapse/dashboard test:browser src/game-center/games/poker/__tests__/roll-visibility.browser.tsx`：最终9通过，实际检查点击玩家/个人与全桌统计、Escape焦点返回、公共牌/空槽、普通/超级、长姓名/大额、底栏和contain画布稳定。
- 共享Roll契约专项5通过；server typecheck通过；Dashboard build（含typecheck/check:ui）通过。此前误跑共享全量时出现原有package-entrypoint对game-poker通知类别的预期不一致，未修改该无关断言，不声称共享全量通过。
- 初次并发运行服务端随机1000手样本因CPU争用触发5秒测试超时；限制worker后235项全绿，未修改引擎/超时断言。
- 独立审查指出座位消失后仅隐藏弹窗可能导致原玩家返回时自动重开；按焦点影响处理为重要问题，新增「目标离开再回到同座位不会自动重开信息或抢焦点」先失败，再清理panel/inspected，最终260项回归通过。

截图目录：`/Users/liyang/Documents/code/github/Synapse/dashboard/src/game-center/games/poker/__tests__/.superpowers/sdd/2026-11-02-poker-roll-visibility/`，本地文件，无在线链接。主要截图为`390-667-table.png`、`390-667-stats.png`、`390-667-roll.png`、`390-667-super.png`、`390-667-player-long.png`及对应宽屏文件。生成的失败截图不作为最终证据。

最终行为以用户后续要求为准：无常驻统计，点击每位玩家查看；撤销了初版HUD、分页hook、额外工具参数、公共历史字段与场景几何调整。仅保留当前任务所需代码及指南，不提交并行筹码原型/容量功能的改动。不部署、不push，不操作业务数据库；统计超长历史量尚未压测。
