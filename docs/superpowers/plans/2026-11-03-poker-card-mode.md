# 德州扑克卡牌模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现可与Roll共存的卡牌模式、60种90张初始卡池、生命周期效果与通用暂存，完成真人界面、GPT封面和可追溯验证。

**Architecture:** 在现有房间事务、快照和回执中组合类型化生命周期、领域操作和声明式卡牌。筹码域独立处理有限豁免、名义下注、真实底池与暂存；卡牌和Roll通过领域操作接入。旧房间按原资金版本完成，新功能在完整验证前不开放创建。

**Tech Stack:** TypeScript、NestJS、Prisma/PostgreSQL、React 19、HeroUI 3.2.7、Tailwind 4、Vitest；使用现有pnpm工作区，不新增依赖。

**Spec:** [已确认设计](../specs/2026-11-03-poker-card-mode-design.md)，用户2026-11-03明确“确认设计，进入实施计划”。实现者必须同时阅读设计和计划。

**实施状态：**18项实施与自测已完成；最终独立审查的两项重要问题已补回归并修复，结果及一项延后小项见[验收记录](../acceptance/2026-11-03-poker-card-mode.md)。未推送、部署或开启生产卡牌创建。

## Global Constraints

- 仓库 `/Users/liyang/Documents/code/github/Synapse`，当前 `main`；未经另行允许不新建/切换分支、不使用其他worktree或副本。
- 本文所有路径以该仓库为根；Create均为计划新增，Modify均在编写计划时只读核实。复选框现记录已实际完成的步骤，最终验证以验收记录为准。
- 初始60种90张，30种单份、30种双份；`copies`未声明默认1。仅系统代码配置，房主只开关卡牌模式。
- 每局真人初始3张，翻牌/转牌/河牌仍可行动的真人各补1张；机器人零发放/零用牌；结算清空。共享池有限、抽取不放回，显式生成新实例。
- 本人回合内可连续用牌；初始600秒，回合开始后1200秒绝对上限；待选不续时，超时第一候选。128派生操作、32层因果、1024牌实例、每人64持续状态。
- 卡牌房当前拒绝外部AI参赛，MCP只读仅公开视角；新用牌/选择只有两项私有Web操作，不新增卡牌MCP工具。
- 名义下注与实付分开；底池和暂存只接收实付。暂存按来源/原入座记账，盗取不取自己份额，取回不补已取走的资金。
- 52/32张扑克牌的实体守恒、牌型规则、控制版本、幂等和私牌权限保持。全下可受卡牌影响但不重新获得本局主动行动点。
- HeroUI系统面板与局内卡面分层，保留850px边界、三场景缩放、焦点与面板互斥。60张封面全部通过GPT生图完成，不能以占位图交付。
- 不启动应用/浏览器/Playwright，不操作任何数据库，不部署、不运行远程CI、不push，除非后续得到明确授权。纯函数/Node/jsdom检查不依赖运行应用。
- 每个完成的可验收代码任务单独本地中文提交，只暂存该任务文件。游戏内容不写入任何发布说明或发布通知。

## Review Focus

1. **旧房/旧客户端遇新规则**：旧局的确权补偿不被重写；不识别版本的客户端不能继续操作新局。由T1/T9/T12固定回归。
2. **响应丢失后跨账号或硬刷新**：同UUID只执行一次，不泄露旧账号候选、不重抽或重复扣款。由T11/T14固定回归。
3. **名义全下、真实边池、离座待分叠加**：资金和原入座归属始终可核对，零实付不造钱。由T4/T5/T9/T17固定回归。
4. **时钟与交互候选相遇**：锁内重验期限，延时不改回合起点，净化不复活超时回合，待选禁止所有其他主动卡。由T7/T11/T14固定回归。
5. **公开标记移动和驱散**：标记跟随实体牌，历史知识不可撤回，public/MCP/缓存不残留私有牌面。由T6/T7/T10/T15固定回归。

---

## 文件责任与实施顺序

这是一个共享事务和快照的产品交付，不拆成彼此独立的产品。按下表顺序开发，未完成T18前保持新建卡牌房关闭；纯底座、账本、协议等里程碑可以各自验证。

| 范围 | 文件及单一责任 | 任务 |
| --- | --- | --- |
| 共享契约 | 新增 `shared/src/game-poker-cards.ts`、`game-reserve.ts`、`game-poker-card-schemas.ts`；由现有game/game-ui导出 | T1 |
| 注册与执行 | 新增 `server/src/game/poker/engine/cards/{types,registry,runner}.ts` | T2 |
| 能力牌区域 | 新增 `engine/cards/pool.ts`，负责实例、保留区、抽取/生成/消耗 | T3 |
| 支付与边池 | 新增 `engine/chips/{types,payment,funded-pots,funded-betting}.ts` | T4 |
| 暂存纯模型 | 新增 `engine/chips/reserve.ts`，独立于卡牌ID与Roll | T5 |
| 扑克牌操作 | 新增 `engine/cards/poker-operations.ts`，唯一牌组、候选和可见标记 | T6 |
| 状态与时钟 | 新增 `engine/cards/{statuses,deadlines}.ts` | T7 |
| 60张定义 | 新增 `engine/cards/catalog-v1.ts`、`commands.ts` 和 `catalog/{holes,information,draw,reserve,defense,table}.ts` | T8 |
| 通用持久账本 | 新增 `server/src/game/hall/game-reserve.service.ts`、Prisma模型及迁移 | T9 |
| 授权投影/归档 | 新增 `poker-card-projection.ts`、`poker-reserve-projection.ts`，扩展现有读取/归档 | T10 |
| 牌局协调 | 新增 `engine/{hand-transitions,resolve-hand}.ts`、`poker-card.service.ts`，接入既有行动/Roll/保存 | T11 |
| 私有Web/模式保护 | 新增 `poker-mode-policy.ts`，修改game controller/DI/共享路由 | T12 |
| 房规与接入UI | 修改建房、偏好、房间摘要和AI入口 | T13 |
| 用牌UI与恢复 | 新增 `usePokerCards.ts`、`card-intent-store.ts`、`PokerCardsDialog.tsx`及选择视图 | T14 |
| 资金/效果表现 | 新增暂存明细与状态显示，修改筹码动画/对局信息 | T15 |
| GPT正式素材 | 新增60张 `assets/ability-cards/v1/01.png`至`60.png`及manifest/核对脚本 | T16 |
| 数据库与组合验证 | 新增隔离库runner、端到端组合/版本迁移和模拟报告 | T17 |
| 完整验收/收尾 | 授权后视觉验收、规则/Skill/注册表核对、完成证据 | T18 |

上表`engine/`相对`server/src/game/poker/`，UI文件相对`dashboard/src/game-center/games/poker/`。后面Files给出完整仓库路径，禁止据此改到另一份仓库。

## 固定接口约定

以下是本计划选择的新接口名，不是现有API。结构字段由拥有任务按设计定义，后续任务不得另起同义接口；类型全程严格校验，不用`any`连接相邻任务。

