import { describe, expect, it } from "vitest"
import type { PokerService } from "../poker.service"
import { PokerEventsService } from "../poker-events.service"
const now = new Date("2026-10-30T00:00:00Z")
const MAX = 2147483647
function fixture(archived = false) {
  const hand: any = { id: "h", roomId: "r", handNo: 3, status: "settled", actionSeq: 2, startedAt: new Date(now.getTime() - 50000), endedAt: now, board: [], showdownSeats: [], rules: null, result: { payouts: { 0: 3 }, deltas: { 0: 1, 1: -1 }, pots: [] } }
  const seats: any[] = [0, 1].map((seatNo) => ({ id: `s${seatNo}`, handId: "h", seatNo, userId: `u${seatNo}`, participantKind: "human", displayName: `玩家${seatNo}`, startingStack: 10, endingStack: seatNo ? 9 : 11, holeCards: seatNo ? ["As", "Ah"] : ["Ks", "Kh"], folded: seatNo === 1 }))
  const actions: any[] = [1, 2].map((seq) => ({ id: `a${seq}`, handId: "h", roomId: "r", seq, seatNo: seq - 1, userId: `u${seq - 1}`, street: "preflop", action: seq === 1 ? "call" : "fold", amount: 1, potAfter: 3, isAuto: false, actionSource: seq === 1 ? "human" : "mcp", note: `secret${seq}`, personaVersionId: `persona${seq}`, createdAt: now }))
  const session = { status: "closed" }
  const tx: any = {
    gameSession: { findUnique: async () => session },
    gamePokerHand: { findUnique: async () => archived ? null : hand, findMany: async () => archived ? [] : [hand] },
    gamePokerHandArchive: { findUnique: async () => archived ? { data: { hand, seats, actions, summaries: [] } } : null, findMany: async () => archived ? [{ data: { hand, seats, actions, summaries: [] } }] : [] },
    gamePokerHandSeat: { findMany: async () => seats },
    gamePokerAction: {
      findMany: async ({ where, take }: any) => actions.filter((a) => a.seq > (where.seq?.gt ?? 0) && a.createdAt >= (where.createdAt?.gte ?? new Date(0))).slice(0, take),
      groupBy: async () => actions.map((a) => ({ userId: a.userId, seatNo: a.seatNo, actionSource: a.actionSource, isAuto: a.isAuto })),
    },
  }
  const room: any = { id: "r", code: "1234", mode: "points", currentHandId: "h", handNo: 3 }
  const poker = { withRoom: async (_: string, work: any) => work({ room, seats: [], tx, now }) } as unknown as PokerService
  return { service: new PokerEventsService(poker), hand, actions, room, seats, session, tx }
}
describe.each([false, true])("实时事件冷热一致 archived=%s", (archived) => {
  it("空cursor只同步最新位置；小页逐个动作后结算且MAX去重", async () => {
    const f = fixture(archived)
    expect(await f.service.events("u0", "1234", "", 1, "desktop", "owner")).toEqual({ events: [], cursor: `3:${MAX}`, hasMore: false })
    let page = await f.service.events("u0", "1234", "3:0", 1, "desktop", "owner")
    expect(page.events[0].kind).toBe("action")
    expect(page.events[0].action).toMatchObject({ actionSource: "human", displayName: "玩家0", note: "secret1" })
    expect(page.hasMore).toBe(true)
    page = await f.service.events("u0", "1234", page.cursor, 1, "desktop", "owner")
    expect(page.events[0].action).not.toHaveProperty("note")
    expect(page.events[0].action).not.toHaveProperty("personaVersionId")
    page = await f.service.events("u0", "1234", page.cursor, 1, "desktop", "owner")
    expect(page.events[0].kind).toBe("settlement")
    expect(page.events[0].settlement?.mixedControl).toBe(false)
    expect(page.cursor).toBe(`3:${MAX}`)
    expect((await f.service.events("u0", "1234", page.cursor, 1, "desktop", "owner")).events).toEqual([])
  })
  it("旧cursor直接跳到最新，不能通过补读访问90天历史暗牌", async () => {
    const f = fixture(archived)
    expect(await f.service.events("viewer", "1234", "1:0", 100, "desktop", "public")).toEqual({ events: [], cursor: `3:${MAX}`, hasMore: false })
  })
  it("closed会话保留参与证据；公开事件不泄露暗牌及私密动作字段", async () => {
    const f = fixture(archived)
    const page = await f.service.events("viewer", "1234", "3:0", 100, "desktop", "public")
    expect(page.events.find((e) => e.kind === "settlement")?.settlement?.seats.every((s) => !s.hole && !s.handName)).toBe(true)
    expect(JSON.stringify(page)).not.toContain("secret")
    expect(JSON.stringify(page)).not.toContain("persona")
  })
})
it("事件拒绝无效游标和超过100条限额", async () => {
  const f = fixture()
  await expect(f.service.events("u0", "1234", "3:2147483648")).rejects.toThrow()
  await expect(f.service.events("u0", "1234", "3:0", 101)).rejects.toThrow()
})

