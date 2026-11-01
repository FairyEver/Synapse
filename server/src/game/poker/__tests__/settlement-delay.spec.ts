import { describe, expect, it } from "vitest"
import { PokerService, type RoomContext } from "../poker.service"
import { engine, saveHand, startNext } from "../poker-lifecycle"
import { act, startHand } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"
import { PokerActionService } from "../poker-action.service"

function fixture() {
  const now = new Date("2026-10-30T00:00:00Z")
  const room: any = { id: "r", code: "1234", mode: "points", variant: "short32", smallBlind: 5, bigBlind: 10, status: "running", handNo: 1, dealerSeat: 0, currentHandId: "h1", nextHandAt: null }
  const seats = [0, 1].map((seatNo) => ({ id: `s${seatNo}`, userId: `u${seatNo}`, seatNo, stack: 100, status: "active", participantKind: "human", controller: "human", controlVersion: 0, joinedHandNo: 1, lastSeenAt: now }))
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
    gamePokerSeat: { update: async ({ where, data }: any) => Object.assign(c.seats.find(s => s.id === where.id)!, data) },
    gameSession: { updateMany: async () => {} },
    gamePokerHandSummary: { create: async () => {} },
  }
  const c = { room, seats, tx, now } as unknown as RoomContext
  const poker = Object.assign(Object.create(PokerService.prototype), {
    withRoom: async (_code: string, work: (context: RoomContext) => Promise<unknown>, time = c.now) => { c.now = time; return work(c) },
    refund: async (_: unknown, seat: any) => { c.seats = c.seats.filter((s) => s.id !== seat.id) },
  }) as PokerService
  let h = startHand(seats, 0, orderedDeck("short32"), { variant: "short32", smallBlind: 5, bigBlind: 10 })
  h = act(h, 0, { action: "fold" })
  return { c, poker, hands, settled: h }
}
describe("结算展示与全员准备屏障", () => {
  it("保存本手规则和净输赢，结算清除准备且不自动排定下一手", async () => {
    const f = fixture()
    f.c.seats[0].status = "ready"
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    expect(f.hands[0].rules).toEqual({ variant: "short32", smallBlind: 5, bigBlind: 10 })
    expect(f.hands[0].result.deltas).toEqual({ 0: -5, 1: 5 })
    expect(f.c.room.nextHandAt).toBeNull()
    expect(f.c.seats.every(s => s.status === "waiting")).toBe(true)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    expect(f.c.room.actionDeadlineAt).toBeNull()
    expect(f.c.room.botActionAt).toBeNull()
  })
  it("时间经过再久也不续局，最后一位准备后才按房规发一手", async () => {
    const f = fixture()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    f.c.now = new Date(f.c.now.getTime() + 600000)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    await f.poker.ready("u0", "1234", "h1", 0, f.c.now, "human")
    expect(f.hands).toHaveLength(1)
    await f.poker.ready("u0", "1234", "h1", 0, f.c.now, "human")
    expect(f.hands).toHaveLength(1)
    await f.poker.ready("u1", "1234", "h1", 0, f.c.now, "human")
    expect(f.hands).toHaveLength(2)
    expect(f.c.room.nextHandAt).toBeNull()
    expect(engine(f.hands[1])).toMatchObject({ variant: "short32", smallBlind: 5, bigBlind: 10 })
    expect(f.hands[1].engineState.deck).toHaveLength(28)
  })
  it("替补加入也必须准备，旧nextHandAt不能绕过屏障", async () => {
    const f = fixture()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    f.c.seats = f.c.seats.slice(0, 1)
    await startNext(f.poker, f.c)
    expect(f.c.room.status).toBe("paused")
    expect(f.c.room.nextHandAt).toBeNull()
    f.c.seats[0].status = "ready"
    f.c.seats.push({ id: "replacement", userId: "replacement", seatNo: 1, stack: 100, status: "waiting", participantKind: "human" } as any)
    f.c.now = new Date(f.c.now.getTime() + 1)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    f.c.room.nextHandAt = new Date(f.c.now.getTime() - 1)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    f.c.seats[1].status = "ready"
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(2)
  })
  it("陪练自动准备，AI必须通过MCP明确准备且不能代真人准备", async () => {
    const f = fixture()
    f.c.seats[1].participantKind = "bot"
    f.c.seats[0].controller = "ai"
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    await expect(f.poker.ready("u0", "1234", "h1", 0, f.c.now, "human")).rejects.toMatchObject({ response: { code: "POKER_CONTROL_RELEASED" } })
    await f.poker.ready("u0", "1234", "h1", 0, f.c.now, "mcp")
    expect(f.hands).toHaveLength(2)
    await expect(f.poker.ready("u0", "1234", "h1", 0, f.c.now, "mcp")).rejects.toMatchObject({ response: { code: "POKER_STALE_ACTION" } })
    expect(f.hands).toHaveLength(2)
  })
  it("拒绝旧控制版本、旁观者、暂离座位和非结算阶段的准备", async () => {
    const f = fixture()
    await expect(f.poker.ready("u0", "1234", "h1", 0, f.c.now, "human")).rejects.toBeDefined()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    await expect(f.poker.ready("viewer", "1234", "h1", 0, f.c.now, "human")).rejects.toBeDefined()
    await expect(f.poker.ready("u0", "1234", "h1", 9, f.c.now, "human")).rejects.toBeDefined()
    f.c.seats[0].status = "sitting_out"
    await expect(f.poker.ready("u0", "1234", "h1", 0, f.c.now, "human")).rejects.toBeDefined()
    expect(f.hands).toHaveLength(1)
  })
  it("当前结算已归档并清空指针也不能被误作首局，仍可读取并逐手准备", async () => {
    const f = fixture()
    await saveHand(f.poker, f.c, f.hands[0], f.settled)
    f.c.room.currentHandId = null
    ;(f.c.tx as any).gamePokerHandArchive = { findFirst: async () => ({ data: { hand: f.hands[0], seats: f.settled.seats.map(s => ({ ...s, userId: `u${s.seatNo}`, displayName: `选手${s.seatNo}`, holeCards: s.hole, endingStack: s.stack, participantKind: "human" })), actions: [], summaries: [] } }) }
    ;(f.c.tx.gameSession as any).findUnique = async () => null
    await startNext(f.poker, f.c)
    expect(f.hands).toHaveLength(1)
    const view = await new PokerActionService(f.poker).view(f.c, "u0", "owner", false)
    expect(view).toMatchObject({ handId: "h1", awaitingReady: true, settlement: { handId: "h1" } })
    await f.poker.ready("u0", "1234", "h1", 0, f.c.now, "human")
    expect(f.hands).toHaveLength(1)
    await f.poker.ready("u1", "1234", "h1", 0, f.c.now, "human")
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

it("旧部署留下的到期后台轮转也不能自动越过未准备座位", async () => {
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
    expect(rooms[100].hands).toHaveLength(1)
    expect(rooms[100].c.room.nextHandAt).toBeNull()
    await new PokerDeadlineTask(actions).scan(new Date(rooms[0].c.now.getTime() + 2000))
    expect(rooms[100].hands).toHaveLength(1)
  } finally { warn.mockRestore() }
})
