import { describe, expect, it } from "vitest"
import { HallService } from "../hall.service"
import { createHallStore } from "./hall-store"

describe("跨游戏点数与会话", () => {
  it("同一事务扣点建会话，聚合多个游戏并优先返回最急的行动", async () => {
    const db = createHallStore()
    const hall = new HallService(db.prisma)
    await db.transaction((tx) =>
      hall.join(
        tx,
        "u",
        { gameKind: "poker", gameRoomId: "a", roomCode: "1234", seatNo: 0, buyIn: 1000 },
        new Date(0),
      ),
    )
    await db.transaction((tx) =>
      hall.join(
        tx,
        "u",
        { gameKind: "other", gameRoomId: "b", roomCode: "5678", seatNo: 1, buyIn: 500 },
        new Date(0),
      ),
    )
    db.sessions[1].needsAction = true
    db.sessions[1].deadlineAt = new Date(600000)
    const view = await hall.overview("u", new Date(1000))
    expect(view.points).toEqual({ total: 1000000, available: 998500, inPlay: 1500, netProfit: 0 })
    expect(view.sessions).toHaveLength(2)
    expect(view.next).toEqual({ game: "other", roomCode: "5678" })
    expect(view.sessions[0].deadlineMs).toBe(599000)
  })
  it("并发扣点不透支，退款和盈亏归属于大厅", async () => {
    const db = createHallStore(1000)
    const hall = new HallService(db.prisma)
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        db.transaction((tx) =>
          hall.join(
            tx,
            "u",
            {
              gameKind: "poker",
              gameRoomId: String(i),
              roomCode: String(i),
              seatNo: 0,
              buyIn: 1000,
            },
            new Date(0),
          ),
        ),
      ),
    )
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(db.account.points).toBe(0)
    await db.transaction((tx) => hall.leave(tx, "u", "poker", "0", 1200, new Date(1)))
    expect(db.account.points).toBe(1200)
    expect(db.account.netProfit).toBe(200)
    expect((await hall.overview("u", new Date(1))).sessions).toEqual([])
  })
  it("补助要求零余额、无进行中会话且相隔24小时", async () => {
    const db = createHallStore(0)
    const hall = new HallService(db.prisma)
    await expect(hall.grant("u", new Date(0))).resolves.toMatchObject({ points: 10000 })
    db.account.points = 0
    await expect(hall.grant("u", new Date(86399999))).rejects.toThrow()
    await expect(hall.grant("u", new Date(86400000))).resolves.toMatchObject({ points: 10000 })
    db.account.points = 0
    db.sessions.push({ userId: "u", status: "active" })
    await expect(hall.grant("u", new Date(172800000))).rejects.toThrow()
  })
})
