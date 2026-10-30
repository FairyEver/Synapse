import { describe, expect, it } from "vitest"
import type { PokerService, RoomContext } from "../poker.service"
import { engine, saveHand, startNext } from "../poker-lifecycle"
import { act, startHand } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"

function fixture() {
  const now = new Date("2026-10-30T00:00:00Z")
  const room: any = { id: "r", code: "1234", mode: "points", variant: "short32", smallBlind: 5, bigBlind: 10, status: "running", handNo: 1, dealerSeat: 0, currentHandId: "h1", nextHandAt: null }
  const seats = [0, 1].map((seatNo) => ({ id: `s${seatNo}`, userId: `u${seatNo}`, seatNo, stack: 100, status: "active", participantKind: "human", joinedHandNo: 1 }))
  const hands: any[] = [{ id: "h1", handNo: 1, status: "running" }]
  const handSeats = seats.map((s) => ({ ...s, handId: "h1" }))
  const tx: any = {
    gamePokerHand: {
      findUnique: async ({ where }: any) => hands.find((h) => h.id === where.id),
      update: async ({ where, data }: any) => Object.assign(hands.find((h) => h.id === where.id), data),
      create: async ({ data }: any) => { const h = { id: `h${hands.length + 1}`, ...data }; hands.push(h); return h },
    },
    gamePokerRoom: { update: async ({ data }: any) => Object.assign(room, data) },
    gamePokerHandSeat: { findMany: async () => handSeats, update: async () => {}, createMany: async ({ data }: any) => handSeats.push(...data) },
    gamePokerSeat: { update: async () => {} },
    gameSession: { updateMany: async () => {} },
    gamePokerHandSummary: { create: async () => {} },
  }
  const c = { room, seats, tx, now } as unknown as RoomContext
  const poker = { refund: async (_: unknown, seat: any) => { c.seats = c.seats.filter((s) => s.id !== seat.id) } } as unknown as PokerService
  let h = startHand(seats, 0, orderedDeck("short32"), { variant: "short32", smallBlind: 5, bigBlind: 10 })
  h = act(h, 0, { action: "fold" })
  return { c, poker, hands, settled: h }
}
describe("结算展示与持久下一手时间", () => {
  it("保存本手规则和净输赢，五秒内保留结算且无行动计时", async () => {
    const f = fixture()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    expect(f.hands[0].rules).toEqual({ variant: "short32", smallBlind: 5, bigBlind: 10 })
    expect(f.hands[0].result.deltas).toEqual({ 0: -5, 1: 5 })
    expect(f.c.room.nextHandAt).toEqual(new Date(f.c.now.getTime() + 5000))
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    expect(f.c.room.actionDeadlineAt).toBeNull()
    expect(f.c.room.botActionAt).toBeNull()
  })
  it("五秒到期按房间规则仅发下一手并清除时间，重启可读旧快照", async () => {
    const f = fixture()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    f.c.now = new Date(f.c.now.getTime() + 5000)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(2)
    expect(f.c.room.nextHandAt).toBeNull()
    expect(engine(f.hands[1])).toMatchObject({ variant: "short32", smallBlind: 5, bigBlind: 10 })
    expect(f.hands[1].engineState.deck).toHaveLength(28)
  })
  it("结算后人数不足暂停仍保留五秒，下次可参与也不能提前开局", async () => {
    const f = fixture()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    f.c.seats = f.c.seats.slice(0, 1)
    await startNext(f.poker, f.c)
    expect(f.c.room.status).toBe("paused")
    expect(f.c.room.nextHandAt).toEqual(new Date(f.c.now.getTime() + 5000))
    f.c.seats.push({ id: "replacement", userId: "replacement", seatNo: 1, stack: 100, status: "waiting", participantKind: "human" } as any)
    f.c.now = new Date(f.c.now.getTime() + 1)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    f.c.now = new Date(f.c.now.getTime() + 4999)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(2)
  })
  it("关桌不等待五秒", async () => {
    const f = fixture()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    f.c.room.closeRequested = true
    await startNext(f.poker, f.c)
    expect(f.c.room.status).toBe("closed")
    expect(f.c.room.nextHandAt).toBeNull()
  })
  it("历史engine与hand缺失规则按standard52和1/2解释", () => {
    const h = startHand([{ seatNo: 0, stack: 100 }, { seatNo: 1, stack: 100 }], 0, orderedDeck())
    const old: any = { ...h }; delete old.variant; delete old.smallBlind; delete old.bigBlind
    expect(engine({ engineState: old } as any)).toMatchObject({ variant: "standard52", smallBlind: 1, bigBlind: 2 })
  })
})

import { vi } from "vitest"
import { Logger } from "@nestjs/common"
import { PokerDeadlineTask } from "../poker-deadline.task"
import type { PokerActionService } from "../poker-action.service"

it("下一手后台轮转绕过前100坏房，持久到期时间支持新任务实例恢复且单次只发一手", async () => {
  const rooms = Array.from({ length: 101 }, (_, i) => {
    const f = fixture()
    f.c.room.id = f.c.room.code = String(i).padStart(3, "0")
    f.hands[0].status = "settled"
    f.c.room.nextHandAt = new Date(f.c.now.getTime() - 1)
    f.c.room.actionDeadlineAt = null
    return f
  })
  const attempts: string[] = []
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([field, cond]: [string, any]) => {
    if (field === "AND") return cond.every((w: any) => matches(row, w))
    if (field === "OR") return cond.some((w: any) => matches(row, w))
    const value = row[field]
    if (cond instanceof Date) return value?.getTime() === cond.getTime()
    if (cond === null || typeof cond !== "object") return value === cond
    return Object.entries(cond).every(([op, rhs]: [string, any]) => op === "not" ? value !== rhs : op === "in" ? rhs.includes(value) : value != null && (op === "lte" ? value <= rhs : op === "gt" ? value > rhs : value < rhs))
  })
  const poker = {
    prisma: { gamePokerRoom: { findMany: async ({ where, take }: any) => rooms.map((f) => f.c.room).filter((r) => matches(r, where)).slice(0, take).map((r) => ({ ...r })) } },
    withRoom: async (code: string, work: (c: RoomContext) => Promise<void>, now: Date) => {
      attempts.push(code)
      if (code !== "100") throw new Error("坏房")
      const f = rooms[100]; f.c.now = now; return work(f.c)
    },
    refund: rooms[100].poker.refund,
    maintain: async () => {},
  }
  const actions = { poker, expire: async () => {} } as unknown as PokerActionService
  const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
  try {
    const task = new PokerDeadlineTask(actions)
    await task.scan(rooms[0].c.now)
    expect(attempts).toHaveLength(100)
    expect(rooms[100].hands).toHaveLength(1)
    await task.scan(new Date(rooms[0].c.now.getTime() + 1000))
    expect(attempts).toHaveLength(101)
    expect(rooms[100].hands).toHaveLength(2)
    expect(rooms[100].c.room.nextHandAt).toBeNull()
    await new PokerDeadlineTask(actions).scan(new Date(rooms[0].c.now.getTime() + 2000))
    expect(rooms[100].hands).toHaveLength(2)
  } finally { warn.mockRestore() }
})