it("实时教学只给从未参与的桌面旁观者，决策事件不受教学可见性扩张", async () => {
  const f = fixture()
  f.tx.gameSession.findUnique = async () => null
  let page = await f.service.events("viewer", "1234", "3:0", 100, "desktop", "public")
  expect(page.events.at(-1)?.settlement?.seats.every((s) => s.hole?.length === 2)).toBe(true)
  page = await f.service.events("viewer", "1234", "3:0", 100, "decision", "public")
  expect(page.events.at(-1)?.settlement?.seats.every((s) => !s.hole)).toBe(true)
})
it("同手旧事件超出两分钟也不可补读", async () => {
  const f = fixture()
  f.hand.startedAt = f.hand.endedAt = new Date(now.getTime() - 90 * 86400000)
  f.actions.forEach((a) => a.createdAt = f.hand.endedAt)
  expect(await f.service.events("viewer", "1234", "3:0", 100, "desktop", "public")).toEqual({ events: [], cursor: `3:${MAX}`, hasMore: false })
})
it("100条分页不跳过第101个动作或提前发送结算", async () => {
  const f = fixture()
  const template = f.actions[0]
  f.actions.splice(0, f.actions.length, ...Array.from({ length: 101 }, (_, i) => ({ ...template, id: `a${i}`, seq: i + 1 })))
  f.hand.actionSeq = 101
  const first = await f.service.events("u0", "1234", "3:0")
  expect(first.events).toHaveLength(100)
  expect(first.cursor).toBe("3:100")
  expect(first.hasMore).toBe(true)
  const second = await f.service.events("u0", "1234", first.cursor)
  expect(second.events.map((e) => e.kind)).toEqual(["action", "settlement"])
  expect(second.events[0].seq).toBe(101)
  expect(second.cursor).toBe(`3:${MAX}`)
  expect(second.hasMore).toBe(false)
})
it("冷热重复行不产生重复结算，姓名仅归属于本手参与者身份", async () => {
  const f = fixture()
  f.tx.gamePokerHandArchive.findMany = async () => [{ data: { hand: f.hand, seats: f.seats, actions: f.actions, summaries: [] } }]
  f.actions[0].userId = "new-player-at-same-seat"
  const page = await f.service.events("viewer", "1234", "3:0")
  expect(page.events.filter((e) => e.kind === "settlement")).toHaveLength(1)
  expect(page.events[0].action?.displayName).toBeUndefined()
})

it("结算按全手同一参与者来源聚合混打，分页末尾仍识别早先真人动作", async () => {
  const f = fixture()
  f.actions[1].userId = "u0"; f.actions[1].seatNo = 0
  const page = await f.service.events("u0", "1234", "3:2", 1)
  expect(page.events[0].settlement?.mixedControl).toBe(true)
})
