# Roll 玩法产品实施计划

用户已批准完整实施方案；本文件拆成可审查任务。规范为当前对话的实施方案及 `docs/superpowers/specs/2026-11-01-poker-roll-rules-design.md`；本方案取代该草案内旧的“不接入产品”范围，但不授权部署或业务库写入。

## Global Constraints

- 原地 main；禁止分支/worktree、新依赖、部署、push、业务库迁移、应用/浏览器启动。只生成迁移；实际 DB/浏览器验收未执行必须明确标注。游戏不进入发布说明。子代理不得再派子代理。
- 两种资金模式、两种牌组，建房 `ruleOptions.roll?:boolean` 缺省 false；服务端价格版本 `roll-v1` 固定到房间/手牌，不接受客户端费率版本。
- P/E 同已批准研究定义。T=10P+E；三个阶段普通/超级整数系数(u,v)=(1,3)/(2,5)/(4,8)，分母2000；N=max(2000,uT)，S=max(N+2000,vT)，费用 ceil((1+k)*N或S /2000)。BigInt 精确计算；两档共享 k；余额必须大于费用；河牌禁用。
- 普通先指定后随机一张；超级先指定后抽三张再选一张，强制完成。旧牌本次不能抽到；完成后旧牌和未选牌回收洗匀。候选、旧牌位置仅本人可见。
- 费用独立于正常下注，全额确权给当时其他未弃牌参与者，含全下者；余数按庄家左侧分配。本手冻结，普通派彩后释放；不得改 startingStack 绕过守恒。Roll 不消耗下注行动、不续倒计时。待选先完成再下注；超时选第一张再原超时撤出。
- 同账号真人/AI/机器人共用同一规则与业务事务；机器人仅陪练内部调度，不暴露代行动入口。控制版本、UUID 幂等和未知写结果恢复沿用原边界。
- 金融记录绑定原入座，不让重用 GameSession 或 seatNo 接收旧入座资产。Hall 不读取扑克表；练习筹码不进点数账户。已离座点数补偿到账本人账户，练习补偿明确清零；保留审计。

## Review Focus

跨状态守恒、超级暂存牌完整性、冻结资产与大厅汇总快照、超时/离桌/重入的原入座身份、归档后的幂等与隐私、Roll 不续时限、不污染正常下注统计、真人与 MCP 投影/控制权一致、工具与 Skill/schema 注册一致。有限机器人策略不称最优；不改变原研究。

## Task 1: 纯引擎与可见信息机器人策略

范围：`server/src/game/poker/engine/`、新增 `server/src/game/poker/bot-roll-policy.ts` 及相关 bot/engine 测试。不要改业务 services、Prisma、shared 或 UI。

接口：扩展引擎 PokerRules 为兼容可选 `ruleOptions?:{roll?:boolean}`、`rollPricingVersion?:string`，导出 ROLL_PRICING_VERSION=`roll-v1`。缺字段关闭，开启必须有受支持版本；服务端新建时补版本，未知已存版本不回退。旧关闭规则输出尽量保持原形。

HandState 新增兼容可选 `burnedCards` 和 `roll`。新开局追踪烧牌；开启时 roll 包含 counts/paid/credits(按seatNo)、released、originalHoles、history 和 pending。history 每项含 id、seatNo、kind(normal/super)、cardIndex、oldCard、candidates、selectedIndex(null表示待选)、fee、street、count、compensations(按seatNo)。pending 保存同一 Roll 身份/选牌所需状态。引擎不含用户ID、DB、控制权和时钟。

导出 `quoteRoll(state,seatNo)` 返回 `{enabled,pricingVersion?,count,normal:{fee,available,reason?},super:{fee,available,reason?}}`；`startRoll(state,seatNo,{rollId,kind,cardIndex,fee},randomInt)`、`chooseRollCard(state,seatNo,rollId,candidateIndex,randomInt)` 返回不可变新 HandState；`assertHandIntegrity(state)`。normal 不产生待选，super 扣费时产生；完成前 act/removeFromHand 拒绝推进，超时由上层先调用 chooseRollCard。报价只读公开财务条件。

原始 startingStack 不变。进行中 ∑stack+∑普通投入+冻结补偿=∑startingStack；派彩后先检查 ∑stack+冻结补偿，再释放 credits 到逻辑最终stack，released=true，检查 ∑stack=原始资本。credits 保留累计金额供结算读，released 决定是否还冻结。originalHoles 不被替换覆盖。完整牌量包含 deck/holes/board/burned/pending candidates，不包含历史记录里的重复引用。旧无烧牌快照不伪造牌，仅兼容原规则；新 Roll 手牌必须完整检查。

