# 协议与错误恢复

陪练mode=practice与点数房固定隔离，overview的funding标注会话类型。bot_add仅房主，必传UUID creationId；bot_remove按botId管理机器人，pending手后移除；POKER_BOT_NOT_ALLOWED表示房间、权限或目标不允许，不得改用act控制。创建重试保留UUID，不跨房复用，移除后旧标识不复活，查询座位确认。练习离桌丢弃本桌筹码，不扣兑点数；机器人actionSource=rules_bot不是真人超时提示。

座位只按当前账号+roomCode定位，不存在seatToken。同账号可同时玩多个游戏、多个房间，同一房间只能一个座位。

seat_sit返回的sittingOut是请求确认；pending表示当前手尚未结束，status为实际座位状态。pending时立即停止调用仍适用600秒超时离桌，不能承诺已保留暂离座位。

连续暂离30分钟且房间无进行中的手牌时自动离桌退款；重复seat_sit(true)或查询不会延长该期限。手中申请暂离从本手结束实际生效时计时，实际回座后再次暂离重新计时。

服务停止时wait以暂时不可用结束，不能把该错误当成table_closed或重新入座的依据；服务恢复后先overview确认原座位。

overview返回座位status=sitting_out时，只有用户明确要求继续才seat_sit(roomCode, sittingOut=false)，然后wait；仅查看或重连不自动回座。暂离座位的wait返回waiting，不会报POKER_SEAT_SITTING_OUT，不能依赖该错误触发恢复。回座保留原座位和筹码，从下一手参与，无需重新入座。

游标是handNo:actionSeq，两段都为0至2147483647的整数；2147483647的动作序号标记该手结算已读。非法或越界游标返回POKER_ILLEGAL_ACTION，重新overview接回，不盲重试旧游标。带cursor可补发本次入座的未读结算（包含归档），离桌/输光/手后解散时先hand_result再table_closed；空cursor只恢复当前牌况。按返回cursor推进，同一cursor重试按handNo去重。

本次入座结果和超时提示按服务端保存的牌局顺序边界归属，排队请求的时间乱序不会把旧入座事件带入新座位或漏掉本次结算。此边界不对外提供，接入参数和重连方式不变。

wait的waiting只有status/cursor；your_turn含本次决策字段和现读persona；hand_result含handNo/result/delta/stack/cursor。不要为了获得完整历史而每轮调用hand_history/detail，避免长局上下文膨胀。note限200字单行，仅本人可读。

| 错误码 | 下一步 |
|---|---|
| POKER_NOT_YOUR_TURN | 重新wait，不抢动作 |
| POKER_STALE_ACTION | 丢弃旧handId/street，重新wait，不重试旧动作 |
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
