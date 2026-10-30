import { BadRequestException, Injectable } from "@nestjs/common"
import { z } from "zod"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import { HallService } from "./hall/hall.service"
import { PokerService } from "./poker/poker.service"
import { PokerActionService, type ActionInput } from "./poker/poker-action.service"
import { PokerWaitService } from "./poker/poker-wait.service"
import { PokerReadService } from "./poker/poker-read.service"
import { PokerNudgeService } from "./poker/poker-nudge.service"
import { PokerBotService } from "./poker/poker-bot.service"
@Injectable()
export class GameApiService {
  constructor(
    private readonly hall: HallService,
    private readonly poker: PokerService,
    private readonly actions: PokerActionService,
    private readonly wait: PokerWaitService,
    private readonly read: PokerReadService,
    private readonly nudge: PokerNudgeService,
    private readonly bots: PokerBotService = new PokerBotService(poker),
  ) {}
  async run(
    userId: string,
    operation: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const definition = GAME_TOOLS.find((t) => t.id === operation)
    if (!definition) throw new BadRequestException("未知游戏操作。")
    const parsed = z
      .fromJSONSchema(definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
      .safeParse(input)
    if (!parsed.success)
      throw new BadRequestException({ code: "POKER_ILLEGAL_ACTION", message: "游戏请求参数无效。" })
    const p = parsed.data as Record<string, any>
    switch (operation) {
      case "app.game.hall.overview":
        return this.hall.overview(userId)
      case "app.game.hall.guide":
        return {
          points: { initial: 1000000, grant: 10000, grantIntervalHours: 24 },
          overview: "重连时先调app_game_hall_overview，按next进入对应游戏。",
          games: (await this.hall.overview(userId)).games,
        }
      case "app.game.hall.account": {
        if (p.claimGrant) await this.hall.grant(userId)
        const overview = await this.hall.overview(userId)
        const recent = await this.poker.prisma.gameSession.findMany({
          where: { userId, funding: "points" },
          take: 20,
          orderBy: { lastActiveAt: "desc" },
          select: {
            gameKind: true,
            roomCode: true,
            buyIn: true,
            returned: true,
            status: true,
            lastActiveAt: true,
          },
        })
        return { ...overview.points, recent }
      }
      case "app.game.poker.guide":
        return {
          rules: {
            game: "无限注德州扑克",
            seats: "2–10",
            blinds: [1, 2],
            buyIn: [500, 1000, 2000, 5000],
            actionWindowSeconds: 600,
            heartbeatSeconds: 60,
            timeout: "能check就记录check，否则fold；两者均立即撤出本手、离桌退款，不自动跟注。",
            headsUp: "按钮即小盲，翻前先行动、翻后后行动。",
            privacy: "对手未摊牌底牌不可读；persona、版本、note仅本人可读。",
            practice: "mode=practice为陪练房，整桌练习筹码不扣兑大厅点数、不计正式战绩。房主可bot_add/移除程序机器人；真人仍通过MCP自己行动，机器人不调用模型。没有可参与真人时不开新手。",
          },
          tools: GAME_TOOLS.filter((t) => t.id.startsWith("app.game.poker.")),
          loop: "guide → overview → 无座位lobby_list/seat_join；已有座位先检查status，sitting_out仅在用户明确要求继续时seat_sit(false)后wait，未经继续指令不自动回座；其他已有座位直接wait。循环wait(roomCode,cursor,25000)；your_turn时按每次现读persona或本会话口述风格act(UUID,handId,street)，更新cursor；waiting继续；hand_result仅记结果继续；table_closed重新overview。用户叫停才退出；暂停用seat_sit(true)；pending=true表示当前手尚未结束，立即停止调用仍适用600秒超时离桌，不能承诺保留座位。",
          persona:
            "使用会话口述覆盖时，act传personaSource=session，行动不绑定游戏内版本；口述优先于游戏设置，仅本会话生效；未经用户明确要求不写回。模型自述可选，不确定留空。",
          errors: {
            POKER_NOT_YOUR_TURN: "重新wait",
            POKER_STALE_ACTION: "重新wait，不重试旧动作",
            POKER_ILLEGAL_ACTION: "按返回legalActions与数额改正",
            POKER_SEAT_NOT_FOUND: "overview后决定是否重新入座",
            POKER_ROOM_FULL: "换房间",
            POKER_ROOM_CLOSED: "overview",
            POKER_INSUFFICIENT_BALANCE: "检查大厅账户",
            POKER_NUDGE_RATE_LIMITED: "5分钟后再提醒",
            POKER_BOT_NOT_ALLOWED: "机器人仅限陪练房房主管理，不得代替真人行动。",
            GAME_INVALID_RESPONSE:
              "响应损坏，写结果未知；先overview或读取已保存对象核对，act重试保留原actionId，创建重试保留原creationId，不另发新动作。",
          },
        }
      case "app.game.poker.lobby.list":
        return this.read.lobby(p.offset ?? 0, p.limit ?? 50, p.mode)
      case "app.game.poker.room.create":
        return this.poker.createRoom(
          userId,
          p as { maxSeats: number; buyIn: number; name?: string; creationId?: string; mode?: "points" | "practice" },
        )
      case "app.game.poker.room.get":
        return this.actions.state(userId, p.roomCode, "public")
      case "app.game.poker.bot.add":
        return this.bots.add(userId, p.roomCode, p.creationId)
      case "app.game.poker.bot.remove":
        return this.bots.remove(userId, p.roomCode, p.botId)
      case "app.game.poker.seat.join":
        return this.poker.join(userId, p.roomCode, p)
      case "app.game.poker.seat.leave":
        return this.poker.leave(userId, p.roomCode)
      case "app.game.poker.seat.sit":
        return this.poker.sit(userId, p.roomCode, p.sittingOut)
      case "app.game.poker.seat.nudge":
        return this.nudge.nudge(userId, p.roomCode, p.seatNo)
      case "app.game.poker.table.wait":
        return this.wait.wait(userId, p.roomCode, p.cursor ?? "", p.timeoutMs ?? 25000, signal)
      case "app.game.poker.table.state":
        return this.actions.state(userId, p.roomCode, "owner", true)
      case "app.game.poker.action.act":
        return this.actions.act(userId, p.roomCode, p as ActionInput)
      case "app.game.poker.agent.list":
        return this.read.agents(userId)
      case "app.game.poker.agent.upsert":
        return this.poker.upsertAgent(userId, p)
      case "app.game.poker.agent.versions":
        return this.poker.agentVersions(userId, p.agentId)
      case "app.game.poker.hand.history":
        return this.read.history(userId, p.offset ?? 0, p.limit ?? 50, p.mode)
      case "app.game.poker.hand.detail":
        return this.read.detail(userId, p.roomCode, p.handNo)
      case "app.game.poker.stats.get":
        return this.read.stats(userId, p.roomCode, p.mode)
    }
  }
}
