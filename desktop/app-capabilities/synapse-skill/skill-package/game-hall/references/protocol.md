# 协议与错误恢复

2026-11-02 房主开局规则（取代历史自动开局描述）：首局和每手结算后都必须全员准备，再由房主手动开始。入座、最后一人准备、回座、离桌、机器人管理和后台调度均不自动发牌；程序陪练仍自动准备，真人点击准备、AI显式seat.ready。首局准备与开始的handId为null，后续绑定当前结算handId；控制版本和原控制权限不变。新增app.game.poker.room.start（Web POST /game/poker/rooms/:code/start），只允许房主显式调用，已入座房主须持当前控制权；旧请求过期必须重读，不得盲重发或凭继续意图自动开始。复用座位status=ready，不新增数据库字段或迁移。

2026-11-02 钻石额度更新：建房可通过ruleOptions.rollCoins设置每手钻石，默认12，必须为1至2147483647之间的整数；创建后额度固定。普通/超级消耗固定1/3钻石，不提供费率配置；额度1或2时超级因钻石不足禁用。启用Roll的新手牌保存coinPolicy={limit:房间额度,normal:1,super:3}，各参赛者按本手全部成功start历史计算余额，跨阶段不补充、下一手恢复房间额度。刷新、重启、接管、离桌/回座不补充；仍另付筹码及冻结补偿，无购买、转让、兑换或钻石盈亏。旧房间缺rollCoins按12，旧手缺coinPolicy的历史兼容规则不变。

旧手缺coinPolicy沿旧规则完成，不从当前配置推断或追扣；旧响应隐藏钻石信息，现有房间下一手启用。原牌/候选隐私、原倒计时、控制权、行动资格不变。钻石快照损坏或透支显式拒绝，不默默补足。

RollQuote/PokerRollView增加可选coins={balance,limit}，RollOffer增加可选coinCost。table.state及wait本人报价共享引擎，待选wait额外含roll报价；建房请求增加可选ruleOptions.rollCoins，不增加工具/路由/迁移。公开视角不追加本人钻石报价或候选。机器人继续依可用报价行动。

Web牌桌可选 `chipState` 仅为公开展示投影：pot/roll分别按每笔实际付款累计面额计数，recent最多32笔公开id/seq/seatNo/amount/fund；不含候选、私牌或账号标识。501拆为500+1，五笔100不换500；Roll仅start记费。MCP的decision投影不返回此字段，缺字段不影响行动，不根据筹码堆推断资金或权限；余额、合法动作、shares和rollReceived仍以原权威字段为准。动画不延长服务端行动窗口，也不代替逐手准备。

Roll公开统计：table_state/room_get的rollStats.hand/room各含players/count/paid，room从创建以来累计且包含hand。seats最多10项，含seatNo、不透明key、hand/room的count/paid；按账号累计并映射到当前/历史回显座位，离桌重进/换座不重置，同座位换人不继承。只计算成功start，choose不重复。公开统计无私牌、旧槽或额外账号ID，不授予操作权限；旧响应无字段按不可用处理。Web点击玩家区域查看统计，保持桌面简洁，不新增分页或工具输入参数。

陪练mode=practice与点数房固定隔离，overview的funding标注会话类型。bot_add仅房主，必传UUID creationId；bot_remove按botId管理机器人，pending手后移除；POKER_BOT_NOT_ALLOWED表示房间、权限或目标不允许，不得改用act控制。创建重试保留UUID，不跨房复用，移除后旧标识不复活，查询座位确认。练习离桌丢弃本桌筹码，不扣兑点数；机器人actionSource=rules_bot不是真人超时提示。

座位只按当前账号+roomCode定位，不存在seatToken。同账号可同时玩多个游戏、多个房间，同一房间只能一个座位。

table_state/room_get 的 seats 可选返回 isHistorical、inCurrentHand。isHistorical=true 仅为上一手结果回显，不占当前房间容量、不能管理；inCurrentHand 按账号与座位共同匹配，false 表示未参与当前手，不能据牌背或座位编号推断已发牌。旧响应缺字段时不推断参与状态。机器人管理须使用当前有效 botId，leavePending=true 的真实座位仍占位；最终可入座容量以服务端裁决为准。两个展示标记不授予控制权或扩展底牌可见性。

seat_sit返回的sittingOut是请求确认；pending表示当前手尚未结束，status为实际座位状态。pending时立即停止调用仍适用600秒超时离桌，不能承诺已保留暂离座位。

连续暂离30分钟且房间无进行中的手牌时自动离桌退款；重复seat_sit(true)或查询不会延长该期限。手中申请暂离从本手结束实际生效时计时，实际回座后再次暂离重新计时。

服务停止时wait以暂时不可用结束，不能把该错误当成table_closed或重新入座的依据；服务恢复后先overview确认原座位。

