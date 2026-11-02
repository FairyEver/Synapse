import { describe, expect, it, vi } from "vitest"
import type { RoomContext } from "../poker.service"
import { projectRollStats } from "../poker-roll-stats"

function context(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue(rows)
  return { c: { room: { id: "room" }, tx: { $queryRaw: query } } as unknown as RoomContext, query }
}
const seats = [{ seatNo: 0, userId: "a" }, { seatNo: 1, userId: "b" }]
describe("房间 Roll 玩家信息投影", () => {
  it("按座位当前账号映射本手和房间统计，不泄漏账号或私牌", async () => {
    const { c, query } = context([{ hand: { players: 1, count: 2, paid: 12 }, room: { players: 3, count: 8, paid: 42 }, players: [
      { userId: "a", handCount: 2, handPaid: 12, count: 3, paid: 20 },
      { userId: "b", handCount: 0, handPaid: 0, count: 2, paid: 8 },
    ] }])
    const value = await projectRollStats(c, "h", seats)
    expect(value).toMatchObject({ hand: { players: 1, count: 2, paid: 12 }, room: { players: 3, count: 8, paid: 42 } })
    expect(value.seats).toEqual([
      { seatNo: 0, key: expect.any(String), hand: { count: 2, paid: 12 }, room: { count: 3, paid: 20 } },
      { seatNo: 1, key: expect.any(String), hand: { count: 0, paid: 0 }, room: { count: 2, paid: 8 } },
    ])
    expect(value.seats[0].key).not.toBe(value.seats[1].key)
    expect(JSON.stringify(value)).not.toContain('"userId"')
    const sql = query.mock.calls[0][0]
    expect(sql.text).toContain('"GamePokerRoll"')
    expect(sql.text).toContain('"GamePokerHandArchive"')
    expect(sql.text).toContain("DISTINCT ON")
    expect(sql.values).toContain("room")
  })
  it("同账号换座重进的key及累计不变，同座位不同账号不继承", async () => {
    const { c } = context([{ hand: { players: 1, count: 2, paid: 12 }, room: { players: 120, count: 500, paid: 5000 }, players: [{ userId: "a", handCount: 2, handPaid: 12, count: 20, paid: 600 }] }])
    const a = await projectRollStats(c, "h1", [{ seatNo: 0, userId: "a" }])
    const b = await projectRollStats(c, "h2", [{ seatNo: 5, userId: "a" }, { seatNo: 0, userId: "fresh" }])
    expect(a.seats[0].key).toBe(b.seats[0].key)
    expect(b.seats[0]).toMatchObject({ seatNo: 5, room: { count: 20, paid: 600 } })
    expect(b.seats[1]).toMatchObject({ seatNo: 0, hand: { count: 0, paid: 0 }, room: { count: 0, paid: 0 } })
    expect(b.room).toEqual({ players: 120, count: 500, paid: 5000 })
  })
  it("空房返回确切零；异常数据库响应不能伪装为零", async () => {
    const zero = { players: 0, count: 0, paid: 0 }
    const { c } = context([{ hand: zero, room: zero, players: [] }])
    expect(await projectRollStats(c, null, [])).toEqual({ hand: zero, room: zero, seats: [] })
    await expect(projectRollStats(context().c, null, [])).rejects.toThrow()
  })
})
