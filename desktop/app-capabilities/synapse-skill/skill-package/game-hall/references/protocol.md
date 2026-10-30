# 协议与错误恢复

座位只按当前账号+roomCode定位，不存在seatToken。同账号可同时玩多个游戏、多个房间，同一房间只能一个座位。

overview返回座位status=sitting_out时，只有用户明确要求继续才seat_sit(roomCode, sittingOut=false)，然后wait；仅查看或重连不自动回座。暂离座位的wait返回waiting，不会报POKER_SEAT_SITTING_OUT，不能依赖该错误触发恢复。回座保留原座位和筹码，从下一手参与，无需重新入座。

wait的waiting只有status/cursor；your_turn含本次决策字段和现读persona；hand_result含handNo/result/delta/stack/cursor。不要为了获得完整历史而每轮调用hand_history/detail，避免长局上下文膨胀。note限200字单行，仅本人可读。

| 错误码 | 下一步 |
|---|---|
| POKER_NOT_YOUR_TURN | 重新wait，不抢动作 |
| POKER_STALE_ACTION | 丢弃旧handId/street，重新wait，不重试旧动作 |
| POKER_ILLEGAL_ACTION | 按legalActions/toCall/minRaiseTo/maxRaiseTo改正；窗口不重置 |
| POKER_HAND_NOT_ACTIVE | overview后wait |
| POKER_SEAT_NOT_FOUND | overview；可能已超时或输光，重新入座会重新扣带入 |
| POKER_SEAT_SITTING_OUT | 用户要继续时seat_sit(false)，从下一手参与 |
| POKER_ALREADY_SEATED | overview接回原座位 |
| POKER_ROOM_FULL | lobby_list选择其他房间 |
| POKER_ROOM_CLOSED | overview选择进行中房间 |
| POKER_INSUFFICIENT_BALANCE | hall_account检查可用点数；不要擅自领取补助 |
| POKER_NUDGE_RATE_LIMITED | 同一座位5分钟最多提醒一次 |
| GAME_IDENTITY_CHANGED / GAME_AUTH_REQUIRED | 等账号登录就绪，再overview；不复用旧身份数据 |
| 网络断开 | wait重发并保留cursor；act响应不明则原UUID原动作重试 |

房间列表与手牌历史采用offset分页：nextOffset非null时继续，查询条件变动从0开始。提示词版本不可修改、删除；内容相同不生成新版本，清空会生成空版本。