- T1：共享 `PokerCardPlayInput` / `PokerCardChooseInput` / `PokerCardResult` / `PokerCardView` / `PokerReserveView`。请求固定绑定roomCode、handId、street、expectedActionSeq、controlVersion、actionId、expectedPaymentVersion；play另含instanceId、selections，choose另含choiceId、candidateIndex。`selections`只允许底牌槽、座位、本人能力牌实例、可见状态、颜色猜测等已注册选择值，不能传效果定义/代码。
- T1：新增`POKER_CARD_PLAY_SCHEMA`/`POKER_CARD_CHOOSE_SCHEMA`两份strict JSON Schema，导出于game-ui；choose的expectedPaymentVersion引用开始时保存在选择中的值，不重新报价/收费。既有下注和Roll开始请求增加可选expectedPaymentVersion，卡牌房付款时必填，普通房保持旧请求兼容。
- T1：共享头常量`GAME_POKER_RULES_HEADER="x-synapse-poker-rules"`、`SUPPORTED_POKER_RULES=["cards-v1","chips-v2"]`；卡牌房Web写入须声明支持这两版。此头只用于兼容判断，不是身份或human凭证；普通无卡房的MCP不因缺此头被拒绝。
- T1：稳定错误码为`POKER_CARD_MODE_UNAVAILABLE`、`POKER_CARD_AI_DISABLED`、`POKER_CARD_VERSION_UNSUPPORTED`、`POKER_CARD_CHOICE_REQUIRED`、`POKER_CARD_PRICE_CHANGED`、`POKER_CARD_BUDGET_EXCEEDED`、`POKER_CARD_INVALID_SELECTION`；已有过期行动/控制权错误沿用原码。预算/模式拒绝不可被前端当成写结果未知而盲重发。
- T1：通用`GameReserveLot`/`GameReserveClaim`字段使用`originalAmount`、`remainingAmount`，Claim另含原admissionId/userId和pending/finalized状态；Movement记录来源/去向/金额，不与公开opaque key混用。T5纯模型与T9持久化共享这些结构，Hall不能导入扑克HandState。
- T1：`PokerRuleOptions.cards?: boolean`；房规新增 `cardRulesVersion?: "cards-v1"`、`chipRulesVersion?: "chips-v2"`。老房无版本即legacy，不从当前开关推断旧局语义。TableView新增可选`cards`/`reserve`，新字段不使旧响应失效。
- T2：`ResolutionContext={handId:string;actionSeq:number;rootActionId:string;actorSeatNo:number|null;actorAdmissionId:string|null;source:"human"|"rules_bot"|"timeout"|"system";nowMs:number;randomInt:(max:number)=>number;nextId:()=>string}`；`CardDefinition`、`CardRegistry`、`OperationRegistry<S>`、`LifecycleEvent`、`EffectInstance`、`ResolutionFrame`、`DomainOperation`、`PendingChoice`在`cards/types.ts`定义。`runResolution<S>(state:S, operations:readonly DomainOperation[], context:ResolutionContext, registry:OperationRegistry<S>):ResolutionResult<S>`的结果字段为state、frame、可选reserveBatch/pending；支付事实包含在frame中。`HandResolution=ResolutionResult<HandState>`。随机数和新ID只从context取得，预演两者都不能消费；服务端注入crypto，测试注入固定序列。
- T3：`createCardPool(defs:readonly CardDefinition[], context:ResolutionContext):CardModeState`；`applyCardPoolOperation(state:CardModeState, operation:CardPoolOperation, context:ResolutionContext):CardPoolResult`。`CardModeState`包含区域、已生成量、已补牌阶段和持续状态引用，`CardPoolResult`包含新state、实际抽取/生成及私有候选。
- T4：`quoteChipPayment(input:ChipPaymentInput, modifiers:readonly ChipPaymentModifier[]):ChipPaymentQuote`；`splitFundedPots(seats:readonly FundedSeat[], order:readonly number[]):FundedPot[]`；`applyFundedBet(state:HandState,seatNo:number,decision:Decision,quote:ChipPaymentQuote):HandState`。`FundedSeat`含seatNo、nominalTotal、paidTotal、folded；现有`total`保留真实投入，`streetBet`匹配名义。Quote含nominalAmount/waivedAmount/paidAmount/consumedModifierIds/version，预演只返回将被消耗的ID，实际提交才消费。
- T5：`applyReserveOperation(state:ReserveState,operation:ReserveOperation,order:readonly number[]):ReserveResult`；操作种类为deposit/steal/refund/finalize，结果带钱包变更和不可变分录。批次键绑定funding/gameKind/roomId/handId/原admissionId/sourceId。
- T6/T7：`registerPokerCardOperations(registry:OperationRegistry<HandState>):void`、`registerCardStatusOperations(registry:OperationRegistry<HandState>):void`；`applyDeadlineOperation(clock:TurnClock,op:DeadlineOperation,nowMs:number):TurnClock`。`TurnClock`保留startedAt/deadlineAt和已应用时长修正。T2的PendingChoice用kind=poker/ability、origin=roll/card区分候选，保存本人原入座、候选、来源序号和原paymentVersion；T6复用它而不另建并行待选状态。
- T8：`createCardRegistry():CardRegistry`、`CARD_CATALOG_V1:readonly CardDefinition[]`，ID固定`01`至`60`，版本快照包含目录/配方/操作语义及校验摘要。`cards/commands.ts`导出`planCardPlay(state:HandState,input:PokerCardPlayInput,context:ResolutionContext,registry:CardRegistry):readonly DomainOperation[]`和同型`planCardChoice`，编排成员/选择/费用/消耗/效果；T8可直接通过T2运行场景，T11复用这些计划器。
- T9：`GameReserveService.apply(tx:Prisma.TransactionClient,input:GameReserveWriteBatch):Promise<void>`、`finalize(tx:Prisma.TransactionClient,settlementId:string):Promise<readonly PendingTransferInput[]>`、`pending(tx:Prisma.TransactionClient,userId:string):Promise<number>`。T1的game-reserve.ts导出通用Lot/Claim/Movement/WriteBatch，Hall不导入扑克引擎。PendingTransferInput仅type导入现有Hall模块；finalize返回最终转移给协调器，自己不调用HallService。
- T10：`projectCardView(state:HandState,policy:CardViewPolicy):PokerCardView|undefined`、`projectReserveView(input:ReserveProjectionInput):PokerReserveView|undefined`；policy显式包含audience、perspective及已核实的本人身份。
- T11：`nextHandTransition(state:HandState,afterSeat:number):HandTransition`共享原阶段推进判定；`resolveHandCommand(state:HandState,command:HandCommand,context:ResolutionContext,registry:CardRegistry):HandResolution`统一hand.start/bet/roll.start/roll.choose/card.play/card.choose/timeout/participant.leave/hand.cancel。同一根写入只增加一次actionSeq，内部用eventIndex。
- T11：`PokerCardService.play(userId,input,caller="human")`、`choose(userId,input,caller="human")`返回`Promise<PokerCardResult>`；复用`PokerService.withRoom`，不建立第二把房间锁或长事务选择等待。
- T12：`assertPokerModeAccess(room,caller,operation):void`拒绝AI参赛写入；`cardReadPolicy(room,caller,requestedPolicy):CardViewPolicy`将卡牌房MCP降为公开读取。HTTP固定human来源，不能接受客户端caller。

### 通用执行与测试约定

所有任务先添加列出的行为测试并运行确认失败，再实现最小功能并运行同一组确认通过，随后提交。下面“预期通过”是计划的验收标准；实际执行和结果见验收记录。首次测试前单独运行`pnpm --filter @synapse/shared build`；共享源码变化后重新构建，避免引用旧dist。

测试目录固定为`server/src/game/poker/engine/__tests__/`（纯引擎）、`server/src/game/poker/__tests__/`（服务）、`server/src/game/hall/__tests__/`（通用资金）、`shared/src/`、Dashboard模块`__tests__/`。纯函数fixture在新增`server/src/game/poker/__tests__/card-test-fixtures.ts`导出`makeCardHand(options)`和`sequenceRandomInt(values)`，使用真实`startHand`/`orderedDeck`建立有效状态；移牌到手中必须从共享池移走，不造重复实例。

## Task 1: 版本、共享schema与私有操作契约

**Files:** Create `shared/src/game-poker-cards.ts`、`shared/src/game-reserve.ts`、`shared/src/game-poker-card-schemas.ts`、`shared/src/game-cards.test.ts`；Modify `shared/src/game.ts`、`shared/src/game-ui.ts`、`shared/src/game-response-schemas.ts`、`shared/src/game-poker-response-schemas.ts`、`shared/scripts/build-game-contracts.mjs`。
**Interfaces:** Produces固定接口约定中的T1全部类型和strict schema；后续所有任务只从`@synapse/shared/game-contracts`/`game-ui`导入共享类型。GameReserveWriteBatch及私有通用账本类型不作为客户端写入schema暴露。

