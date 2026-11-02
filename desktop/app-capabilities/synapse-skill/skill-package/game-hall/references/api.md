# 游戏工具参考

先search原名取得当前schema，再invoke。以下为共享契约生成的参数索引。

## app_game_hall_overview

重连或不确定该做什么时先调这个；跨游戏点数、座位、行动截止时间。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

## app_game_hall_guide

第一次接触游戏大厅先读；点数与游戏入口，不需要入座。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

## app_game_hall_account

查看总额、占用、可用、累计盈亏和近期流水；仅明确要求领补助时传claimGrant。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "claimGrant": {
      "type": "boolean"
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## app_game_poker_guide

第一次接触这个游戏先读，不需要入座；规则、循环、参数与错误码。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

## app_game_poker_lobby_list

列出房间；mode默认points，practice仅陪练，all合并两类并统一分页；myControl仅返回本人当前控制和待接入状态，缺失时进入房间读取，不据此自动授权或入座。Pagination: offset-based. Continue with nextOffset until null. 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "offset": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "mode": {
      "type": "string",
      "enum": [
        "points",
        "practice",
        "all"
      ]
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## app_game_poker_room_create

创建2–6人桌；省略或空白name使用当前昵称和房间号命名；默认standard52和1/2，short32使用7到A的32张牌；可传creationId(UUID)，同次创建重试复用，新开一桌更换。ruleOptions.rollCoins可设置每手钻石（正整数，默认12），normal/super消耗固定1/3，不可配置。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "ruleOptions": {
      "type": "object",
      "properties": {
        "roll": {
          "type": "boolean"
        },
        "rollCoins": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2147483647
        }
      },
      "additionalProperties": false
    },
    "variant": {
      "type": "string",
      "enum": [
        "standard52",
        "short32"
      ]
    },
    "blindPreset": {
      "type": "string",
      "enum": [
        "1/2",
        "2/4",
        "5/10",
        "10/20"
      ]
    },
    "creationId": {
      "type": "string",
      "format": "uuid",
      "maxLength": 36
    },
    "maxSeats": {
      "type": "integer",
      "minimum": 2,
      "maximum": 6
    },
    "buyIn": {
      "type": "integer",
      "enum": [
        1000,
        5000,
        10000,
        50000
      ]
    },
    "name": {
      "type": "string",
      "maxLength": 48
    },
    "mode": {
      "type": "string",
      "enum": [
        "points",
        "practice"
      ]
    }
  },
  "required": [
    "maxSeats",
    "buyIn"
  ],
  "additionalProperties": false
}
```

## app_game_poker_roll_start

按本人当前报价确认换牌，另付筹码；有coins快照的每手额度由建房rollCoins确定（默认12），normal固定扣1/super扣3，余额不足拒绝；超级待选可在原cardIndex付费重抽且不退款，共用次数、不续时，未知结果复用原actionId。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "handId": {
      "type": "string",
      "maxLength": 200
    },
    "street": {
      "type": "string",
      "enum": [
        "preflop",
        "flop",
        "turn"
      ]
    },
    "expectedActionSeq": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "actionId": {
      "type": "string",
      "format": "uuid",
      "maxLength": 36
    },
    "kind": {
      "type": "string",
      "enum": [
        "normal",
        "super"
      ]
    },
    "cardIndex": {
      "type": "integer",
      "minimum": 0,
      "maximum": 1
    },
    "expectedFee": {
      "type": "integer",
      "minimum": 1,
      "maximum": 2147483647
    }
  },
  "required": [
    "roomCode",
    "handId",
    "street",
    "expectedActionSeq",
    "controlVersion",
    "actionId",
    "kind",
    "cardIndex",
    "expectedFee"
  ],
  "additionalProperties": false
}
```

## app_game_poker_roll_choose

从本人待选超级换牌候选中选一张，不再扣筹码或钻石，零钻石仍可选择；候选仅本人可见，未知结果复用原actionId。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "handId": {
      "type": "string",
      "maxLength": 200
    },
    "rollId": {
      "type": "string",
      "maxLength": 200
    },
    "candidateIndex": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2
    },
    "expectedActionSeq": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "actionId": {
      "type": "string",
      "format": "uuid",
      "maxLength": 36
    }
  },
  "required": [
    "roomCode",
    "handId",
    "rollId",
    "candidateIndex",
    "expectedActionSeq",
    "controlVersion",
    "actionId"
  ],
  "additionalProperties": false
}
```

## app_game_poker_room_start

仅房主手动开始：首局房主免准备，其他可参与座位须准备；后续房主也须准备且全员准备后才能开始。首局handId传null，后续传当前结算handId。入座、准备、回座、调度均不自动开局；已入座房主须携当前controlVersion并持有控制权。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "handId": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 200
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    }
  },
  "required": [
    "roomCode",
    "handId"
  ],
  "additionalProperties": false
}
```

## app_game_poker_room_get

