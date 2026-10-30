---
name: poker
description: 用户要求德州扑克、德扑、打牌、打扑克、入座、开一桌、看我在打什么时，通过Synapse MCP参加无限注德州扑克。
---
# 德州扑克

首次接入：search发现`app_game_poker_guide`并invoke读规则（不需入座）→ `app_game_hall_overview`检查已有座位 → 没座位时先读取table_state（或room_get）核对该房控制历史和入座授权，再按下述规则入座。所有工具经Synapse的search/invoke调用；使用返回的准确名称和schema，不猜参数。桌面本人可入座、出牌和接管，与AI共用同一个座位、当前手和筹码；Synapse不托管模型。

创建房间或新选手时生成creationId(UUID)，同一创建意图响应丢失后重试复用。新开另一桌需新UUID；同一新选手草稿编辑仍复用，返回选手id后只传id更新，不与creationId同传。同名同内容但明确另建也用新UUID，不按内容合并。入座和重连仍按账号+roomCode，没有座位令牌。

建房variant默认standard52；short32为7到A的32张牌，同花大于葫芦，A789T为最小顺子。blindPreset可选1/2、2/4、5/10、10/20，默认1/2；房间模式、牌组和盲注创建后固定，按当前房规判断合法动作。完整规则见[规则](../references/rules.md)。

入座可传modelName，仅为自述展示，不校验或影响规则；不确定真实模型就留空，不编造。可绑定本人的agentId，空提示词合法。会话口述风格优先于每轮现读persona，仅本会话生效；只有明确要求保存才agent_upsert，不把临时风格写回游戏设置。

## 控制与行动

座位删除不清除该房的永久控制历史。无座位时先看table_state/room_get的requiresJoinApproval：明确为false表示没有控制历史，可按用户原入座授权join，兼容首次入座；true表示有历史，必须handoffPending=true且携匹配controlVersion才可seat_join。controller=null不代表首次入座，不按版本0猜测；标记缺失或未知时先核实，不能推定首次。未授权时安全退出并提示用户在桌面请求AI入座，不自动join或重扣点。control.set(request_ai)授予该入座授权，cancel_ai撤销；取消或版本变化就停止。control_claim只用于已有座位交接，不能替代无座位入座授权。

每次接手先overview、table_state；恢复会话另读checkpoint_get。controller=human时不出牌；只有用户已通过桌面请求AI托管、handoffPending=true且当前controlVersion一致时，才control_claim接受。真人接管会立即撤销旧AI动作和座位写权，不回滚已提交动作、不延长600秒。收到control_released或控制版本不符时退出循环，不重新认领、不改回座位状态。不得以过期请求覆盖用户暂停、离桌或接管。

```text
重读Skill与poker_guide；overview() → table_state(roomCode)
确认本次用户继续意图、座位状态和AI控制权；无座位且有历史仅接受桌面入座授权并带版本join，已有座位才claim交接
sessionStyle = 当前会话口述风格或安全恢复的检查点风格
cursor = 当前游标或已验证检查点游标
while 当前用户授权、AI控制版本有效且未到上下文维护点:
    result = table_wait(roomCode, cursor, timeoutMs=25000)
    if result.status == "your_turn":
        按sessionStyle或现读persona判断；只读决策投影，不读取教学明牌
        以legalActions/toCall/minRaiseTo/maxRaiseTo为硬边界
        生成actionId(UUID)，携带handId/street/controlVersion/expectedActionSeq及action/to?
        action_act；有会话风格时personaSource=session；note最多200字单行
        响应未知只用相同actionId重试同一动作，不另发动作
    else if result.status == "hand_result":
        只保留handNo/result/delta/stack，按handNo去重；记录维护计数
    else if result.status == "control_released":
        立即退出；不重新认领或回座
    else if result.status == "table_closed":
        overview确认状态；退出，不自动重新扣点入座
    cursor = result.cursor
```

每次行动使用服务端当前controlVersion和actionSeq，旧MCP省略版本仅初始epoch0兼容。控制变更后不得省略版本绕过检查。真人动作不绑定AI persona或note；程序机器人始终由程序策略控制，不由外部AI代操作。

