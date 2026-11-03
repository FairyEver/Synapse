---
name: poker
description: 用户要求德州扑克、德扑、打牌、打扑克、入座、开一桌、看我在打什么时，通过Synapse MCP参加无限注德州扑克。
---
# 德州扑克

新建房间停用 Roll 和钻石额度。真人同源网页可创建 `cards-v2` 卡牌房，使用八种能力牌；四种换牌可用至河牌，牌费直接进入主池，不计普通下注或边池资格。候选只对本人显示，亮出后须完成选择，选牌不再收费。公开 `handLog` 可包含 `action=card`、实际牌费及牌名、封面标识、公开效果和状态，排除私密内容；`potContributions` 仍只统计普通投入。MCP 只读卡牌房公开信息，旧 Roll 和 `cards-v1` 房按原快照运行。以下 Roll、钻石与暂存说明仅适用于存量规则。

2026-11-03 卡牌/资金规则：新房使用 chips-v2；卡牌房仅供真人同源网页参与。发现 cardRulesVersion 或 ruleOptions.cards 时，不创建、入座、准备、开局、下注、Roll、claim、接入 AI 或请求真人回执；只可读取公开信息。POKER_CARD_AI_DISABLED 应停止循环，不尝试绕过控制权。没有能力牌 play/choose MCP 工具。普通无卡房继续支持 AI；程序陪练机器人只下注/Roll，不领能力牌。

能力牌每局真人初始随机3张、共享池抽取不放回、用后消耗、结算清空，下一局重新发牌。旧版卡牌房把费用放入通用“暂存”；原付款/原入座待分份额在最终释放前可受本局规则影响，不能当作已到手资产。名义下注与实付分开，有限豁免不生成筹码；旧NULL版本仍按旧冻结规则完成。报价含 payment 时保留其 version 作为 expectedPaymentVersion；实付看 paidAmount，钻石仍独立支付。以下历史冻结/费用说明只在对应旧规则或没有改动份额的场景下成立。

2026-11-02 钻石额度更新：建房可通过ruleOptions.rollCoins设置每手钻石，默认12，必须为1至2147483647之间的整数；创建后额度固定。普通/超级消耗固定1/3钻石，不提供费率配置；额度1或2时超级因钻石不足禁用。启用Roll的新手牌保存coinPolicy={limit:房间额度,normal:1,super:3}，各参赛者按本手全部成功start历史计算余额，跨阶段不补充、下一手恢复房间额度。刷新、重启、接管、离桌/回座不补充；仍另付筹码及冻结补偿，无购买、转让、兑换或钻石盈亏。旧房间缺rollCoins按12，旧手缺coinPolicy的历史兼容规则不变。

旧手缺coinPolicy沿旧规则完成，不从当前配置推断或追扣；旧响应隐藏钻石信息，现有房间下一手启用。原牌/候选隐私、原倒计时、控制权、行动资格不变。钻石快照损坏或透支显式拒绝，不默默补足。

RollQuote/PokerRollView增加可选coins={balance,limit}，RollOffer增加可选coinCost。table.state及wait本人报价共享引擎，待选wait额外含roll报价；建房请求增加可选ruleOptions.rollCoins，不增加工具/路由/迁移。公开视角不追加本人钻石报价或候选。机器人继续依可用报价行动。

首次接入：search发现`app_game_poker_guide`并invoke读规则（不需入座）→ `app_game_hall_overview`检查已有座位 → 没座位时先读取table_state（或room_get）核对该房控制历史和入座授权，再按下述规则入座。所有工具经Synapse的search/invoke调用；使用返回的准确名称和schema，不猜参数。Web 游戏中心本人可入座、出牌和接管，与AI共用同一个座位、当前手和筹码；Synapse不托管模型。

无卡房 Web 的列表与牌桌共用 AI 接入面板，首次“允许 AI 接入并复制指令”才申请授权，后续复制不改控制版本；关闭面板不取消授权，列表显示本人持续等待状态并可重新打开取消。lobby_list 的可选 myControl 只描述当前调用者，不代替入座前 table_state 和控制版本核对；缺字段不推定授权。邀请房间链接只打开房间，不自动入座或扣点。