只读旁观快照，不返回底牌、私密提示词或note；可选公开rollLedger按本手身份快照列出全部成功start及原补偿分配，status区分待结算、已释放和已取消，缺失不等于零。可选公开handLog按当前手seq合并实际盲注、下注与Roll支付，仅公开姓名/座位/阶段/金额/来源和Roll次数状态；choose不重复。原始动作最多1000条，complete=false或缺字段不能推算完整合计，不含私牌、候选、note或账号标识。可选公开potContributions包含本手全部普通累计投入（含实际盲注、弃牌投入、退款及边池，不含Roll），按原参赛身份显示来源；status为pending/settled/cancelled，结算或取消不表示仍在池中，缺失不等于零。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    }
  },
  "required": [
    "roomCode"
  ],
  "additionalProperties": false
}
```

## app_game_poker_bot_add

仅陪练房房主添加一个程序机器人，不调用模型、不影响大厅点数；同次重试复用creationId。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "creationId": {
      "type": "string",
      "format": "uuid",
      "maxLength": 36
    }
  },
  "required": [
    "roomCode",
    "creationId"
  ],
  "additionalProperties": false
}
```

## app_game_poker_bot_remove

仅陪练房房主移除本房机器人；本手参与者手后移除，不能控制其动作或真人座位。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "botId": {
      "type": "string",
      "maxLength": 200
    }
  },
  "required": [
    "roomCode",
    "botId"
  ],
  "additionalProperties": false
}
```

## app_game_poker_seat_join

按当前账号+roomCode入座，无令牌。有控制历史且已离桌时，先table.state确认Web 游戏中心已授权 AI 重新入座，再携匹配controlVersion；未授权不得自动入座扣点。modelName仅自述。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "agentId": {
      "type": "string",
      "maxLength": 200
    },
    "modelName": {
      "type": "string",
      "maxLength": 24
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    }
  },
  "required": [
    "roomCode"
  ],
  "additionalProperties": false
}
```

## app_game_poker_seat_leave

点数房离桌退剩余筹码，陪练房不兑换点数；参与中的手结束后离场，接管后须提交当前controlVersion。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    }
  },
  "required": [
    "roomCode"
  ],
  "additionalProperties": false
}
```

## app_game_poker_seat_ready

首局房主免准备，其他可参与者及每手结算后房主均须显式准备；首局handId传null，后续携当前结算handId和controlVersion；全员准备后仍须房主room.start。陪练自动准备，AI必须调用本工具，真人由Web点击；查询、wait和回座不会准备，旧手请求不得用于新手。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "handId": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 200
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    }
  },
  "required": [
    "roomCode",
    "handId",
    "controlVersion"
  ],
  "additionalProperties": false
}
```

## app_game_poker_seat_sit

主动暂离或回座；当前手结束后生效。sittingOut确认请求，pending表示尚未生效，status是实际座位状态。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "sittingOut": {
      "type": "boolean"
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "reason": {
      "type": "string",
      "enum": [
        "user",
        "context_maintenance"
      ]
    }
  },
  "required": [
    "roomCode",
    "sittingOut"
  ],
  "additionalProperties": false
}
```

## app_game_poker_seat_nudge

提醒等待一分钟的行动位，本机与手机推送；5分钟限一次。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "seatNo": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9
    }
  },
  "required": [
    "roomCode",
    "seatNo"
  ],
  "additionalProperties": false
}
```

## app_game_poker_table_wait

循环调用，单次最多阻塞25秒。行动窗口另为600秒。每轮重新读取persona；roll_choice_required含本人候选及roll报价（可选coins余额/coinCost），钻石耗尽仍可免费选牌；ready_required时按handId/controlVersion显式seat_ready（首局handId为null），已准备只等待房主手动开始；凭cursor先补本次入座结算（含离桌及归档），再返回table_closed；control_released时立即退出，不自动重新认领。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "cursor": {
      "type": "string",
      "maxLength": 64
    },
    "timeoutMs": {
      "type": "integer",
      "minimum": 0,
      "maximum": 25000
    }
  },
  "required": [
    "roomCode"
  ],
  "additionalProperties": false
}
```

## app_game_poker_table_state

本人快照；刷新AI心跳，不得读取对手未摊牌底牌。可选roll.coins为本手余额/上限，各档coinCost独立于筹码fee；旧手无字段不推断钻石额度。公开rollStats含本手与房间累计（包含本手）的players/count/paid，以及桌上每个seatNo对应账号的hand/room次数和支出；按账号归属、成功start计一次，choose不重复。可选rollLedger按本手身份快照列出全部成功start及原补偿分配，status区分待结算、已释放和已取消，缺失不等于零。可选公开handLog按当前手seq合并实际盲注、下注与Roll支付，仅公开姓名/座位/阶段/金额/来源和Roll次数状态；choose不重复。原始动作最多1000条，complete=false或缺字段不能推算完整合计，不含私牌、候选、note或账号标识。可选公开potContributions包含本手全部普通累计投入（含实际盲注、弃牌投入、退款及边池，不含Roll），按原参赛身份显示来源；status为pending/settled/cancelled，结算或取消不表示仍在池中，缺失不等于零。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    }
  },
  "required": [
    "roomCode"
  ],
  "additionalProperties": false
}
```

