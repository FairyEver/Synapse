import { afterEach, describe, expect, it, vi } from "vitest"
import { Logger } from "@nestjs/common"
import { PokerBotTask } from "../poker-bot.task"
import type { PokerActionService } from "../poker-action.service"
afterEach(() => vi.restoreAllMocks())
describe("机器人失败批次轮转", () => {
  it("最早100个持续失败也会处理101，空尾回绕且每次最多100", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const now = new Date("2026-10-30T00:00:00Z")
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: String(i).padStart(5, "0"), code: String(i + 1000), botActionAt: now, currentHandId: `hand-${i}` }))
    const attempts: string[] = []
    const actions = {
      poker: { prisma: { gamePokerRoom: { findMany: async ({ where, take }: any) => rows.filter((r) => r.botActionAt <= where.botActionAt.lte && (!where.OR || where.OR.some((o: any) => o.botActionAt.gt ? r.botActionAt > o.botActionAt.gt : r.botActionAt.getTime() === o.botActionAt.getTime() && r.id > o.id.gt))).slice(0, take) } } },
      actBot: async (code: string) => { attempts.push(code); if (code !== "1100") throw new Error("persistent failure") },
    } as unknown as PokerActionService
    const task = new PokerBotTask(actions)
    await task.scan(now)
    expect(attempts).toHaveLength(100)
    await task.scan(new Date(now.getTime() + 1000))
    expect(attempts.at(-1)).toBe("1100")
    expect(attempts).toHaveLength(101)
    await task.scan(new Date(now.getTime() + 2000))
    expect(attempts).toHaveLength(201)
    expect(attempts[101]).toBe("1000")
  })
})