- [x] **1. 写契约失败测试。** `cards_flag_and_private_operations`断言旧房规合法、cards默认为false，cards+roll可共存；`GAME_TOOLS`不含card.play/card.choose，两项只在私有UI集合且路由为POST。`expect(z.fromJSONSchema(POKER_CARD_PLAY_SCHEMA).safeParse({...input,effectCode:"x"}).success).toBe(false)`；无版本旧响应仍合法，未知新规则不可授权行动。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/shared exec vitest run src/game-cards.test.ts`；预期缺少新导出或上述断言失败，而不是环境/依赖失败。
- [x] **3. 实现类型和schema。** 采用固定命名；定义公开/本人字段的区分、名义/减免/实付、可见状态、根帧和暂存complete标记。新增`/card/play`和`/card/choose`的UI路由元数据，但此时不开放新建卡牌房。构建脚本补齐新文件双模块产物。
- [x] **4. 验证绿灯。** 同一测试通过，再运行`pnpm --filter @synapse/shared build`与`pnpm --filter @synapse/shared typecheck`，预期exit 0。
- [x] **5. 本地提交。** 只暂存本任务文件，`git commit -m 'feat: 定义卡牌模式版本及私有用牌契约'`。

## Task 2: 生命周期注册与有界执行器

**Files:** Create `server/src/game/poker/engine/cards/types.ts`、`server/src/game/poker/engine/cards/registry.ts`、`server/src/game/poker/engine/cards/runner.ts`、`server/src/game/poker/engine/__tests__/card-runtime.spec.ts`。
**Interfaces:** Consumes T1；Produces `OperationRegistry.register`、`CardRegistry`、`runResolution`和固定上下文/帧类型；允许测试注册受控小操作，不接数据库或UI。

- [x] **1. 写失败测试。** `before_then_fact_then_after`断言修改前/事实/后触发顺序；`priority_then_install_sequence`断言稳定顺序；`same_event_effect_once`断言重复事实不再触发；`chain_budget_is_atomic`对第129项和第33层断言抛错且原state/状态次数未变；查询预演不读取randomInt。 断言示例：`expect(trace).toEqual(["before","fact","after"]); expect(inputState).toEqual(beforeState)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/card-runtime.spec.ts`。
- [x] **3. 实现执行器。** 所有处理器只发领域操作，事实不可改；逐层带root/parent/index；首个有效拦截停止后续同类防护。注册校验schema/版本/次数和终止预算，异常回滚根动作的工作副本。
- [x] **4. 同命令验证绿灯。** 新增重排注册顺序后结果仍一致的断言；预算错误必须有稳定领域码，无成功半帧。
- [x] **5. 本地提交。** `git commit -m 'feat: 建立支持前后钩子和有界触发的牌局执行器'`，只暂存本任务文件。


## Task 3: 有限共享池与实例去向

**Files:** Create `server/src/game/poker/engine/cards/pool.ts`、`server/src/game/poker/engine/__tests__/card-pool.spec.ts`、`server/src/game/poker/__tests__/card-test-fixtures.ts`；Modify `server/src/game/poker/engine/cards/types.ts`、`server/src/game/poker/engine/hand-runner.ts`、`server/src/game/poker/engine/rules.ts`。
**Interfaces:** Consumes T2的`CardDefinition`/`ResolutionContext`；Produces `CardModeState`、`CardPoolOperation`、`createCardPool`、`applyCardPoolOperation`。fixture导出`makeCardHand(options?:{humans?:number;bots?:number;actorSeatNo?:number;variant?:PokerVariant;bigBlind?:number;roll?:boolean}):HandState`及`sequenceRandomInt(values:readonly number[]):(max:number)=>number`，默认两真人、0号行动、standard52、1/2盲、Roll关闭；先用现有startHand建立合法手，再附测试能力牌状态。生产目录待T8提供。

- [x] **1. 写失败测试。** 用三个测试定义验证缺省copies=1、显式copies=2；六真人初始各3、阶段三次各1，总发36；两真人三机器人只给真人；重复阶段事件不再发；剩2请求3只得2；生成/候选未选归还/消耗后始终满足`initial+generated===allZones`，第1025实例拒绝且无副作用。 断言示例：`expect(receivedPerHuman).toEqual([6,6,6,6,6,6]); expect(initialCount+generatedCount).toBe(allZoneCount)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/card-pool.spec.ts`。
- [x] **3. 实现区域操作。** 按原入座持有、庄家左侧轮流补牌、零池不回收；额外消耗先验证确实持有；候选保留区独立；弃牌持牌留存直到结算/取消。生成只能来自已注册目录，创建新ID。
- [x] **3a. 接入类型而不提前开放房规。** HandState增加可选cards、Engine PokerRules声明可选版本字段；fixture在合法原生手牌上附能力牌状态。T5再加入chips/T7加入turnClock，避免早期任务导入尚未创建的后续类型或提前绕过房规校验。
- [x] **4. 同命令验证绿灯。** 另断言同座换人不继承牌，全下和弃牌不补，清理本局不会删除审计事实。
- [x] **5. 本地提交。** `git commit -m 'feat: 实现共享卡池发放抽取与生成实例守恒'`。


## Task 4: 有限豁免、名义下注与真实边池

**Files:** Create `server/src/game/poker/engine/chips/types.ts`、`server/src/game/poker/engine/chips/payment.ts`、`server/src/game/poker/engine/chips/funded-betting.ts`、`server/src/game/poker/engine/chips/funded-pots.ts`、`server/src/game/poker/engine/__tests__/funded-betting.spec.ts`、`server/src/game/poker/engine/__tests__/funded-pots.spec.ts`；Modify `server/src/game/poker/engine/betting.ts`、`server/src/game/poker/engine/pots.ts`。
**Interfaces:** Produces `ChipPaymentInput/Modifier/Quote`、`FundedSeat/Pot`、`quoteChipPayment`、`applyFundedBet`、`splitFundedPots`；筹码模块不导入具体卡牌ID。

- [x] **1. 写失败测试。** `cap_100_on_60_and_300`断言实付0/200；`combined_spell_cost`在BB10时20基础+20追加遇30豁免，实付10；`allin_500_plus_100`断言名义600、实付500和allIn=true；`call_80_waived`实付0且allIn=false。边池手算例`[(100,0),(100,100),(50,50)]`得到真实金额`[100,50]`和资格`[[A,B,C],[A,B]]`。 断言示例：`expect(splitFundedPots(seats,order).map(p=>p.amount)).toEqual([100,50])`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/funded-betting.spec.ts src/game/poker/engine/__tests__/funded-pots.spec.ts`。
- [x] **3. 实现支付和分层。** 同次基础/追加卡费合并一次支付；最大余数使用BigInt中间量，层级同余优先低层。名义匹配/最小加注和真实投入独立，返还只返实体资金。非下注支付默认留1颗，钻石不享筹码豁免；未用满的一次性额度不结转。
- [x] **4. 同命令验证绿灯。** 枚举三人名义1至9的729个无减免组合，对照既有`splitPots`；增加不整除、零金额层、已弃牌高投入、唯一未弃牌者、未匹配最高层和短全下不重开加注权。断言每层合计等于实付总额。
- [x] **5. 本地提交。** `git commit -m 'feat: 支持有额度豁免的名义下注与真实边池结算'`。


## Task 5: 可追溯暂存、盗取与退款

**Files:** Create `server/src/game/poker/engine/chips/reserve.ts`、`server/src/game/poker/engine/__tests__/reserve.spec.ts`；Modify `server/src/game/poker/engine/chips/types.ts`、`server/src/game/poker/engine/hand-runner.ts`。
**Interfaces:** Produces `ReserveState/Operation/Result`、`ReserveLot/Claim/Movement`、`applyReserveOperation`；T9只持久化这里的已验证差量，不重算玩法。