建房省略 name 或传空白时，服务端以当前 Synapse 昵称和实际房间号命名，例如「李杨的房间 #123456」；自定义名称不改写。Web 游戏中心记忆的建房选项仅为当前浏览器、按账号隔离的表单偏好，MCP 不隐式继承，仍显式传入所需配置。

创建房间或新选手时生成creationId(UUID)，同一创建意图响应丢失后重试复用。新开另一桌需新UUID；同一新选手草稿编辑仍复用，返回选手id后只传id更新，不与creationId同传。同名同内容但明确另建也用新UUID，不按内容合并。入座和重连仍按账号+roomCode，没有座位令牌。

建房variant默认standard52；short32为7到A的32张牌，同花大于葫芦，A789T为最小顺子。ruleOptions.roll缺省false；开启时同时允许普通/超级，点数/陪练与两种牌组均适用，服务端把roll-v1固定到房间和每手，客户端不传价格版本。blindPreset可选1/2、2/4、5/10、10/20，默认1/2；房间模式、牌组和盲注创建后固定，按当前房规判断合法动作。完整规则见[规则](../references/rules.md)。

入座可传modelName，仅为自述展示，不校验或影响规则；不确定真实模型就留空，不编造。可绑定本人的agentId，空提示词合法。会话口述风格优先于每轮现读persona，仅本会话生效；只有明确要求保存才agent_upsert，不把临时风格写回游戏设置。

## 控制与行动

table_state/room_get可选公开handLog={handId,complete,entries}，绑定当前手牌。entries按seq排列，仅含seq/seatNo/displayName/street/action/amount/isAuto/actionSource及可选roll={kind,count,status}；street为preflop/flop/turn/river，action为small_blind/big_blind/fold/check/call/bet/raise/allin/roll，金额为实际追加或Roll费用。seq=-1/0为按本手初始筹码与规则恢复的实际小/大盲，正数沿用动作序号；choose不生成第二条，序号可有间隔。roll.status=pending/completed/replaced/cancelled，分别为待选/完成/被重抽替代/手牌取消，取消不表示费用到账。查询只取本手最近最多1000条原始动作，完整时额外含两笔盲注（最多1002项）；complete=false表示截断或缺口，不附加盲注，也不能算整手或各轮完整下注；缺字段表示不可用。姓名只取本手参赛快照，不公开userId/admissionId、底牌、候选、旧牌、槽位、note或persona。保留原recentActions最近30条普通行动及本人AI隐私；既有table.state/room.get只读扩展，无新工具、输入、路由、权限、迁移或写入。

底池公开来源：table_state/room_get可选potContributions={handId,status,total,players}，所有视角/受众统一白名单。status=pending|settled|cancelled，分别为本手进行中、已结算、已取消；total始终是本手普通累计投入，结算后hand.pot可为0，不声称来源金额仍在池中、可下注或取消已到账。players最多10项，仅含房间作用域不透明key、seatNo、displayName、isMe、folded、amount，金额为安全非负整数，各玩家合计严格等于total。含实际短筹码盲注、跟注/下注/加注/全下、弃牌已投入及后来未跟注退款/边池的累计投入；Roll start/choose费用和补偿均独立排除。热手取引擎累计total；冷归档从本手不可变participants初始筹码、庄家和规则恢复实际盲注，再加完整归档普通actions，不从最近30条动作、当前席位余额或动画反推。姓名和归属只取本手快照，同座新账号不继承；不公开userId/admissionId、牌面、候选、persona或note。来源缺失、序号不全、身份或金额损坏时省略字段，旧响应按不可用；已知amount=0才是该玩家没有投入。Web点击原底池区域查看，只读不暂停、不行动、不改变权限、资金和动画。不新增查询、工具、输入参数、路由、数据库字段或迁移。

Web的筹码堆与滚动金额只是展示：普通底池和Roll费用分开，派发完成后展示结算。可选chipState仅Web展示投影返回，MCP不依赖它；筹码颜色、动画进度不授予控制权、不延长行动窗口，也不代替结算shares、rollReceived或逐手准备。

座位删除不清除该房的永久控制历史。无座位时先看table_state/room_get的requiresJoinApproval：明确为false表示没有控制历史，可按用户原入座授权join，兼容首次入座；true表示有历史，必须handoffPending=true且携匹配controlVersion才可seat_join。controller=null不代表首次入座，不按版本0猜测；标记缺失或未知时先核实，不能推定首次。未授权时安全退出并提示用户在Web 游戏中心请求AI入座，不自动join或重扣点。control.set(request_ai)授予该入座授权，cancel_ai撤销；取消或版本变化就停止。control_claim只用于已有座位交接，不能替代无座位入座授权。

