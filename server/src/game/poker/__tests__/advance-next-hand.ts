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
/** Run the real next-hand transition at its persisted deadline. */
export async function advanceNextHand(actions: PokerActionService, code: string): Promise<Date> {
  const room = await actions.poker.prisma.gamePokerRoom.findUniqueOrThrow({ where: { code } })
  if (!room.nextHandAt) throw new Error("测试房间没有已排定的下一手")
  await scopedDeadlineTask(actions, [code]).scan(room.nextHandAt)
  return room.nextHandAt
}