- [x] **1. 写失败测试。** `deposit_120_steal_60_refund_60`断言A存120后B/C/D各40，B盗60后待分`[40,10,10]`，A取回仅60，B已到手60不追回；`split_deposits_same_beneficiary_loss`验证拆分批次不改变受益人总损失；39目标被44保护后实得0且不换次富者。 断言示例：`expect(afterSteal.claims.map(c=>c.remainingAmount)).toEqual([40,10,10]); expect(refundedAmount).toBe(60)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/reserve.spec.ts`。
- [x] **3. 实现来源与两级同比转移。** 先按受益人再按来源拆分损失，同余按庄家左侧/原序号；保留盗者自己份额，资格按存入快照。最近批次在本次出牌前锁定，零额不成批次，已空不跳更早；每笔原始额等于剩余与各已转出去向之和。
- [x] **4. 同命令验证绿灯。** 覆盖部分退款、自己当前卡费不成退款目标、离桌/换座、群体盗取遇保护后重新分摊、定向不改选、最终分配重试不重复；每步核对钱包+真实底池+暂存守恒。
- [x] **5. 本地提交。** `git commit -m 'feat: 实现暂存来源账本及按份额盗取退款'`。


## Task 6: 扑克牌操作、候选与实体公开标记

**Files:** Create `server/src/game/poker/engine/cards/poker-operations.ts`、`server/src/game/poker/engine/__tests__/card-poker-operations.spec.ts`；Modify `server/src/game/poker/engine/hand-runner.ts`、`server/src/game/poker/engine/roll.ts`。
**Interfaces:** Consumes T2执行注册/`PendingChoice`及现有`orderedDeck/shuffle`；Produces `registerPokerCardOperations`、实体牌公开标记与私有观察记录类型，供T7/T8/T11使用。

- [x] **1. 写失败测试。** `replace_draw_before_return`断言01旧牌不在本次新牌候选；`reset_return_before_draw`断言02可以抽回原牌；`all_holes_shuffle_protected_excluded`断言保护者两张不进入混洗；`peek_skips_burn`预览跳过烧牌且洗牌后失效；`public_marker_moves_with_card`交换后公开的是原实体而非旧槽的新牌。52/32张各覆盖。 断言示例：`expect(new Set(allPhysicalCards).size).toBe(variant==="short32"?32:52)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/card-poker-operations.spec.ts`。
- [x] **3. 实现领域操作。** 把单张替换/整副交换/重洗/查看/公开和候选保留封装为注册操作，Roll复用同一保留区约束；候选第一项回退确定化。扑克候选、能力牌候选类型不同但全局最多一个待选；所有移牌后执行唯一性/完整牌量断言。
- [x] **4. 同命令验证绿灯。** 加入候选不足取实际数量、红/黑牌不存在仍消费但不换、公开标记回堆不暴露位置、已弃牌/候场不可选、全下/机器人可被影响、同槽Roll重抽旧行为回归。
- [x] **5. 本地提交。** `git commit -m 'feat: 统一卡牌与Roll的扑克牌操作及候选保留'`。


## Task 7: 持续状态、防护、驱散与时间

**Files:** Create `server/src/game/poker/engine/cards/statuses.ts`、`server/src/game/poker/engine/cards/deadlines.ts`、`server/src/game/poker/engine/__tests__/card-statuses.spec.ts`、`server/src/game/poker/engine/__tests__/card-deadlines.spec.ts`；Modify `server/src/game/poker/engine/cards/types.ts`、`server/src/game/poker/engine/hand-runner.ts`。
**Interfaces:** Produces `registerCardStatusOperations`、`TurnClock/DeadlineOperation`、`applyDeadlineOperation`；支付豁免通过T4的通用modifier接入，不让筹码模块读取卡牌ID。

- [x] **1. 写失败测试。** `shield_first_effect_only`只耗第一个有效防护；`dispel_polarity`断言45移除别人正面触发48、移负面不触发；`cleanse_public_child_not_knowledge`断言46能移除60子标记且父仍在不重挂；`cleanse_ignores_surcharge`断言46不触发49，选中49才移除。`clock_keeps_start`在start=0/deadline=600000/now=100000翻倍后deadline=1100000，重复延时不越1200000；300秒缩时在期限内净化返还300秒，过期拒绝。 断言示例：`expect(afterDouble).toMatchObject({startedAt:0,deadlineAt:1100000}); expect(afterRepeatedExtension.deadlineAt).toBe(1200000)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/card-statuses.spec.ts src/game/poker/engine/__tests__/card-deadlines.spec.ts`。
- [x] **3. 实现状态语义。** 完整落实设计第7节驱散表、敌意、次数和全场替换；53同族不叠加；56本阶段每人触发标记不因同族替换清零；57派生抽牌不再增强自身。已完成资金/抽牌/51及52加时不可驱散。
- [x] **4. 同命令验证绿灯。** 覆盖47反窥被43拦截且不回环、弃牌后全场仍持续、全下获钱不复活行动、状态65个原子拒绝、驱散54不撤回已确定回合的加时、结算/取消清空运行状态。
- [x] **5. 本地提交。** `git commit -m 'feat: 支持卡牌持续触发防护驱散与限时修正'`。


## Task 8: 声明式接入完整60张与版本快照

**Files:** Create `server/src/game/poker/engine/cards/catalog-v1.ts`、`server/src/game/poker/engine/cards/commands.ts`、`server/src/game/poker/engine/cards/catalog/holes.ts`、`server/src/game/poker/engine/cards/catalog/information.ts`、`server/src/game/poker/engine/cards/catalog/draw.ts`、`server/src/game/poker/engine/cards/catalog/reserve.ts`、`server/src/game/poker/engine/cards/catalog/defense.ts`、`server/src/game/poker/engine/cards/catalog/table.ts`、`server/src/game/poker/engine/__tests__/card-catalog.spec.ts`、`server/src/game/poker/engine/__tests__/card-catalog-scenarios.ts`。
**Interfaces:** Consumes T2–T7操作/状态；Produces `CARD_CATALOG_V1`、`createCardRegistry`、`planCardPlay`、`planCardChoice`和可验证目录/配方摘要。每个定义包括ID、规则文本、份数、目标、费用、步骤、时机、标签、状态策略和封面assetId。

- [x] **1. 写失败测试。** 断言ID=`01..60`、名称唯一、份数总90、双份30、无copies默认1、38代价2BB、其余基础代价0。手工建立60个`CardScenario`，字段为`definitionId,input,initialState,entropy,expectedStateDelta,expectedPublic,expectedPrivate`，expected不能从实际定义反算；按设计第8节逐行写对应断言。 断言示例：`expect(scenarios.map(s=>s.definitionId)).toEqual(Array.from({length:60},(_,i)=>String(i+1).padStart(2,"0"))); expect(actual.state).toMatchObject(scenario.expectedStateDelta)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/card-catalog.spec.ts`。
- [x] **3. 实现六组定义。** 只组合注册操作，特殊计算放在其所属领域操作而不是页面或Roll分支。固定3BB/5BB/10BB额度、38支付、49税、51/52/53时间值；30生成排除生成标签，25候选未选归还。所有目标schema和公开/私密结果明确化。
- [x] **4. 同命令验证绿灯。** 60场景逐张执行并检查真实效果，不只检查“注册存在”；额外验证28新实例入池后随机抽取不保证拿到新牌、35退款边界、48不把两人全场牌当单目标、58/59无资金/牌型改动。摘要改变需新版本，不能覆盖旧定义。
- [x] **5. 本地提交。** `git commit -m 'feat: 注册首批60种90张卡牌及完整效果定义'`。


## Task 9: 通用暂存与根帧持久化、旧冻结兼容

**Files:** Create `server/prisma/migrations/20261103000000_game_card_mode_and_reserve/migration.sql`、`server/src/game/hall/game-reserve.service.ts`、`server/src/game/hall/__tests__/reserve-store.spec.ts`、`server/src/game/poker/__tests__/card-migration.spec.ts`；Modify `server/prisma/schema.prisma`、`server/src/game/hall/hall.service.ts`、`server/src/game/hall/hall.module.ts`、`server/src/game/hall/__tests__/hall-store.ts`、`server/src/game/poker/__tests__/roll-service-store.ts`。
**Interfaces:** Consumes T5的已验证差量；Produces固定接口中的`GameReserveService`。新增模型固定为`GameReserveLot`、`GameReserveClaim`、`GameReserveMovement`、`GamePokerResolution`，不复用旧冻结意图作为可变分录。

