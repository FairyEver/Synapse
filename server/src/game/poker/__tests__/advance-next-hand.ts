import type { PokerActionService } from "../poker-action.service"
import { PokerDeadlineTask } from "../poker-deadline.task"
import { PokerBotTask } from "../poker-bot.task"
/** Scope external scheduler selection; transitions still use real room locks and persistence. */
function scopedActions(actions: PokerActionService, codes: string[]): PokerActionService {
  const poker = actions.poker
  return {
    poker: {
      prisma: { gamePokerRoom: {
        findMany: (args: Parameters<typeof poker.prisma.gamePokerRoom.findMany>[0]) => poker.prisma.gamePokerRoom.findMany({ ...args, where: { AND: [args?.where ?? {}, { code: { in: codes } }] } }),
      } },
      withRoom: poker.withRoom.bind(poker), refund: poker.refund.bind(poker), maintain: poker.maintain.bind(poker),
    },
    expire: actions.expire.bind(actions), actBot: actions.actBot.bind(actions),
  } as unknown as PokerActionService
}
export const scopedDeadlineTask = (actions: PokerActionService, codes: string[]) => new PokerDeadlineTask(scopedActions(actions, codes))
export const scopedBotTask = (actions: PokerActionService, code: string) => new PokerBotTask(scopedActions(actions, [code]))
/** Each eligible non-bot explicitly readies through its actual controller. */
export async function advanceNextHand(actions: PokerActionService, code: string): Promise<Date> {
  const room = await actions.poker.prisma.gamePokerRoom.findUniqueOrThrow({ where: { code } })
  if (!room.currentHandId) throw new Error("测试房间没有已结算手牌")
  const hand = await actions.poker.prisma.gamePokerHand.findUniqueOrThrow({ where: { id: room.currentHandId } })
  const now = hand.endedAt ?? new Date()
  const seats = await actions.poker.prisma.gamePokerSeat.findMany({ where: { roomId: room.id, participantKind: { not: "bot" }, stack: { gt: 0 }, status: { not: "sitting_out" }, sitPending: false, leavePending: false }, take: 10 })
  for (const seat of seats) await actions.poker.ready(seat.userId, code, hand.id, seat.controlVersion, now, seat.controller === "human" ? "human" : "mcp")
  return now
}
