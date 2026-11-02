import type { PokerService } from "../poker.service"
import type { PokerActionService } from "../poker-action.service"
import { PokerDeadlineTask } from "../poker-deadline.task"
import { PokerBotTask } from "../poker-bot.task"
import { currentHand } from "../poker-current-hand"
import { vi } from "vitest"
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
export const scopedBotTask = (actions: PokerActionService, code: string) => {
  const task = new PokerBotTask(scopedActions(actions, [code])), scan = task.scan.bind(task)
  task.scan = async (now = new Date()) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now)
    try { await scan(now) } finally { vi.useRealTimers() }
  }
  return task
}
/** Each eligible non-bot explicitly readies through its actual controller. */
export async function advanceNextHand(actions: PokerActionService, code: string): Promise<Date> {
  const room = await actions.poker.prisma.gamePokerRoom.findUniqueOrThrow({ where: { code } })
  const hand = await actions.poker.withRoom(code, async c => (await currentHand(c)).hand)
  if (!hand || hand.status !== "settled") throw new Error("测试房间没有已结算手牌")
  // Cold JSON timestamps are strings without a zone; use the typed archive
  // column rather than passing that string as a Prisma Date or parsing it locally.
  const now = hand.endedAt instanceof Date
    ? hand.endedAt
    : (await actions.poker.prisma.gamePokerHandArchive.findUniqueOrThrow({ where: { id: hand.id }, select: { endedAt: true } })).endedAt
  const seats = await actions.poker.prisma.gamePokerSeat.findMany({ where: { roomId: room.id, participantKind: { not: "bot" }, stack: { gt: 0 }, status: { not: "sitting_out" }, sitPending: false, leavePending: false }, take: 10 })
  for (const seat of seats) await actions.poker.ready(seat.userId, code, hand.id, seat.controlVersion, now, seat.controller === "human" ? "human" : "mcp")
  const owner = await actions.poker.prisma.gamePokerSeat.findFirst({ where: { roomId: room.id, userId: room.ownerUserId } })
  await actions.poker.start(room.ownerUserId, code, hand.id, owner?.controlVersion, now, owner?.controller === "human" ? "human" : "mcp")
  return now
}

/** Legacy running-hand fixtures now explicitly prepare and ask the host to start. */
export async function joinForStartedHand(poker: PokerService, ...args: Parameters<PokerService["join"]>) {
  const result = await poker.join(...args)
  const [, code, , time = new Date()] = args
  await prepareAndStartInitialHand(poker, code, time)
  return result
}
export async function prepareAndStartInitialHand(poker: PokerService, code: string, time = new Date()) {
  const room = await poker.prisma.gamePokerRoom.findUniqueOrThrow({ where: { code } })
  if (room.handNo !== 0) return
  const seats = await poker.prisma.gamePokerSeat.findMany({ where: { roomId: room.id }, take: 10 })
  const eligible = seats.filter(s => s.stack > 0 && s.status !== "sitting_out" && !s.sitPending && !s.leavePending)
  if (eligible.length < 2 || !eligible.some(s => s.participantKind !== "bot")) return
  for (const seat of eligible) if (seat.participantKind !== "bot" && seat.userId !== room.ownerUserId)
    await poker.ready(seat.userId, code, null, seat.controlVersion, time, seat.controller === "human" ? "human" : "mcp")
  const owner = seats.find(s => s.userId === room.ownerUserId)
  await poker.start(room.ownerUserId, code, null, owner?.controlVersion, time, owner?.controller === "human" ? "human" : "mcp")
}