- [x] **1. 写失败测试。** `store_deduplicates_batch`同root/index只写一次且意图不同拒绝；`finalize_no_double_pending`暂存最终固化时pending不重复；`legacy_transfer_unchanged`旧GamePendingTransfer仍不可变；`failed_movement_rolls_back_wallet`写入失败后钱包、份额、帧、回执均未变。迁移文本断言没有UPDATE旧资金、DROP旧表、非空无默认回填。 断言示例：`expect(afterRetry.movements).toHaveLength(1); expect(afterFailedWrite).toEqual(beforeWrite)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/hall/__tests__/reserve-store.spec.ts src/game/poker/__tests__/card-migration.spec.ts`，使用内存事务store；此时不连接数据库。
- [x] **3. 实现模型与适配。** 房间增加nullable cardRulesVersion/chipRulesVersion、actionStartedAt；各新表存资金域/游戏/房间/本局/原入座、版本和稳定来源。Lot/Claim记录originalAmount/remainingAmount及状态，Movement只追加，Resolution唯一(handId,seq)且actionId唯一。非负/剩余不大于原额、唯一键、pending用户索引和稳定分页索引齐备；迁移设锁5秒/执行30秒超时。ReserveService只依赖Prisma，finalize返回最终`PendingTransferInput[]`由协调器调用原freeze/release；HallService聚合旧冻结pending与未固化Claim，inPlay仅真实资金，补助覆盖两类。overview的inPlay和两类pending必须在同一SQL快照读取（单语句或显式只读REPEATABLE READ事务），不能拼接跨快照金额。默认不改存量房版本。
- [x] **4. 验证绿灯。** 运行同组store/迁移测试，确认固化前后pending只计一次，旧store补齐真实新表语义而非跳过断言；运行不连接数据库的`pnpm --filter @synapse/server exec prisma generate`核对生成类型。
- [x] **5. 本地提交。** `git commit -m 'feat: 持久化通用暂存及版本化卡牌结算帧'`。保留迁移未执行状态，真实约束验收交T17。


## Task 10: 本人/公开/MCP投影与完整归档

**Files:** Create `server/src/game/poker/poker-card-projection.ts`、`server/src/game/poker/poker-reserve-projection.ts`、`server/src/game/poker/__tests__/card-projection.spec.ts`、`server/src/game/poker/__tests__/card-archive.spec.ts`；Modify `server/src/game/poker/poker-projection.ts`、`server/src/game/poker/poker-read.service.ts`、`server/src/game/poker/poker-events.service.ts`、`server/src/game/poker/poker-archive.service.ts`、`server/src/game/poker/poker-hand-log.ts`、`server/src/game/poker/poker-roll-stats.ts`、`server/src/game/poker/poker-roll-ledger.ts`、`server/src/game/poker/poker-chip-projection.ts`、`server/src/game/poker/poker-pot-contributions.ts`。
**Interfaces:** Produces T10两项投影函数、版本化根帧读取和归档字段；Consumes T1/T8/T9及现有`PokerViewPolicy`。完整源保存在快照/审计，近期事件只为表现。

- [x] **1. 写失败测试。** `owner_public_mcp_matrix`以两个账号同房+未入座教学视角断言，仅核实本人Web视角有ownHand/pending/privateResults；卡牌房MCP即使请求owner也没有暗牌或私有结果；`discard_is_not_public_play`额外消耗牌身份不公开。`whole_frame_pagination`页尾不能截断同一根帧。 断言示例：`expect(publicView).not.toHaveProperty("ownHand"); expect(mcpView).not.toHaveProperty("privateResults")`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/__tests__/card-projection.spec.ts src/game/poker/__tests__/card-archive.spec.ts`。
- [x] **3. 实现公开白名单。** 只公开已施放名称和实际公开结果；本人持牌使用实例引用+去重定义字典，其他人不常驻披露持牌数。暂存余额来自完整权威状态，明细最多1000项并带complete=false，缺源显示不可用而非零。旧rollLedger只按旧语义解释，新规则使用reserve来源/去向分列，不把退款改写为未支付。
- [x] **4. 同命令验证绿灯。** 覆盖热/冷归档往返、原入座离开重入、public本地防御性删除、根帧重读不再随机/触发、零实付Roll仍保留次数但支出0、公开标记交换/净化后历史知识保留。
- [x] **5. 本地提交。** `git commit -m 'feat: 隔离卡牌私密结果并归档暂存与触发过程'`。


## Task 11: 接入开局、下注、Roll、用牌与超时协调

**Files:** Create `server/src/game/poker/engine/hand-transitions.ts`、`server/src/game/poker/engine/resolve-hand.ts`、`server/src/game/poker/poker-card.service.ts`、`server/src/game/poker/__tests__/card-service.spec.ts`、`server/src/game/poker/__tests__/card-lifecycle.spec.ts`；Modify `server/src/game/poker/poker.service.ts`、`server/src/game/poker/poker-action.service.ts`、`server/src/game/poker/poker-roll.service.ts`、`server/src/game/poker/poker-lifecycle.ts`、`server/src/game/poker/poker-deadline.task.ts`、`server/src/game/poker/engine/hand-runner.ts`、`server/src/game/poker/engine/roll.ts`、`server/src/game/poker/engine/rules.ts`、`docs/agents/module-boundaries.md`。
**Interfaces:** Consumes T1–T10；Produces `nextHandTransition`、`resolveHandCommand`、`PokerCardService.play/choose`、统一存储的HandResolution与当前TurnClock。legacy走原版本，v2统一经协调器。

- [x] **1. 写失败测试。** `start_blinds_then_cards_then_turn`断言盲注先于初始能力牌；`stage_once_after_board`公共牌→已安装效果→真人补牌→下一行动；`waiver_roll_atomic`20筹码+1钻石遇额度100时筹码0/钻石1/次数+1/暂存0；`same_uuid_one_result`并发/未知结果重试不重复执行；`pending_blocks_all_cards`06或超级Roll待选时03/58/51均拒绝，原Roll同槽重抽仍可用。 断言示例：`expect(walletAfter).toBe(walletBefore); expect(diamondsAfter).toBe(diamondsBefore-1); expect(reserveAfter).toBe(0)`（豁免Roll案例）。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/poker/__tests__/card-service.spec.ts src/game/poker/__tests__/card-lifecycle.spec.ts`。
- [x] **3. 实现统一推进和事务适配。** 从现有progress抽出`nextHandTransition`共用判定，legacy直接执行，v2通过注册操作发烧牌/公共牌/补牌/回合/结算。根链收敛后才推进，每根actionSeq只加1。Roll基础报价/钻石/次数独立，v2支付只通过公共操作扣一次，候选步骤不再裸扣；payment区分原价/实付。原withRoom锁内重新采样时间和重验期限/控制/序号，模式检查先于私有回执；同事务保存state、资金差量、帧、动作和回执。选择等待不持锁，elapsedMs从actionStartedAt计算。
- [x] **4. 验证绿灯。** 运行同组服务/生命周期测试，使用Vitest固定系统时间；确认锁等待跨过期限拒绝、旧超时调度遇新延时截止不提前撤出、超时第一候选后原过牌/弃牌撤出、结算先真实底池再暂存和离桌、保存中断不留下半帧。T10/T9提供的完整持久化行为不能被mock成恒成功。
- [x] **5. 本地提交。** `git commit -m 'feat: 将卡牌生命周期接入牌局行动和事务结算'`；同期更新`docs/agents/module-boundaries.md`的资金/生命周期版本边界，保留旧局规则。


## Task 12: HTTP路由、服务端AI禁入与版本门槛