每次接手先overview、table_state；恢复会话另读checkpoint_get。controller=human时不出牌；只有用户已通过Web 游戏中心请求AI托管、handoffPending=true且当前controlVersion一致时，才control_claim接受。真人接管会立即撤销旧AI动作和座位写权，不回滚已提交动作、不延长600秒。收到control_released或控制版本不符时退出循环，不重新认领、不改回座位状态。不得以过期请求覆盖用户暂停、离桌或接管。

```text
重读Skill与poker_guide；overview() → table_state(roomCode)
确认本次用户继续意图、座位状态和AI控制权；无座位且有历史仅接受Web 游戏中心入座授权并带版本join，已有座位才claim交接
sessionStyle = 当前会话口述风格或安全恢复的检查点风格
cursor = 当前游标或已验证检查点游标
while 当前用户授权、AI控制版本有效且未到上下文维护点:
    result = table_wait(roomCode, cursor, timeoutMs=25000)
    if result.status == "roll_choice_required":
        核对当前AI控制权；按用户风格/预算选择当前候选或付费重抽
        选择时roll_choose携原rollId、候选下标、当前controlVersion/actionSeq及新actionId(UUID)
        重抽时先读table_state新报价，以原cardIndex、确切expectedFee和当前版本/序号、新UUID发起roll_start
        旧候选成功后放回，已付费用不退，次数累加且不续时；失败保留原候选
        未知结果复用该UUID与全部参数核对；重读table_state，再恢复循环
    else if result.status == "your_turn":
        按sessionStyle或现读persona判断；只读决策投影，不读取教学明牌
        先读roll报价、可用状态、共享次数和累计成本，决定本次是否换牌
        若选择Roll：确认当前确切fee；roll_start携kind/cardIndex/expectedFee及手牌/阶段/版本/UUID
        start后重读；choice_required先选择当前候选或按上述规则付费重抽；完成待选后重新报价或正常act，不能沿用旧actionSeq
        不换牌时继续下面正常下注流程
        以legalActions/toCall/minRaiseTo/maxRaiseTo为硬边界
        生成actionId(UUID)，携带handId/street/controlVersion/expectedActionSeq及action/to?
        action_act；有会话风格时personaSource=session；note最多200字单行
        响应未知只用相同actionId重试同一动作，不另发动作
    else if result.status == "hand_result":
        只保留handNo/result/delta/stack，按handNo去重；记录维护计数
    else if result.status == "ready_required":
        核对用户继续意图、当前AI控制版本及维护点
        用户仍授权继续且无需维护时，显式seat_ready(roomCode, handId=result.handId, controlVersion=result.controlVersion)
        已准备只继续wait；旧手信号过期先重读table_state，不换handId盲重发
    else if result.status == "control_released":
        立即退出；不重新认领或回座
    else if result.status == "table_closed":
        overview确认状态；退出，不自动重新扣点入座
    cursor = result.cursor
```

每次行动使用服务端当前controlVersion和actionSeq，旧MCP省略版本仅初始epoch0兼容。控制变更后不得省略版本绕过检查。真人动作不绑定AI persona或note；程序机器人始终由程序策略控制，不由外部AI代操作。

seat_sit的sittingOut确认请求值；pending=true表示当前手未结束，status是实际状态。用户明确立即叫停时停止调用，不能承诺已暂离，当前手仍适用600秒超时；只有用户允许打完本手才继续完成直到实际sitting_out。用户暂停传reason=user。已有sitting_out座位仅查看或重连不自动回座；用户明确继续或符合下述维护恢复条件，才seat_sit(false)，无需重新join。暂离wait只返回waiting。连续暂离30分钟无进行中手牌会被清退，查询或重复申请不续期。

hand_result后推进cursor并继续接终局，离桌、输光、解散可能先补结算再table_closed；stack=0也不跳过最终确认。重放按handNo去重，空cursor只接当前牌况。需要日志时table_events按cursor分页，limit最多100，hasMore=true继续，按(handNo,seq,kind)去重；结算seq=2147483647。不要每轮拉全量history/detail或把整手报文留在上下文。