overview返回座位status=sitting_out时，只有用户明确要求继续，或按扑克Skill完整核对有效context_maintenance检查点及继续意图后，才seat_sit(roomCode, sittingOut=false)，然后wait；仅查看或普通重连不自动回座。暂离座位的wait返回waiting，不会报POKER_SEAT_SITTING_OUT，不能依赖该错误触发恢复。回座保留原座位和筹码，从下一手参与，无需重新入座。

游标是handNo:actionSeq，两段都为0至2147483647的整数；2147483647的动作序号标记该手结算已读。非法或越界游标返回POKER_ILLEGAL_ACTION，重新overview接回，不盲重试旧游标。带cursor可补发本次入座的未读结算（包含归档），离桌/输光/手后解散时先hand_result再table_closed；空cursor只恢复当前牌况。按返回cursor推进，同一cursor重试按handNo去重。

本次入座结果和超时提示按服务端保存的牌局顺序边界归属，排队请求的时间乱序不会把旧入座事件带入新座位或漏掉本次结算。此边界不对外提供，接入参数和重连方式不变。

wait在控制权被释放时返回control_released，立即停止，不重新claim；waiting只有status/cursor；your_turn含本次决策字段、现读persona及可选rules/roll报价；hand_result含handNo/result/delta/stack/cursor。不要为了获得完整历史而每轮调用hand_history/detail，避免长局上下文膨胀。note限200字单行，仅本人可读。

| 错误码 | 下一步 |
|---|---|
| POKER_STALE_CONTROL | 控制版本已变更，停止当前AI写入并读取状态；不得自动重新认领或覆盖用户操作 |
| POKER_CONTROL_RELEASED | 停止AI循环，不重新认领、回座或覆盖用户操作 |
| POKER_NOT_YOUR_TURN | 重新wait，不抢动作 |
| POKER_STALE_ACTION | 明确拒绝后重读再决定；未知act/start/choose仍保留原UUID及完整参数，仅确认原请求 |
| POKER_ILLEGAL_ACTION | 按legalActions/toCall/minRaiseTo/maxRaiseTo改正；窗口不重置 |
| POKER_HAND_NOT_ACTIVE | overview后wait |
| POKER_SEAT_NOT_FOUND | overview；可能已超时或输光，点数房重新入座会扣带入，陪练房只重置本桌练习筹码 |
| POKER_SEAT_SITTING_OUT | 用户要继续时seat_sit(false)，从下一手参与 |
| POKER_ALREADY_SEATED | overview接回原座位 |
| POKER_ROOM_FULL | lobby_list选择其他房间 |
| POKER_ROOM_CLOSED | overview选择进行中房间 |
| POKER_INSUFFICIENT_BALANCE | hall_account检查可用点数；不要擅自领取补助 |
| POKER_NUDGE_RATE_LIMITED | 同一座位5分钟最多提醒一次 |
| GAME_IDENTITY_CHANGED / GAME_AUTH_REQUIRED | 等账号登录就绪，再overview；不复用旧身份数据 |
| GAME_INVALID_RESPONSE | 响应损坏，读取可重试；写结果未知，先overview或读取已保存对象确认，act保留原actionId，创建保留原creationId，不另发新动作 |
| 网络断开 | wait重发并保留cursor；act响应不明则原UUID原动作重试 |

房间列表与手牌历史采用offset分页：nextOffset非null时继续，查询条件变动从0开始。提示词版本不可修改、删除；内容相同不生成新版本，清空会生成空版本。

recentActions的displayName是本手行动人姓名快照；同一seatNo后来换人时仍表示原行动人，不要按当前seats姓名重写行动归属。

room_create与agent_upsert的新建流程支持可选creationId(UUID)，按当前账号和实体类型隔离。room_create同标识恢复首次房间（已解散也不另建），不改变旧房间参数；agent_upsert同标识定位同一新选手并按现有更新规则保存新编辑，内容不变不新增版本。获得选手id后只传id，id与creationId不能同传。未提供标识保留旧客户端行为；空选手id和非法创建标识会被拒绝。


控制权由入口决定，客户端不能传source/controller冒充；MCP act只作为AI动作，Web 游戏中心人工act不含note/personaSource。act可传controlVersion与expectedActionSeq，seat_sit/leave可传controlVersion；版本缺省只兼容初始epoch0。control_claim必传当前版本，仅接受本人已请求的handoff，接管后旧AI请求均失效。已提交actionId的原动作重试仍用于确认，不得换UUID再次下注。