BotRollObservation 为显式白名单，包含本人 hole/board/私有已见回收历史、公开 live人数/原入局人数/烧牌数/剩余牌数/他人Roll历史、P/E/BB/stack、报价和pending，不含真实deck或他人hole。导出 `botRollObservation(state,seatNo)`、`chooseBotRoll(input)` 返回 `{kind,cardIndex,fee}|null`、`chooseBotRollCandidate(input,cardIndex,candidates)` 返回下标。有限特征与解析随机三选一计算复用研究 policies.ts 中 visibleStrength/candidateWeights/rollOpportunities 方法的必要部分，不导入 test 模块，不加载拟合模型、不重复生产判型器（优先已有evaluate或抽取最小可见特征）。G=max(0,gain)*(P+.12E+2BB)；选 G−1.25fee 最大正值，平手较便宜/普通/较低位置；真实候选按可见强度选，平手第一张。无收益则正常出牌由上层处理。

TDD：先写失败测试并保留 RED/GREEN 证据；覆盖整数报价例3/8、6/14、16/31，关闭兼容、不可变转换、强制换牌/回收、超级期间下注拒绝、资金逐步守恒、全下/边池、十人短牌、跨阶段次数和不看暗牌。执行 focused engine/bot 测试，再 server 单元全套一次（日志存本计划 workspace，不启动服务）。仅提交本任务文件，中文提交。报告列导出接口及注意事项，供后任务直接使用。

## Task 2: 共享协议、通用冻结资金与数据迁移

依赖 Task1 引擎接口。范围：shared/src 的 game contracts/schemas/UI路由，server/prisma，server/src/game/hall 及测试；desktop game capability 契约计数测试及 `desktop/synapse-capabilities/shared/naming.ts` 中已获本方案授权的 choose 动作白名单。不修改扑克业务services或Web组件。

公开接口：room.create 新增 `ruleOptions:{roll:boolean}` 可选白名单。PokerRules/room/table/hand 快照支持 ruleOptions、rollPricingVersion。表状态 `roll?` 含 enabled/pricingVersion、仅本人 count/normal/super 报价、仅本人 `pending:{rollId,cardIndex,candidates}`、公开 pendingSeatNo；报价shape匹配引擎。seat 可选 rollCount/rollPaid/pendingCompensation。结算 seat 可选 rollPaid/rollReceived/pokerDelta；净delta保持总净变化。事件增加 `kind:"roll"`，roll载荷仅公开 kind/phase(start|choose)/fee/count/seatNo/displayName/source/compensations，不包含牌或旧牌位置。hand.detail 增加本人私有 Roll 记录和公开历史，权限白名单由Task3落实。

新增 GAME_TOOLS `app.game.poker.roll.start` (roomCode,handId,street,expectedActionSeq,controlVersion,actionId UUID,kind,cardIndex 0..1,expectedFee)，`app.game.poker.roll.choose` (roomCode,handId,rollId,candidateIndex 0..2,expectedActionSeq,controlVersion,actionId UUID)。全部上述字段必填。结果 `{ok:true,handId,rollId,actionSeq,cursor,status:"completed"|"choice_required"}`；super候选用state/wait恢复。wait新增 roll_choice_required，含handId/handNo/rollId/cardIndex/candidates/controlVersion/actionSeq/deadlineMs/cursor，your_turn包含roll报价和规则。保留原未读结算/控制释放优先级。新增 UI路由 `/game/poker/rooms/:code/roll/start|choose`，不新增桌面IPC。

Prisma：GamePokerRoom 加 ruleOptions Json 默认{}、rollPricingVersion nullable；GameSession 加 admissionId（每次join更新，不复用历史身份）；GamePokerHandSeat 加 admissionId nullable、originalHoleCards Json nullable；GamePokerAction 加 rollId nullable（Roll事件amount=0，费用从Roll记录读）；GamePokerActionReceipt 加 requestHash nullable，新Roll严格匹配而旧act兼容。新增 GamePokerRoll，id为Roll ID，roomId/handId/userId/admissionId/seatNo、startSeq/chooseSeq、data Json(完整引擎history项)、createdAt/completedAt。新增通用 GamePendingTransfer，sourceId(RollId)、gameKind/gameRoomId/settlementId(手牌不透明ID)、userId/admissionId、funding、amount、status(pending/released/voided)、releasedTo(table/account/discard)、createdAt/releasedAt；sourceId+admissionId唯一，按user/funding/status和settlementId索引。沿用项目无FK结构。

新入座预生成seat.id UUID，Hall.join 接 admissionId=seat.id并每次upsert更新；手牌参与者快照此ID。迁移回填当前在座GameSession为seat.id，旧已结束session可生成新UUID；旧handSeat标识保持nullable，因为旧手没有Roll资产。不能按时间猜旧入座。