**Files:** Create `server/src/game/poker/poker-mode-policy.ts`、`server/src/game/__tests__/card-web.spec.ts`、`server/src/game/poker/__tests__/card-access.spec.ts`；Modify `server/src/game/game.controller.ts`、`server/src/game/game-web.guard.ts`、`server/src/game/game-api.service.ts`、`server/src/game/game.module.ts`、`server/src/game/poker/poker.service.ts`、`server/src/game/poker/poker-action.service.ts`、`server/src/game/poker/poker-roll.service.ts`、`server/src/game/poker/poker-wait.service.ts`、`server/src/game/poker/poker-read.service.ts`、`server/src/config/env.ts`、`server/src/config/env.spec.ts`、`server/.env.example`、`server/compose.yml`、`docs/agents/capability-registry.md`。
**Interfaces:** Produces `assertPokerModeAccess`、`cardReadPolicy`；公开guide返回cards.available与受支持规则版本，来源只能由受信HTTP/MCP入口设置。新私有路由为POST`/api/game/poker/rooms/:code/card/play`和`/card/choose`。

- [x] **1. 写失败测试。** 分别通过HTTP/公开invoke/直接服务调用尝试AI join、claim、request_ai、ready/start/act/Roll/card写入，卡牌房全拒绝；同账号真实human可用，rules_bot仅内部合法。`invoke_rejects_private_card_ids`不能经公共GAME_TOOLS调用新私有项；伪造caller/effectCode及跨房间instance拒绝。旧房AI行为不变。 断言示例：`expect(bearerResponse.status).toBe(403); expect(cookieResponse.body.ok).toBe(true); expect(privateIds.every(id=>!GAME_TOOLS.some(t=>t.id===id))).toBe(true)`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/server exec vitest run src/game/__tests__/card-web.spec.ts src/game/poker/__tests__/card-access.spec.ts`。
- [x] **3. 实现路由与模式策略。** 私有路由直接调用注入的PokerCardService并使用共享strict schema，不加入公共GameApiService工具switch。现有GameWebGuard对Bearer直接放行，因此卡牌房创建及用牌/选择/join/ready/start/act/Roll/AI交接入口额外强制受信Cookie Web会话、身份头和同源校验，Bearer即使伪造版本头也不能当human；普通房旧行为不变。所有参赛服务入口继续检查caller，避免直接服务绕过。读取/历史也按认证通道区分：Cookie为human/desktop，卡牌房Bearer或MCP强制decision/public，不能仅凭访问Web URL获得本人字段。
- [x] **4. 实现创建门槛并验证绿灯。** 增加`GAME_POKER_CARD_MODE_ENABLED=false`安全默认；仅门槛开启且human Web声明支持cards-v1/chips-v2时接受新建卡牌房。卡牌房旧客户端缺版本头不能写入；普通无卡新房可用AI/MCP，仍使用无卡干预的暂存；旧房版本不回填。覆盖Cookie通过、Bearer与缺版本头拒绝、来源伪造失败和旧房不受影响的HTTP测试。同步env校验/中文示例、compose与能力注册表：私有Web新增2、公共卡牌MCP新增0，其余按实际导出重算。
- [x] **5. 本地提交。** `git commit -m 'feat: 增加真人卡牌入口并在服务端禁止AI参赛'`。


## Task 13: 建房、摘要、偏好和AI入口

**Files:** Create `dashboard/src/game-center/games/poker/hooks/usePokerCardAvailability.ts`、`dashboard/src/game-center/games/poker/__tests__/card-room.test.tsx`；Modify `dashboard/src/game-center/games/poker/components/CreateRoomDialog.tsx`、`dashboard/src/game-center/games/poker/components/PokerJoinSummary.tsx`、`dashboard/src/game-center/games/poker/components/RoomList.tsx`、`dashboard/src/game-center/games/poker/components/LobbyView.tsx`、`dashboard/src/game-center/games/poker/components/PokerAIConnectDialog.tsx`、`dashboard/src/game-center/games/poker/hooks/usePokerRoomDraft.ts`、`dashboard/src/game-center/games/poker/hooks/usePokerAIConnect.ts`、`dashboard/src/game-center/runtime/preferences.ts`、`dashboard/src/game-center/runtime/web-client.ts`、`dashboard/src/game-center/lib/api.ts`。
**Interfaces:** Consumes T1/T12 guide和房规；Produces带cards开关的`PokerRoomDraft`/偏好和两项`GameBridge.poker.card`方法。`usePokerCardAvailability(identityKey)`返回available/loading/error/reload，查询留在hook/API层。

- [x] **1. 写失败测试。** `independent_cards_roll_flags`覆盖四种开关组合；`old_preference_cards_false`旧偏好默认为false；同一creationId重试不能改变cards配置。`cards_room_no_ai_entry`不显示授权接入/复制指令操作，普通房仍可用；guide失败不擅自认为可开放。 断言示例：`expect(sent.ruleOptions).toEqual({roll:true,rollCoins:12,cards:true})`。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/dashboard exec vitest run src/game-center/games/poker/__tests__/card-room.test.tsx src/game-center/runtime/preferences.test.ts src/game-center/__tests__/web-api.test.ts`。
- [x] **3. 实现配置与传输。** Switch与现有Roll同层级，房主不能改卡池/单卡参数；按账号记忆。WebClient携带T1的规则支持头，新私有调用走固定路由不落公共invoke。房间创建身份来源修正由HTTP固定human；room/list摘要明确卡牌模式，AI入口按服务端模式禁用。
- [x] **4. 同命令验证绿灯。** 增加跨账号迟到偏好加载隔离、门槛关闭时清晰禁用且不会静默改写已发送创建意图、创建后设置不可变、未知创建结果原ID核对。运行`pnpm --filter @synapse/dashboard check:ui`。
- [x] **5. 本地提交。** `git commit -m 'feat: 支持独立开启卡牌房并限制AI接入入口'`。


## Task 14: 卡牌面板、目标选择和未知写恢复

**Files:** Create `dashboard/src/game-center/games/poker/hooks/usePokerCards.ts`、`dashboard/src/game-center/games/poker/lib/card-intent-store.ts`、`dashboard/src/game-center/games/poker/lib/card-view.ts`、`dashboard/src/game-center/games/poker/components/PokerCardsDialog.tsx`、`dashboard/src/game-center/games/poker/components/PokerCardSelection.tsx`、`dashboard/src/game-center/games/poker/styles/cards.css`、`dashboard/src/game-center/games/poker/__tests__/card-controls.test.tsx`、`dashboard/src/game-center/games/poker/__tests__/card-intent-store.test.ts`；Modify `dashboard/src/game-center/games/poker/components/HumanControls.tsx`、`dashboard/src/game-center/games/poker/components/Table.tsx`、`dashboard/src/game-center/games/poker/hooks/useHumanControls.ts`、`dashboard/src/game-center/games/poker/hooks/usePokerRoom.ts`。
**Interfaces:** `usePokerCards(table:PokerTableView,perspective:"owner"|"public",onRefresh:()=>void|Promise<void>,identityKey:string)`返回`busy,error,uncertain,storageError,play(input),choose(index),retry()`；具体请求使用T1类型。store提供getSnapshot/save/clear/reload/subscribe，scope固定账号+房间。

