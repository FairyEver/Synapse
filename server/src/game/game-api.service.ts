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
import { PokerEventsService } from "./poker/poker-events.service"
import type { PokerCaller } from "./poker/poker-control"
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
    private readonly events: PokerEventsService = new PokerEventsService(poker),
  ) {}
  async run(
    userId: string,
    operation: string,
    input: unknown,
    signal?: AbortSignal,
    caller: PokerCaller = "mcp",
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
            blinds: [[1, 2], [2, 4], [5, 10], [10, 20]],
            variants: { standard52: "标准52张", short32: "7至A共32张；同花大于葫芦，顺子大于三条，A789T为最小顺子。" },
            buyIn: [500, 1000, 2000, 5000],
            actionWindowSeconds: 600,
            heartbeatSeconds: 60,
            nextHand: "首局沿用入座开局；每手结束后所有有资格座位重新准备，真人手动点击、AI显式seat_ready、程序陪练自动准备。未全员准备不开下一手。",
            timeout: "能check就记录check，否则fold；两者均立即撤出本手、离桌退款，不自动跟注。",
            headsUp: "按钮即小盲，翻前先行动、翻后后行动。",
            privacy: "MCP决策接口不提供教学明牌；Web 游戏中心从未入座可全牌旁观，曾参与点数房不能通过旁观读暗牌，陪练旁观只额外公开机器人牌。persona、版本、note及检查点仅本人可读。",
            practice: "mode=practice为陪练房，整桌练习筹码不扣兑大厅点数、不计正式战绩。房主可bot_add/移除程序机器人；真人可在 Web 游戏中心操作或交给外部AI，机器人不调用模型。没有可参与真人时不开新手。",
          },
          tools: GAME_TOOLS.filter((t) => t.id.startsWith("app.game.poker.")),
          loop: "guide → overview → 无座位lobby_list/seat_join；已有座位先检查status，sitting_out仅在用户明确要求继续时seat_sit(false)后wait，未经继续指令不自动回座；已保存且有效的context_maintenance继续意图可在核对控制版本后恢复。每次独立wait(roomCode,cursor,25000)；your_turn按现读persona与合法动作提交act(UUID,handId,street,controlVersion,expectedActionSeq)，更新cursor；hand_result只记简要结果；ready_required时先检查继续意图和维护点，再用handId/controlVersion显式seat_ready，查询和wait不会准备；control_released停止，不抢回控制权。每10手或15分钟检查上下文，必要时reason=context_maintenance申请暂离，pending=true表示当前手尚未结束，立即停止调用仍适用600秒超时离桌，不能承诺保留座位。完成本手并确认sitting_out后checkpoint.save，只有宿主原生压缩能力真实可调用时执行并确认，缺失或失败则安全停止提示手动处理；恢复重读guide/overview/checkpoint，不自动重新扣点入座。",
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
            POKER_CONTROL_RELEASED: "停止AI循环，不能用join/sit/leave抢回控制权。",
            POKER_STALE_CONTROL: "重新读取控制版本，不重试旧动作。",
            GAME_INVALID_RESPONSE:
              "响应损坏，写结果未知；先overview或读取已保存对象核对，act重试保留原actionId，创建重试保留原creationId，不另发新动作。",
          },
        }
      case "app.game.poker.lobby.list":
        return this.read.lobby(p.offset ?? 0, p.limit ?? 50, p.mode, userId)
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
        return this.poker.join(userId, p.roomCode, p, new Date(), caller)
      case "app.game.poker.seat.leave":
        return this.poker.leave(userId, p.roomCode, new Date(), caller, p.controlVersion)
      case "app.game.poker.seat.ready":
        return this.poker.ready(userId, p.roomCode, p.handId, p.controlVersion, new Date(), caller)
      case "app.game.poker.seat.sit":
        return this.poker.sit(userId, p.roomCode, p.sittingOut, new Date(), caller, p.controlVersion, p.reason)
      case "app.game.poker.seat.nudge":
        return this.nudge.nudge(userId, p.roomCode, p.seatNo)
      case "app.game.poker.table.wait":
        return this.wait.wait(userId, p.roomCode, p.cursor ?? "", p.timeoutMs ?? 25000, signal)
      case "app.game.poker.table.state":
        return this.actions.state(userId, p.roomCode, "owner", true)
      case "app.game.poker.action.act":
        return this.actions.act(userId, p.roomCode, p as ActionInput, new Date(), caller)
      case "app.game.poker.control.claim":
        return this.poker.claim(userId, p.roomCode, p.controlVersion)
      case "app.game.poker.checkpoint.get":
        return this.poker.checkpoint(userId, p.roomCode)
      case "app.game.poker.checkpoint.save":
        return this.poker.checkpoint(userId, p.roomCode, p as { controlVersion: number; cursor: string; sessionStyle?: string; continueIntent: boolean })
      case "app.game.poker.table.events":
        return this.events.events(userId, p.roomCode, p.cursor ?? "", p.limit ?? 100, "decision", p.perspective ?? "owner")
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
