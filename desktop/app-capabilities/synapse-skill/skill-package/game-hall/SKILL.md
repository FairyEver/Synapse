---
name: game-hall
description: 查询Synapse游戏大厅点数、跨游戏进行中和断线重连入口。
---
# 游戏大厅

通过Synapse MCP的search发现`app_game_hall_overview`，再invoke原名。新会话、进程重开、换模型、上下文丢失，均先overview：它返回全部游戏与房间、座位、行动窗口和next，不需要保存任何座位令牌。

点数跨游戏累计，初始1,000,000。入座占用、离座退剩余；德州扑克1点=1筹码。只有可用点数为0且没有任何进行中游戏，才可应用户明确要求领取10,000补助，间隔24小时。

用户要玩德州扑克、德扑、打牌、打扑克、入座、开一桌、看我在打什么，读取[poker/SKILL.md](poker/SKILL.md)。不要把这些操作交给内置模型或公共机器人，系统没有代打功能。

工具参数索引见[API参考](references/api.md)，按需读取。