- [x] **1. 写失败测试。** `open_is_not_play`打开/选中卡不提交，明确使用才提交；`choice_schema_selects_real_targets`选择本人底牌/玩家/能力牌/公开状态时只提交schema字段；`storage_failure_blocks_card_only`存储失败阻止新卡写但不误禁已合法普通行动。`refresh_same_uuid`硬刷新恢复原UUID/参数，跨账号/房间迟到结果不能刷新新上下文。 断言示例：`expect(playMock).not.toHaveBeenCalled(); expect(restoredIntent.input.actionId).toBe(firstActionId)`（打开未使用、恢复两个独立案例）。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/dashboard exec vitest run src/game-center/games/poker/__tests__/card-controls.test.tsx src/game-center/games/poker/__tests__/card-intent-store.test.ts`。
- [x] **3. 实现用牌流程。** 先持久化意图并读回，再调用集中API；费用预演版本/额外代价明确确认。未知写使卡牌/Roll/下注共同等待原回执核对；明确领域拒绝才清除意图。统一待选时禁全部新主动牌和下注，仅原Roll候选可原槽重抽。
- [x] **4. 实现标准面板并验证绿灯。** 持牌图、名称、规则、实际代价、公共牌和原剩余时间；正文滚动、Footer操作可见；不按缩放画布尺寸缩小系统控件。公共视角无持牌DOM，关闭不丢待选，换局/视角清未提交选择，Escape返回真实入口。运行同组测试和`check:ui`；真实几何验收留T18。
- [x] **5. 本地提交。** `git commit -m 'feat: 增加卡牌选择施放面板与可恢复操作意图'`。


## Task 15: 暂存明细、真实筹码动画与状态表现

**Files:** Create `dashboard/src/game-center/games/poker/components/PokerReserveDialog.tsx`、`dashboard/src/game-center/games/poker/components/PokerCardStatuses.tsx`、`dashboard/src/game-center/games/poker/lib/reserve-view.ts`、`dashboard/src/game-center/games/poker/__tests__/reserve-view.test.tsx`、`dashboard/src/game-center/games/poker/__tests__/card-effects.test.tsx`；Modify `dashboard/src/game-center/games/poker/components/Table.tsx`、`dashboard/src/game-center/games/poker/components/Seat.tsx`、`dashboard/src/game-center/games/poker/components/HumanControls.tsx`、`dashboard/src/game-center/games/poker/components/MatchLog.tsx`、`dashboard/src/game-center/games/poker/components/MatchOverview.tsx`、`dashboard/src/game-center/games/poker/components/SettlementDetails.tsx`、`dashboard/src/game-center/games/poker/components/BetDecisionContext.tsx`、`dashboard/src/game-center/games/poker/hooks/usePokerChips.ts`、`dashboard/src/game-center/games/poker/hooks/usePokerEvents.ts`、`dashboard/src/game-center/games/poker/hooks/useTableMotion.ts`、`dashboard/src/game-center/games/poker/lib/chip-presentation.ts`、`dashboard/src/game-center/games/poker/lib/table-motion.ts`、`dashboard/src/game-center/games/poker/lib/action-view.ts`、`shared/src/game-poker-chips.ts`、`docs/agents/game-ui.md`。
**Interfaces:** Consumes T10根帧和reserve投影；`projectReserveRows(view:PokerReserveView,filter:ReserveFilter):ReserveRow[]`在lib/reserve-view.ts导出，供明细使用；`ReserveFilter`只含可见付款人/待分人key及来源类型。

- [x] **1. 写失败测试。** `reserve_rows_reconcile`显示120存入/60盗取/60退回且当前暂存0；`zero_paid_no_chip_motion`名义100实付0不飞100筹码；`root_frame_once`重复游标不重播。`marker_follows_and_cleanses`实体公开标记换人后显示正确，净化只解除持续公开、不删历史记录；本人情报不出现全局toast/其他人DOM。 断言示例：`expect(transfers.reduce((sum,t)=>sum+t.amount,0)).toBe(0)`（只有名义100/实付0、无其他资金动作的帧）。
- [x] **2. 运行红灯。** `pnpm --filter @synapse/dashboard exec vitest run src/game-center/games/poker/__tests__/reserve-view.test.tsx src/game-center/games/poker/__tests__/card-effects.test.tsx src/game-center/games/poker/__tests__/chip-presentation.test.ts`。
- [x] **3. 实现资金呈现。** 第二堆统一“暂存”，新规则按存入/盗取/退款/分配画真实转移；旧资金视图通过版本适配为原冻结金额，不改历史。下注提示同时清楚表达名义与实付，底池来源/统计使用真实投入；原支出和退款分列。明细缺源/截断不伪造完整零账。
- [x] **4. 实现状态与屏障并验证绿灯。** 玩家防护和全场状态按需展开，不添常驻介绍；根帧按因果顺序播放，资金与滚动数字完成后才完整结算，减少动态模式直接落结果。新基线/重连/换视角不重播历史帧。同期更新`docs/agents/game-ui.md`的两摞资金与卡牌UI边界。
- [x] **5. 本地提交。** `git commit -m 'feat: 展示通用暂存去向和卡牌触发的真实筹码变化'`。


## Task 16: GPT生成全部60张正式封面

**Files:** Create `dashboard/src/game-center/games/poker/assets/ability-cards/v1/{01..60}.png`、`dashboard/src/game-center/games/poker/assets/ability-cards/v1/manifest.json`、`dashboard/src/game-center/games/poker/assets/ability-cards/v1/README.md`、`dashboard/src/game-center/games/poker/lib/card-artwork.ts`、`dashboard/scripts/check-poker-card-assets.mjs`；Modify `dashboard/package.json`、`dashboard/src/game-center/games/poker/components/PokerCardsDialog.tsx`。
**Interfaces:** `manifest`每项含cardId、assetVersion、相对文件、实际尺寸、实际模型信息/未提供、完整提示词；`cardArtwork(cardId:string):string`仅映射已核对本地资源，不能返回生成占位图或私人远程URL。

- [x] **1. 写资源核对器。** 检查01..60恰60个唯一PNG、PNG签名/尺寸合法、文件非空、ID与T8目录完全匹配、prompt/model信息有值或明确未提供；缺1张时exit非0。运行`node dashboard/scripts/check-poker-card-assets.mjs`确认目前缺素材而失败，不为此运行无关产品测试。 断言示例：`assert.equal(assetIds.length,60); assert.equal(new Set(assetIds).size,60)`。
- [x] **2. 阅读并使用imagegen技能。** 实施者先读`/Users/liyang/.codex/skills/.system/imagegen/SKILL.md`，用当前GPT生图工具。先01/11/33校准，再用同一基准和设计第8节各主体生成其余57张；每张独立插画，同名副本复用。此处是真实生成工作，不以创建manifest宣称完成。
- [x] **3. 保存正式资产与溯源。** 浅底/少元素/左上光、无生成文字和卡框、统一4:5展示安全区与1024级素材；记录实际输出，不编造模型/seed/尺寸。若精确原图比例不受工具支持，保留原图，在统一4:5安全区展示并记录；需要修图用GPT编辑，不擅用Python重绘。
- [x] **3a. 接入资源检查入口。** dashboard/package.json增加`check:poker-card-assets`，值为`node scripts/check-poker-card-assets.mjs`；渲染仅按manifest的本地资源映射，不对网络失败做外部图兜底。
- [x] **4. 验收60张。** 运行核对器exit0，逐张看缩略图和完整图检查含义/风格/错误文字；实际面板只惰性加载需要的资源，避免一次预载60张。运行`pnpm --filter @synapse/dashboard build`，检查产物含全部已映射资源。
- [x] **5. 本地提交。** `git commit -m 'feat: 配齐60种卡牌的统一GPT生成封面'`；不将卡牌美术写进发布说明。


## Task 17: 隔离PostgreSQL、组合模拟与兼容回归

**Files:** Create `server/test/run-poker-card-e2e.mjs`、`server/test/poker-card.e2e.spec.ts`、`server/test/poker-card-runner.spec.ts`、`server/src/game/poker/engine/__tests__/card-combinations.spec.ts`、`docs/superpowers/acceptance/2026-11-03-poker-card-mode.md`；Modify `server/package.json`。
**Interfaces:** runner只接受显式`GAME_E2E_DATABASE_URL`且host为loopback、库名以`_e2e`结尾；校验成功才通过子进程env设置DATABASE_URL、迁移、执行唯一目标spec。不得打印URL/凭据，不采用当前业务库兜底。

- [x] **1. 写并运行无数据库测试。** `card-combinations.spec.ts`固定种子覆盖补给→换牌、赦免→Roll、暂存→盗取→退款、窥牌→防护→反窥、全下后改牌、任意两张同阶段生成/状态叠加，逐步检查资金、扑克牌及能力牌区域守恒。运行`pnpm --filter @synapse/server exec vitest run src/game/poker/engine/__tests__/card-combinations.spec.ts`，必须先见有意义失败再完成修复。 断言示例：`expect(spawnSpy).not.toHaveBeenCalled()`（非法库URL时）；组合场景逐步`expect(walletTotal+pot+reserve).toBe(initialMoney)`。
- [x] **2. 写并运行隔离runner拒绝测试。** `server/test/poker-card-runner.spec.ts`断言未配置、远程host、非_e2e库均在迁移/连接前拒绝；运行`pnpm --filter @synapse/server exec vitest run test/poker-card-runner.spec.ts`。`pnpm --filter @synapse/server run test:poker-cards:e2e`无配置时明确非0，不能把describe.skip当通过。依照既有runner模式使用spawn参数和env，不拼接凭据进shell。
- [x] **3. 获明确数据库测试授权后执行。** 在已核实的专用本机_e2e库做迁移前备份/恢复预演，再运行同一runner。验证SQL约束、同UUID并发只一个帧/账本、存入盗取退款与最终释放全事务、旧冻结不变、原入座离开重入、不重复补助；并发读取overview与最终释放时，只能看到前/后任一完整资金快照，不能同时计入已到手筹码和旧pending。清理仅限本次runId创建的记录，不truncate共享测试库。
- [x] **4. 完整回归和报告。** 单独运行shared build/typecheck/test，server typecheck及扑克/大厅专项，Dashboard tsc/check:ui及扑克Node/jsdom专项；旧标准/短牌、点数/陪练、Roll开关矩阵全部通过。记录模拟seed、版本、空池/生成/时间/筹码集中度和失败样本，明确“功能验证”与“平衡性未完成/已观测”区别；调参需新版本并回归。
- [x] **5. 本地提交。** `git commit -m 'test: 验证卡牌组合与暂存资金的真实事务一致性'`；若授权或环境缺失，保持本任务未完成并在报告写清，不能标记整版已验收。


## Task 18: 真实展开验收、规则同步和完成审查

**Files:** Create `dashboard/src/game-center/games/poker/__tests__/card-mode.browser.tsx`；Modify `docs/superpowers/acceptance/2026-11-03-poker-card-mode.md`、`docs/agents/game-ui.md`、`docs/agents/module-boundaries.md`、`docs/agents/capability-registry.md`、`docs/agent-guides/game-hall.md`、`CONTEXT.md`、`desktop/app-capabilities/synapse-skill/skill-package/game-hall/poker/SKILL.md`、`desktop/app-capabilities/synapse-skill/skill-package/game-hall/references/api.md`。
**Interfaces:** 最终验收消费T1–T17产物；无新增玩法/接口。系统Skill/API参考必须与实际导出一致，不把UI私有用牌操作公开为MCP。

- [x] **1. 写几何/键盘回归。** 覆盖桌面、390×667/844、320px与568/667短横屏，实际展开持牌/目标/候选/暂存/结算；断言标题留白、Footer可见、长正文单一滚动、标准按钮、焦点返回、850px切换和画布不重挂。只构造夹具不能声称浏览器通过。 断言示例：`expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth); expect(canvasAfter).toBe(canvasBefore)`。
- [x] **2. 获明确浏览器/应用启动授权后运行。** `pnpm --filter @synapse/dashboard test:browser src/game-center/games/poker/__tests__/card-mode.browser.tsx`用于既有组件几何回归；真实页面只经根`pnpm dev:server`启动，显式隔离库，按browser-skill优先bsk操作。组件测试运行器是既有Vitest Browser专用能力，不以登录浏览器替代其断言。已运行服务足够时不重启，停止用根`pnpm quit:server`。
- [x] **3. 同步规则和导出。** 根目录运行`node desktop/scripts/docs/generate-game-reference.mjs`，核对生成参考无新增卡牌MCP工具，补齐AI禁入错误处理和新资金版本说明。运行`pnpm --filter @synapse/desktop exec vitest run app-capabilities/game-hall/shared/__tests__/roll-skill-contract.test.ts app-capabilities/game-hall/shared/__tests__/human-control.test.ts`及`pnpm --filter @synapse/desktop run check:hard-constraints`；涉及实际Electron打包边界再按规则加typecheck/packaged-asar。
- [x] **4. 写最终可访问证据并自查。** 报告记录全部命令/退出码、迁移实际状态、60张素材清单、截图绝对路径（无在线链接则明确）、未验证项和版本回滚前提。核对私有Web恰新增2、公开MCP新增0、规则/Skill/归档一致，无游戏发布文案。当前任务不部署或打开生产开关。
- [x] **5. 本地提交及最终审查。** `git commit -m 'docs: 完成卡牌模式验收记录与能力边界同步'`；按用户选定执行方法做最终独立审查并修复实际问题。报告提交范围、已验证与未验证项目；T16未齐、T17/T18未验收或有资金/隐私缺口均不得宣称完整交付。


## 验证命令与放行层级

按拥有任务执行最小充分检查，修复新失败后重跑相关组；已通过且无新增变化不反复全量运行。

| 层级 | 命令/条件 | 放行含义 |
| --- | --- | --- |
| 共享 | `pnpm --filter @synapse/shared build`、`typecheck`、`test` | 契约及双模块构建；不证明服务端资金正确 |
| 服务端 | `pnpm --filter @synapse/server typecheck`、任务所列vitest专项 | 纯模型/事务store/访问边界；不证明真实SQL验收 |
| Dashboard | `pnpm --filter @synapse/dashboard tsc`、`check:ui`、任务所列Node/jsdom测试、`build` | 组件行为/主题边界/静态产物；不证明真实展开 |
| 数据库 | 明确授权+guard通过后`test:poker-cards:e2e` | 真实迁移与并发资金一致性，报告不得省略skip或失败 |
| 浏览器 | 明确授权后的T18组件回归与隔离实牌 | 真实展开、焦点和交互证据 |
| 发布 | 不在本次授权中 | 新建门槛最终开启、生产迁移、部署/发版另按项目流程 |

## 规格覆盖与计划自审

| 设计章节 | 实施任务 |
| --- | --- |
| 1–2 规则、解耦与现有链路 | T1/T2/T11/T12/T13 |
| 3 生命周期、声明、触发、选择和事务 | T2/T3/T6/T7/T11/T14 |
| 4 发放、参与者与AI | T3/T11/T12/T13 |
| 5 豁免、真实边池与守恒 | T4/T9/T11/T15/T17 |
| 6 暂存、盗取、退款和大厅 | T5/T9/T10/T15/T17 |
| 7 扑克牌/目标/公开/驱散/时间 | T6/T7/T8/T10/T15 |
| 8 六组60张90张与数值 | T8/T16/T17 |
| 9 界面与GPT封面 | T13/T14/T15/T16/T18 |
| 10 契约、快照、迁移和恢复 | T1/T9/T10/T11/T12/T17 |
| 11 规则、能力清单与Skill | T11/T12/T15/T18 |
| 12 验证与证据 | 每任务红绿测试及T17/T18 |

主代理自审记录（2026-11-03）：已按上述覆盖表逐节检查，18项任务均有文件、接口、行为断言、验证与提交步骤；Review Focus五类已分配到相应测试。已纠正finalize返回值、选择引用原付款版本、缺失的规则支持头、Bearer绕过与共用账本类型的归属。Modify路径已与当前仓库/前序Create核对；所有实现步骤保持未勾选。此项是计划一致性检查，不是已执行产品测试，也没有另派计划审阅代理。

## 当前交付与执行交接

当前只交付本计划及设计确认状态更新，未执行T1–T18，未生成美术、运行产品测试、迁移、启动应用或部署。已获得的是设计确认和编写计划授权，不据此切分支或启动后端。

建议采用主代理在本会话顺序执行、最后独立审查的方式：资金、生命周期和快照接口相互依赖较多，顺序推进更容易持续核对同一事务。也可由用户选择逐任务开发/审阅子代理方式；两种方式都在同一授权目录/分支工作，不默认创建worktree。用户审阅本计划并选择执行方法后，分别使用`superpowers:executing-plans`或`superpowers:subagent-driven-development`执行。
