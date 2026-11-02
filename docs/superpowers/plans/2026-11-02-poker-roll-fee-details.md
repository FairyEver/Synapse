# Roll 费用来源与去向实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户确认的800px费用原型接入真实牌桌，点击Roll费用后查看本手来源、去向及逐笔分配。

**Architecture:** 基于当前手牌引擎的成功start历史、不可变参赛者快照及已有归档生成只读公开投影。table.state/room.get追加可选rollLedger；不增加工具、接口、查询或数据库字段。客户端聚合该投影，使用标准HeroUI Modal展示并筛选。

**Tech Stack:** TypeScript、React 19、HeroUI 3.2.7、Zod、Vitest。

**Spec:** 用户批准的 `docs/prototypes/2026-11-02-roll-fee.html`；玩法和资金边界以 `docs/superpowers/specs/2026-11-01-poker-roll-rules-design.md` 为准。

## Global Constraints

- 当前仓库main原地开发；不切分支、不建worktree、不增加依赖、不push、不部署。
- 不启动应用、浏览器、开发服务器或Playwright；真实展开视觉验收未获授权，交付时如实注明。
- 游戏内容不进入任何发布说明。
- 费用全额分配给扣费时的其他合资格参与者，本手结束释放；后续弃牌不撤回归属。取消的练习手不得标为已到账。
- 不公开账号ID、admissionId、旧牌、候选牌、cardIndex、persona或note；姓名/座位/弃牌状态取本手快照，不能错归给同座新玩家。
- 旧响应缺rollLedger显示暂不可用；已知空账本显示暂无费用，不用玩家累计或截断事件列表反推明细。

## Review Focus

- 超级start后choose/重抽不重复收录；热数据与归档均使用唯一Roll记录，按真实顺序展示。
- 接收者弃牌或离桌不抹除记录，同座新玩家不继承归属。
- 当前手、账号、房间、视角改变后关闭旧明细；实时更新保留有效筛选，消失的筛选清除。
- 结算后仍展示累计费用，明确待结算/已结算/已取消，不能把动画中的费用堆当作账本。
- 320px窄屏及长姓名/大整数不引起最小列宽溢出；关闭、Escape和面板互斥沿用原有语义。

## 共享接口

`PokerRollLedgerPlayer = { key: string; seatNo: number; displayName: string; isMe: boolean; folded: boolean }`。

`PokerRollLedgerEntry = { id: string; payerKey: string; kind: PokerRollKind; street: "preflop" | "flop" | "turn"; fee: number; compensations: { key: string; amount: number }[] }`。

`PokerRollLedger = { handId: string; status: "pending" | "released" | "cancelled"; players: PokerRollLedgerPlayer[]; entries: PokerRollLedgerEntry[] }`，挂载到`PokerTableView.rollLedger?`。key为房间作用域身份散列；entries每个成功start一条，保留账本顺序，不含choose。来源/去向聚合均从entries计算。

### Task 1：真实公开账本投影与协议

**Files:** `shared/src/game.ts`、`shared/src/game-poker-response-schemas.ts`、`shared/src/game-roll-ledger.test.ts`、`server/src/game/poker/poker-roll-ledger.ts`、`server/src/game/poker/__tests__/roll-ledger.spec.ts`、`server/src/game/poker/poker-action.service.ts`。

- [x] 先写契约和投影失败测试：40/120/63/180合计403，补偿守恒、历史身份、顺序、去重、归档、取消、旧响应与私密字段拒绝。
- [x] 实现最小公开投影并接入现有table snapshot，复用已读的history/participants/archived.rolls，严格白名单。
- [x] 运行shared专项、server Roll相关测试和类型检查，记录结果。

### Task 2：800px费用弹窗与牌桌入口

**Files:** `dashboard/src/game-center/games/poker/lib/roll-ledger.ts`、`components/PokerRollFeeDialog.tsx`、`components/Table.tsx`、`styles/chips.css`及`__tests__/roll-fee*.test.*`。

- [x] 先写失败测试：来源/去向403、筛选逐笔金额、弃牌保留补偿、缺失/空账本、状态标签及只读入口。
- [x] 将聚合与筛选逻辑放lib；标准HeroUI Modal保留Header/Body/Footer、默认留白、正文滚动，Dialog最大宽800px，窄屏单列。
- [x] Roll费用标签/金额/筹码组成语义button，保持现有画布几何和动画锚点；接入父级panel互斥、上下文关闭与焦点恢复。
- [x] 验证实时更新、同座换人和取消状态；长姓名/大金额保留换行约束并完成静态审查，真实视觉尚未执行。不新增请求或实际资金动作。

### Task 3：同步说明与完成验证

**Files:** `docs/agents/game-ui.md`、`docs/agents/capability-registry.md`、系统Skill的`game-hall/poker/SKILL.md`及`game-hall/references/{api,protocol}.md`。

- [x] 同步rollLedger公开字段及只读语义，注册数量不变，不改发布说明。
- [x] 运行Dashboard相关测试、tsc、check:ui，shared与server相关验证；静态审查差异，不声称浏览器视觉已通过。
- [x] 独立审查后修复实质问题，只暂存本任务文件，中文本地提交，不push。

## 实际验证与交付边界

- Dashboard完整158文件、1302测试通过；本次模型/弹窗/牌桌专项12测试通过，覆盖实时筛选、缺源/空记录、点数/筹码、上下文关闭、Escape和焦点返回。完整日志：`/tmp/synapse-roll-fee-dashboard-tests.log`，尚无在线链接。
- Server完整208文件通过、28跳过；2415测试通过、156跳过。账本专项8测试通过，Roll筛选411测试通过、9跳过。完整日志：`/tmp/synapse-roll-ledger-server-test.log`，尚无在线链接。
- Shared账本契约21测试通过；完整包321通过、1项既有失败：`src/package-entrypoint.test.ts`的`loads the ESM root without Node CommonJS interoperability`仍期望不含`game-poker`的通知来源列表。已核对HEAD原先已注册该来源，本任务未修改来源或该测试，不将完整共享包声称为全绿。
- Shared构建、Server typecheck、Dashboard tsc及check:ui通过。独立只读代码审查未发现实质P1/P2；已核对HeroUI安装版的Dialog尺寸、分区和滚动实现。
- 未启动应用、浏览器或Playwright，桌面/320px真实展开几何、长内容视觉、原生焦点锁和真实筹码动画未验收。服务回归使用真实引擎和内存store，未访问或改写业务数据库；无迁移、push或部署。
- 回滚只需撤回本次代码；未改变已有收费、补偿或存储语义。新Web连接旧API时明细缺失显示暂不可用。