Hall 提供通用 `freezeTransfers(tx, records, now)`、`releaseTransfers(tx, settlementId, activeAdmissions, now)`、`voidTransfers(tx, settlementId, now)` 及多账户有序锁接口。冻结记录幂等且不得默默接受金额不一致。activeAdmissions为可信ActiveGameAdmission对象数组，含admissionId/userId/gameKind/gameRoomId/funding，必须逐字段匹配转移；points还须开放GameSession同身份，practice允许无session的活跃练习参与者（机器人不创建Hall会话）。release：原admission仍存活且传入active集合则标table，不再额外increment inPlay（Task3的最终stack投影已含补偿）；不存活points进入账户并增加netProfit，不触碰后来新session；不存活practice标discard/voided。返回释放明细供扑克对账，不读取扑克表。all points account locks 按userId排序；练习不创建真实账户。

HallOverview.points 加兼容可选 pending，total=available+inPlay+pending，netProfit包含已确权pending；pending含已关闭原入座，practice排除。账户汇总采用同一SQL快照；资金变更遵守账户锁保证不双计。grant在有未释放points资产时不可领取。

迁移还须更新 game_poker_preserve_room_rules，禁止修改 ruleOptions/rollPricingVersion；GamePokerRoll 完成后的更新/普通删除受不可变审计保护，归档仅在完整副本核对后允许删除。所有资金查询有条件和限量，freeze至多10接收者，release用聚合或有界分页完整处理，不截断资产。迁移必须更新 game_poker_archive_hand：完整不可变副本增加rolls及原始牌；先验证副本再删热Roll表/行动；永久receipt不删除。旧归档读取rolls缺失当[]。只生成SQL和Prisma client，不连接业务库。TDD Hall资金/身份/schema/contract测试，shared tests+typecheck，server typecheck允许Task3未接接口需明确报告现有过渡错误。不得顺手修其他任务。中文提交并给Task3精确Hall/API接口报告。

## Task 3: 服务端完整玩法与AI/机器人接入

依赖Tasks1/2。范围 server/src/game/poker、game controller/API/module、必要后端契约/e2e测试。不要改shared或Web（缺接口先通知root，不静默改别任务）。

新增 PokerRollService 复用PokerService.withRoom；给真人/mcp传可信caller，机器人仅内部入口。身份、手牌、street、actionSeq、controlVersion、原deadline、active资格、expectedFee在同房锁内复验；start rollId用actionId，随机数用crypto.randomInt；persist engineState/Roll记录/公共GamePokerAction(action=roll_start|roll_choose,amount=0,rollId)/receipt/requestHash/通用转移同事务。精确请求指纹包含操作名与所有语义参数；同user/room/id相同指纹返回原确认，不同意图拒绝，不重抽。旧epoch重试仅确认已完成动作；新的写入必须当前控制权。

saveHand提供保留deadline的Roll保存路径，不能沿用每次保存重置600秒；Roll/选牌仍触发房间通知及botActionAt下一项1秒调度。普通act若pending直接拒绝；expire若pending先选首候选并记录独立事件，再执行原超时撤出，不退款/重置截止。接管/claim保持pending，旧AI不能写；正常座位leave/sit原手后语义不变。

创建时服务端注入 roll-v1；startNext快照规则，handSeat写admissionId=seat.id与originalHoleCards；结算holeCards为最终实际牌，original单独保留。所有含Roll资产的资金状态写入先按原参与者userId锁points账户，确保Hall读锁/汇总一致。freeze的接收者用扣费时原handSeat快照，不用后来同seatNo的人。

结算：引擎已先普通派彩再加逻辑补偿；saveHand只按原admission匹配在座者更新stack/session.inPlay一次，并调用Hall.releaseTransfers标记/迟到账号到账。原已退座者的正常剩余筹码不得再退一次，迟到只兑补偿；新入座不碰旧手资产。手牌summary逻辑最终值含费用/补偿，公开pokerDelta=delta+rollPaid−rollReceived。释放必须在输光/leave/next-hand准备判定前。实践单人立即解散void通用练习转移并保留cancelled手/roll审计；点数按原手末解散。

table/view/wait/events/detail/history/settlement读取落实Task2白名单；公共投影不含旧牌位置/候选，教学不扩候选权限；本人私有记录仅相同user且同手参与，未授权对手原始/最终牌同样不泄露。Roll events不当普通action动画、下注统计或VPIP/PFR输入；来源仍human/mcp/rules_bot/timeout，persona/note沿已有私有边界。

actBot按当前报价调用Task1白名单策略；pending先选、否则择机Roll、否则原chooseBotAction下注。每次持久调度只一项动作；稳定UUID含hand/actionSeq/seat/operation；不续无人房寿命。