table_events(roomCode,cursor?,limit?,perspective?)为游标分页，limit最多100，返回events/cursor/hasMore；hasMore=true继续，变更房间重开游标。事件kind为action、roll或settlement，按handNo、seq、kind去重；settlement的seq固定2147483647。重连按最新状态呈现，不重播所有旧动画。MCP事件默认owner且始终decision投影，即使传public也没有Web 游戏中心教学明牌；本人私密动作仅本人owner可读。UI事件默认public兼容旧调用，玩家视角必须传owner，日志与牌桌视角一致。

checkpoint_get返回{checkpoint:null|检查点}，checkpoint_save返回{checkpoint}。保存必传roomCode/controlVersion/cursor/continueIntent，sessionStyle可选；服务端填savedAt和context_maintenance原因。必须完成本手、真正暂离并解决未确认act后保存。保存成功也不代表宿主已压缩，原生压缩结果必须独立确认。恢复须重新读Skill/guide/overview/checkpoint/state，控制epoch、AI控制、继续意图和维护暂停均一致才回座；用户接管、暂停或离桌优先，不能借检查点重新扣点入座。


离桌删除座位仍保留永久控制历史。无座位先table_state或room_get检查requiresJoinApproval：false明确表示无控制历史，可按用户原入座授权首次join；true表示有历史，controller=null、handoffPending仅表示Web 游戏中心通过control.set(request_ai)明确授权AI重新入座，必须授权有效且携匹配controlVersion。标记缺失或未知不推定首次，不能按版本0判断。seat_join可带controlVersion；有历史必须当前版本匹配且入座授权有效，不能用旧MCP裸join绕过接管并重新扣点。cancel_ai撤销该授权；已有座位仍用control_claim接受交接。首次无控制历史的旧MCP入座兼容不变，未核实历史不能推定为首次。

## 每手准备屏障

首局和每手结算后均等待全员准备，nextHandAt为空；所有仍可参赛座位准备后，由房主显式room.start才发下一手。程序陪练自动准备；真人通过Web点击；AI必须显式app_game_poker_seat_ready(roomCode,handId,controlVersion)。wait可返回ready_required，携首局null或当前结算手牌和控制版本；已准备返回waiting。先补hand_result和处理维护点，再按用户继续意图准备。暂离/离桌/无筹码/历史回显座位不计入，新加入及回座者不自动准备。旧handId返回POKER_STALE_ACTION，重读而不把信号迁移到新手；响应丢失先table_state核对，本手仍等待时才以相同参数重试。准备不修改资金，也不构成未来多手的准备授权。

## Roll 严格写入与恢复

公开工具新增app_game_poker_roll_start/choose，均经search/invoke，Web对应POST /game/poker/rooms/:code/roll/start或roll/choose，无桌面IPC。start必传roomCode/handId/street(preflop、flop、turn)/expectedActionSeq/controlVersion/actionId(UUID)/kind(normal或super)/cardIndex(0或1)/expectedFee(正整数)；choose必传roomCode/handId/rollId/candidateIndex(0..2)/expectedActionSeq/controlVersion/actionId(UUID)。不得传来源、定价版本或目标账号/座位。

成功均为{ok:true,handId,rollId,actionSeq,cursor,status:completed|choice_required}，start的actionId就是rollId。super开始后table_state.roll.pending={rollId,cardIndex,candidates}仅本人可见；wait先保留control_released与未读结果优先级，再返回roll_choice_required，包含handId/handNo/controlVersion/actionSeq/deadlineMs/cursor及原pending字段。本人可choose，或读取table_state的当前报价后在原cardIndex以新UUID再次start（normal/super均可）；重抽成功才回收旧候选，旧费用与补偿不退，个人次数累加，旧候选不可再选。失败保留原待选，普通下注仍需先完成待选。未知结果先核对原UUID，不把start的旧序号用于新动作。历史privateRolls中selectedIndex=null也可能是未选候选便继续重抽的记录；当前待选只认roll.pending。

网络超时、断线或GAME_INVALID_RESPONSE不能证明写入失败。保留operation、UUID与所有语义参数，先读state，再原请求确认永久回执；服务器先查已成功回执，再核对新写入控制权。不得因手牌/控制版本变化、关闭面板或刷新而换UUID重抽；不同意图复用同UUID被拒绝。收到POKER_ROLL_PRICE_CHANGED时本次事务无副作用，重读报价后重新决定并明确确认新费用，不自动接受新价。POKER_ROLL_*不可用或非法原因按当前状态处理；控制释放立即停止新写入，确认旧回执不授权新动作。

公开roll事件仅kind/phase/fee/count/seatNo/displayName/source/compensations；phase=start才产生支出和补偿，phase=choose保留原fee作审计、不重复记账。detail的rollHistory公开，privateRolls仅原手本人可见；不能把privateRolls/候选/oldCard/旧牌位置塞入公开日志。旧响应缺roll或rollHistory按未开启/空记录，缺财务字段按0兼容，不能推断未知私牌。