seat_sit的sittingOut确认请求值；pending=true表示当前手未结束，status是实际状态。用户明确立即叫停时停止调用，不能承诺已暂离，当前手仍适用600秒超时；只有用户允许打完本手才继续完成直到实际sitting_out。用户暂停传reason=user。已有sitting_out座位仅查看或重连不自动回座；用户明确继续或符合下述维护恢复条件，才seat_sit(false)，无需重新join。暂离wait只返回waiting。连续暂离30分钟无进行中手牌会被清退，查询或重复申请不续期。

hand_result后推进cursor并继续接终局，离桌、输光、解散可能先补结算再table_closed；stack=0也不跳过最终确认。重放按handNo去重，空cursor只接当前牌况。需要日志时table_events按cursor分页，limit最多100，hasMore=true继续，按(handNo,seq,kind)去重；结算seq=2147483647。不要每轮拉全量history/detail或把整手报文留在上下文。

## 上下文维护与恢复

每完成10手或运行15分钟检查上下文；宿主报告压力时提前维护。没有可靠用量读数时按上述周期维护，不能无限循环耗尽上下文。

1. 保存继续意图，携当前controlVersion申请seat_sit(true, reason=context_maintenance)。本手仍在进行时保持合法行动，直至完成本手、实际status=sitting_out且pending=false；确认没有尚未确认的act。申请暂离不等于实际安全点。
2. 调用checkpoint_save(roomCode, controlVersion, cursor, sessionStyle?, continueIntent)。检查点由服务端按本人私有保存，含pauseReason=context_maintenance和savedAt；不写项目文件，不保存对手暗牌、完整报文或凭证。
3. 只有宿主确实提供原生上下文压缩能力时才调用并检查成功结果。不得用shell执行或伪称执行`/compact`。能力不可用、压缩失败或结果不明时，保留已确认暂离与检查点，安全退出并提示用户手动压缩/继续；不得继续循环等到上下文耗尽。
4. 压缩或新会话恢复后，重新读取本Skill、poker_guide、overview、checkpoint_get及table_state。核对roomCode、controlVersion、AI控制权、continueIntent=true、pauseReason=context_maintenance与实际sitting_out；当前用户的新指令优先。只有维护检查点仍有效、未被真人接管或改为用户暂停时才回座继续，恢复临时sessionStyle和cursor。
5. 用户暂停、离桌、接管、取消托管或control_released均使维护继续意图失效，不自动恢复。座位被清退后不重新join、不自动重扣点；报告当前状态，等待明确新入座授权。

行动窗口600秒（10分钟），正常行动通常几秒；wait单次25秒独立。60秒无调用仅标掉线，600秒无行动能check则记check，否则fold，但都会撤出本手并离场退款，不能继续争夺底池。lastAutoAction仅通知一次，收到后overview核对。

一桌一个会话最可靠。必须多桌时按overview.deadlineMs排序、timeoutMs=1000短轮询轮转，优先最急行动点。网络/协议错误按[协议与错误恢复](../references/protocol.md)处理；GAME_INVALID_RESPONSE不代表写入失败，未知act保持原actionId、创建保持原creationId。

## 程序机器人陪练房

room_create(mode=practice)→房主bot_add(roomCode,creationId=UUID)→正常入座/行动。每个新机器人新UUID，丢响应重试复用；bot_remove(roomCode,botId)的pending表示手后移除。移除后旧UUID不复活机器人，实际座位用room/table确认。仅房主管理，至少保留一位真人容量。

陪练全桌练习筹码，不扣兑大厅点数、不计正式战绩；mode创建后固定，移除全部机器人也不转换。lobby_list/history/stats默认points，查练习明确mode=practice。机器人不调用模型、不被真人或外部AI代行动、不被催促；决策只接本人及公开信息，MCP决策也不得读取教学明牌。无人类可参赛时不发新手，输光不补。actionSource=rules_bot与human/mcp/timeout分开。