GameApiService注册两个能力与guide/errors/loop，Controller窄POST trusted human，module注入。无新网络/模型服务。TDD覆盖控制/幂等/无续时/超时/重启/隐私、原入座迟到补偿、整数资金/边池、取消陪练、bot与AI接口。执行server全套与typecheck；DB e2e仅编写、无专用库授权不运行。中文提交并报告API实际投影供Task4。

## Task 4: Web完整交互、Skill与能力文档

依赖Tasks1–3。范围 dashboard-v2/src/game-center，另仅为共享GameBridge编译兼容在 dashboard/src/game-center/lib/api.ts 添加相同两个运输方法（不扩展V1界面），desktop权威game-hall Skill包/能力文档/Agent指南、根设计稿和模块边界、相关UI/Skill契约测试。

读取dashboard-v2 CLAUDE/DESIGN、game-ui及heroui-react技能，使用MCP官方Switch/Modal/Radio文档（只读）。建房开关，按账号记忆兼容false；room list/join summary标Roll；创建重试保持原意图UUID。牌桌Roll入口用既有游戏按钮打开系统HeroUI面板；档位、本人旧牌位置、两档费用和次数，明确确认后调用。费用过期重新读取，不自动接受新费用。

super待选自动恢复本人面板，可关闭但不撤销；下注保持禁用。AI控制时本人不能直接选择，先接管且原候选保留。账号/房间/controlVersion/hand/actionSeq变更清理陈旧意图；未知写结果保留原UUID/参数，读取后确认，不新ID重抽。关闭/重开面板不重挂画布、不播旧事件。支持既有850px与390窄屏规则、键盘/焦点。

结算与历史按实际投影展示Roll支出、补偿与总净变化；Hall总额待结算字段显示必要数值，旧response缺pending按0。保持normal下注、allin确认和逐手准备。

权威Skill game-hall/poker/SKILL.md、references/rules/protocol、根SKILL按需同步；用 desktop/scripts/docs/generate-game-reference.mjs 重生成api参考。guide/userAI循环读报价→决定→start→choice_required选→重读→正常act；允许用户风格约束、意识到累计费用，不保证必赚；控制释放停止、未知结果复用UUID、候选私密、补偿本手不可花。同步 docs/agent-guides/game-hall.md、docs/agents/module-boundaries.md、game-ui.md、capability-registry.md 当前表格与历史说明，game27→29、global capability370→372/MCP366→368，以实际注册检查为准。游戏IPC0，无新Dock/SystemApp/deep link。

编写行为测试覆盖记忆/开关、报价确认、pending禁用、恢复/身份切换、结算字段、Skill/schema parity，不写只grep文案的镜像测试。执行dashboard-v2 test/tsc/check:ui及相关desktop game/Skill tests/typecheck/hard constraints。禁止启动浏览器/Playwright/app；实际展开验收明确未执行。中文提交并报告未执行验收。

## Task 5: 集成验证与交付记录

Root收拢上述实现，运行shared/server/dashboard-v2测试、各包typecheck、受影响desktop契约/Skill测试/hard constraints；命令长输出存本计划workspace，读取结果。必要集成修复TDD，保留未授权DB/浏览器/部署状态。更新设计稿实施结果和本计划验证表，只提交任务改动，不写发布说明。最后按skill独立全分支审查，修Critical/Important，提交中文；最终给提交哈希、功能范围、验证与剩余实际验收限制。

## 实施与验证结果

详细证据及未执行验收见 [实现与验证记录](../acceptance/2026-11-01-poker-roll-implementation.md)。

|任务|实现与审查状态|主要验证|
|---|---|---|
|1 引擎／机器人|完成，独立审查无阻塞|61 项引擎／机器人专项；原始资本、牌量守恒|
|2 协议／通用资金|完成，JSONB 精确副本修复已复审|共享 Roll 契约、资金／入座、归档专项；实际 PG 未执行|
|3 业务服务|完成，独立审查无阻塞|幂等、控制、超时、私有投影、原入座补偿和状态化事务回归|
|4 Web／Skill|完成，底栏及硬刷新恢复修复已复审|全 game-center 274 项，desktop 相关 116 项，双 Skill 结构及实际 schema 检查|
|5 集成／最终审查|完成；两项 Important／三项 Minor 集中修复并最终复审通过|最终完整服务端 2,361 通过／143 跳过，Web 1,222 通过；shared 290 通过／1 项既有夹具失败；受影响类型与约束通过|

最终审查发现的关闭房间空版本契约和牌桌本人冻结补偿展示缺项已在 `b3290cb5d` 修复；最终完整套件包含这批回归，不使用修复前结果代替。授权范围内的本地实现完成；本次未执行真实数据库、浏览器或实际 AI 对局验收，未部署或 push，原研究结果保持。