首局房主免准备，不主动调用seat_ready，其他可参与者准备后由房主手动开始；后续每手结束后房主也须准备，Web房主在结算内准备成功返回牌桌，再等全员准备后从牌桌手动开始；加入、准备和后台调度不自动开局。首局seat_ready的handId传null，后续传当前结算handId。房主只有在用户明确要求开始时调用app_game_poker_room_start(roomCode,handId,controlVersion)，不得仅凭继续意图自动开始。程序陪练自动准备；真人需手动点击，AI必须在继续意图有效时明确调用seat_ready，不能代其他座位准备。查询、心跳、关闭结算、回座和普通重连都不代表准备。所有仍有筹码且未暂离/待离桌的座位（含下一手新加入者，首局房主除外）都需准备；至少两人且至少一个非程序陪练。先完成本手结果确认与上下文维护判断，再发准备信号；准备绑定首局null或已结算handId和controlVersion，迟到信号不能授权后续手。

## Roll 决策

table_state/room_get可选返回公开只读rollLedger={handId,status,players,entries}：status为pending（本手冻结待结算）、released（已结算释放）或cancelled（已取消，不代表到账）；players仅含房间作用域不透明key、seatNo、displayName、isMe、folded，身份和姓名来自本手参赛快照，不按当前占座者重写。entries按真实顺序保留本手所有成功start，每项为id/payerKey/kind/street/fee/compensations，compensations仅含接收者key和amount；每笔全额守恒，choose不新增，超级待选重抽保留每次已付费start。接收者后来弃牌或离桌仍保留原分配，同座新账号不继承；不公开账号ID、入座ID、旧牌、候选或槽位。缺字段表示暂不可用，entries=[]才表示暂无费用；不可从动画筹码堆、recentActions或rollStats倒推完整明细，不因查询明细发起写入。Web点击Roll费用查看本手来源、去向和逐笔分配，不增加工具、请求参数或权限。

table_state/room_get可选返回rollStats：hand为本手、room为房间创建以来累计（含本手），均有players/count/paid；seats按当前/历史回显seatNo映射该账号的hand/room次数和支出，以房间作用域不透明key区分同名玩家。按账号累计，不按座位号或显示名合并；换座/重进不重置，同座位换人不继承。成功start计一次，超级choose不重复计数和花费；缺统计不推断为零。统计是公开行为，不代表掌握对手牌力，不为查询统计调用Roll写入，也不按他人次数替代本人报价。Web通过点击玩家区域查看，不常驻牌桌；不增加工具或输入参数。

Roll 是可选玩法，不要求每轮使用。遵守用户会话风格、预算与风险限制，比较保留现有牌、普通随机换一张和超级三选一；不承诺必赚或把有限程序策略当最优。普通与超级共享本人本手次数，跨阶段不重置；每次费用提高累计成本。先指定第0或1张旧牌，超级开始后不能改槽、撤回或重抽；只有本人可读旧牌位置和三个候选，教学权限也不扩候选。候选不可转述到公开日志。

每次从table_state或your_turn读取roll.{enabled,count,normal,super}，以available及当前fee为硬边界；需stack严格大于费用。只在翻前/翻牌/转牌当前本人行动点使用，河牌关闭。费用独立于下注、不计跟注额，不续600秒。补偿给当时其他未弃牌者（含全下者），本手冻结不可花；普通派彩后按原入座释放，已离座点数归原账号，练习补偿离桌清零。Hall pending计入total/netProfit，不计available；结算delta为含Roll的总净变化。

以下仅为参数示例，必须替换为当前真实room/hand/street/报价/版本/序号及新UUID，不照抄：

```json
{"tool":"app_game_poker_roll_start","params":{"roomCode":"123456","handId":"current-hand","street":"preflop","expectedActionSeq":3,"controlVersion":2,"actionId":"8529bfca-a8e8-4de4-89da-162f516d2f01","kind":"super","cardIndex":1,"expectedFee":8}}
```

返回choice_required后，读取原pending的rollId/candidates，再明确选择；choose不再次收费或增加次数：

```json
{"tool":"app_game_poker_roll_choose","params":{"roomCode":"123456","handId":"current-hand","rollId":"8529bfca-a8e8-4de4-89da-162f516d2f01","candidateIndex":0,"expectedActionSeq":4,"controlVersion":2,"actionId":"8529bfca-a8e8-4de4-89da-162f516d2f02"}}
```