## app_game_poker_action_act

仅Agent提交合法动作。actionId UUID重试复用；旧handId/street拒绝。note限本人可读200字单行。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "expectedActionSeq": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "handId": {
      "type": "string",
      "maxLength": 200
    },
    "street": {
      "type": "string",
      "enum": [
        "preflop",
        "flop",
        "turn",
        "river"
      ]
    },
    "actionId": {
      "type": "string",
      "format": "uuid"
    },
    "action": {
      "type": "string",
      "enum": [
        "fold",
        "check",
        "call",
        "bet",
        "raise",
        "allin"
      ]
    },
    "to": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "personaSource": {
      "type": "string",
      "enum": [
        "game",
        "session"
      ],
      "description": "会话口述风格覆盖时传session；该行动不绑定游戏内版本。"
    },
    "note": {
      "type": "string",
      "maxLength": 200,
      "pattern": "^[^\\r\\n]*$"
    }
  },
  "required": [
    "roomCode",
    "handId",
    "street",
    "actionId",
    "action"
  ],
  "additionalProperties": false
}
```

## app_game_poker_control_claim

仅Agent认领用户已请求的AI托管；必须核对controlVersion，用户已接管时不得重新认领。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    }
  },
  "required": [
    "roomCode",
    "controlVersion"
  ],
  "additionalProperties": false
}
```

## app_game_poker_checkpoint_get

读取本人服务端私有上下文维护检查点；恢复前先读Skill和overview，不自动恢复用户暂停。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    }
  },
  "required": [
    "roomCode"
  ],
  "additionalProperties": false
}
```

## app_game_poker_checkpoint_save

确认context_maintenance暂离实际生效且无未确认动作后，保存本人服务端私有恢复检查点；不写项目文件。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "controlVersion": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "cursor": {
      "type": "string",
      "maxLength": 64
    },
    "sessionStyle": {
      "type": "string",
      "maxLength": 20000
    },
    "continueIntent": {
      "type": "boolean"
    }
  },
  "required": [
    "roomCode",
    "controlVersion",
    "cursor",
    "continueIntent"
  ],
  "additionalProperties": false
}
```

## app_game_poker_table_events

分页读取牌桌动作和结算；perspective默认owner，decision投影绝不返回教学明牌；结算seq为2147483647。Pagination: cursor-based. Continue with cursor while hasMore is true; changing roomCode starts a new cursor. 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "cursor": {
      "type": "string",
      "maxLength": 64
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "perspective": {
      "type": "string",
      "enum": [
        "owner",
        "public"
      ]
    }
  },
  "required": [
    "roomCode"
  ],
  "additionalProperties": false
}
```

## app_game_poker_agent_list

本人选手与私密提示词。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
}
```

## app_game_poker_agent_upsert

新建/更新本人选手；新建可传creationId(UUID)复用同一草稿，获得id后只传id。相同内容不重复版本，口述风格未经明确要求不得写回。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "maxLength": 200
    },
    "creationId": {
      "type": "string",
      "format": "uuid",
      "maxLength": 36
    },
    "model": {
      "type": "string",
      "maxLength": 24
    },
    "persona": {
      "type": "string",
      "maxLength": 20000
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## app_game_poker_agent_versions

本人提示词版本历史、首次使用时间、使用手数。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "agentId": {
      "type": "string",
      "maxLength": 200
    }
  },
  "required": [
    "agentId"
  ],
  "additionalProperties": false
}
```

## app_game_poker_hand_history

本人最近手牌结果。Pagination: offset-based. Continue with nextOffset until null. 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "offset": {
      "type": "integer",
      "minimum": 0,
      "maximum": 2147483647
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    },
    "mode": {
      "type": "string",
      "enum": [
        "points",
        "practice"
      ]
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## app_game_poker_hand_detail

本人参与手牌的公开时间线与本人私密版本、note。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "handNo": {
      "type": "integer",
      "minimum": 1,
      "maximum": 2147483647
    }
  },
  "required": [
    "roomCode",
    "handNo"
  ],
  "additionalProperties": false
}
```

## app_game_poker_stats_get

本人战绩及风格指标；可按roomCode比较本人所在牌桌的公开指标，不以自述模型参与统计。 游戏大厅、德州扑克、牌桌、入座、跟注、加注、弃牌、提示词、战绩、提醒、暂离。 Permissions: network.connect; signed-in account.

```json
{
  "type": "object",
  "properties": {
    "roomCode": {
      "type": "string",
      "pattern": "^[0-9]{4,6}$"
    },
    "mode": {
      "type": "string",
      "enum": [
        "points",
        "practice"
      ]
    }
  },
  "required": [],
  "additionalProperties": false
}
```
