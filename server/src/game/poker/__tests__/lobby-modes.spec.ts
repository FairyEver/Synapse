import { describe, expect, it, vi } from "vitest"
import { GameApiService } from "../../game-api.service"
import { PokerReadService } from "../poker-read.service"
import type { PokerService } from "../poker.service"

function setup() {
  const findMany = vi.fn().mockResolvedValue([
    { id: "practice-room", code: "1001", mode: "practice", name: "陪练", maxSeats: 6, buyIn: 1000, status: "waiting", ownerUserId: "owner", variant: "standard52", smallBlind: 1, bigBlind: 2 },
    { id: "points-room", code: "1002", mode: "points", name: "点数", maxSeats: 6, buyIn: 1000, status: "running", ownerUserId: "owner", variant: "standard52", smallBlind: 1, bigBlind: 2 },
  ])
  const poker = {
    prisma: {
      gamePokerRoom: { findMany },
      gamePokerSeat: { groupBy: vi.fn().mockResolvedValue([{ roomId: "practice-room", _count: 2 }]) },
    },
  } as unknown as PokerService
  const read = new PokerReadService(poker)
  const api = new GameApiService({} as never, poker, {} as never, {} as never, read, {} as never, {} as never, {} as never)
  return { api, read, findMany }
}

describe("扑克大厅房间类型查询", () => {
  it("全部类型通过公共参数校验，数据库统一分页并保留每间房的类型", async () => {
    const { api, findMany } = setup()
    const result = await api.run("viewer", "app.game.poker.lobby.list", { mode: "all", offset: 50, limit: 2 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { not: "closed" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 50,
      take: 3,
    }))
    expect(result).toMatchObject({ items: [
      { roomCode: "1001", mode: "practice", players: 2 },
      { roomCode: "1002", mode: "points", players: 0 },
    ], nextOffset: null })
  })

  it("混合分页只返回当前页，下一页继续使用同一总偏移", async () => {
    const { api } = setup()
    await expect(api.run("viewer", "app.game.poker.lobby.list", { mode: "all", offset: 50, limit: 1 }))
      .resolves.toMatchObject({ items: [{ roomCode: "1001", mode: "practice" }], nextOffset: 51 })
  })

  it.each([undefined, "points", "practice"] as const)("既有筛选 %s 保持兼容", async (mode) => {
    const { read, findMany } = setup()
    await read.lobby(0, 50, mode)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { not: "closed" }, mode: mode ?? "points" } }))
  })

  it("全部类型仅用于大厅查询，不能作为新房间类型或历史筛选", async () => {
    const { api } = setup()
    await expect(api.run("viewer", "app.game.poker.room.create", { mode: "all", maxSeats: 6, buyIn: 1000 }))
      .rejects.toMatchObject({ response: { code: "POKER_ILLEGAL_ACTION" } })
    await expect(api.run("viewer", "app.game.poker.hand.history", { mode: "all" }))
      .rejects.toMatchObject({ response: { code: "POKER_ILLEGAL_ACTION" } })
    await expect(api.run("viewer", "app.game.poker.lobby.list", { mode: "invalid" }))
      .rejects.toMatchObject({ response: { code: "POKER_ILLEGAL_ACTION" } })
  })
})