恢复顺序：读报价→决定→start→必须choose→重读→正常act。pending存在时不能普通下注或再次start。关闭网页/面板、断线、重启和接管不取消原候选；原deadline到期先取第一张候选再执行超时撤出。control_released或用户接管立即停止AI写入，不能为完成候选重新claim。未知start/choose结果保留原operation、UUID与全部参数，先重读再同请求确认永久回执；控制变化后仅确认旧成功动作，不提交新的过期意图。费用过期只重读并重新决定，不自动接受新费用。每个新动作才新UUID，不将旧UUID跨档、跨槽、跨候选、跨账号或跨房复用。

## 上下文维护与恢复

每完成10手或运行15分钟检查上下文；宿主报告压力时提前维护。没有可靠用量读数时按上述周期维护，不能无限循环耗尽上下文。

1. 保存继续意图，携当前controlVersion申请seat_sit(true, reason=context_maintenance)。本手仍在进行时保持合法行动，直至完成本手、实际status=sitting_out且pending=false；确认没有尚未确认的act/start/choose且没有待选候选。申请暂离不等于实际安全点。
2. 调用checkpoint_save(roomCode, controlVersion, cursor, sessionStyle?, continueIntent)。检查点由服务端按本人私有保存，含pauseReason=context_maintenance和savedAt；不写项目文件，不保存对手暗牌、完整报文或凭证。
3. 只有宿主确实提供原生上下文压缩能力时才调用并检查成功结果。不得用shell执行或伪称执行`/compact`。能力不可用、压缩失败或结果不明时，保留已确认暂离与检查点，安全退出并提示用户手动压缩/继续；不得继续循环等到上下文耗尽。
4. 压缩或新会话恢复后，重新读取本Skill、poker_guide、overview、checkpoint_get及table_state。核对roomCode、controlVersion、AI控制权、continueIntent=true、pauseReason=context_maintenance与实际sitting_out；当前用户的新指令优先。只有维护检查点仍有效、未被真人接管或改为用户暂停时才回座继续，恢复临时sessionStyle和cursor。
5. 用户暂停、离桌、接管、取消托管或control_released均使维护继续意图失效，不自动恢复。座位被清退后不重新join、不自动重扣点；报告当前状态，等待明确新入座授权。

行动窗口600秒（10分钟），正常行动通常几秒；wait单次25秒独立。60秒无调用仅标掉线，600秒无行动能check则记check，否则fold，但都会撤出本手并离场退款，不能继续争夺底池。lastAutoAction仅通知一次，收到后overview核对。

一桌一个会话最可靠。必须多桌时按overview.deadlineMs排序、timeoutMs=1000短轮询轮转，优先最急行动点。网络/协议错误按[协议与错误恢复](../references/protocol.md)处理；GAME_INVALID_RESPONSE不代表写入失败，未知act/start/choose保持原actionId、创建保持原creationId。

## 程序机器人陪练房

房主可从Web 游戏中心大厅解散陪练房：现有座位及未结算当前手均只有房主账号与机器人时立即解散，房主亲自操作或AI控制均适用；中断手不计已完成战绩，wait返回table_closed，已有已完成结果仍可补发。有其他账号参与时仍本手结束后解散，不兑换大厅点数。解散仅Web 游戏中心私有操作，无room_close MCP工具，不用离桌冒充解散。

room_create(mode=practice)→房主bot_add(roomCode,creationId=UUID)→正常入座/行动。每个新机器人新UUID，丢响应重试复用；bot_remove(roomCode,botId)的pending表示手后移除。移除后旧UUID不复活机器人，实际座位用room/table确认。仅房主管理，至少保留一位真人容量。

陪练全桌练习筹码，不扣兑大厅点数、不计正式战绩；mode创建后固定，移除全部机器人也不转换。lobby_list/history/stats默认points，查练习明确mode=practice；lobby_list可用mode=all合并两类房间统一分页，Web 游戏中心房间列表采用此方式并标明每间房的类型。all不能用于建房或历史/统计。机器人不调用模型、不被真人或外部AI代行动、不被催促；决策只接本人及公开信息，MCP决策也不得读取教学明牌。无人类可参赛时不发新手，输光不补。actionSource=rules_bot与human/mcp/timeout分开。
