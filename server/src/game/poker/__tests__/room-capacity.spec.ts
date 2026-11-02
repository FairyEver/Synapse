import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { PrismaService } from "../../../prisma/prisma.service"
import type { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerBotService } from "../poker-bot.service"

describe("扑克房间最多6人", () => {
  it.each(["points", "practice"] as const)("%s房拒绝7至10人建房", async mode => {
    const poker = new PokerService({ gamePokerRoom: { create: async ({ data }: any) => data } } as PrismaService, {} as HallService)
    for (const maxSeats of [7, 8, 9, 10]) {
      await expect(poker.createRoom("owner", { mode, maxSeats, buyIn: 1000, name: "房间" }))
        .rejects.toMatchObject({ response: { code: "POKER_ILLEGAL_ACTION" } })
    }
    expect(await poker.createRoom("owner", { mode, maxSeats: 6, buyIn: 1000, name: "房间" })).toHaveProperty("roomCode")
  })

  it.each(["points", "practice"] as const)("%s房校验新的四档金额", async mode => {
    const poker = new PokerService({ gamePokerRoom: { create: async ({ data }: any) => data } } as PrismaService, {} as HallService)
    for (const buyIn of [1000, 5000, 10000, 50000]) {
      expect(await poker.createRoom("owner", { mode, maxSeats: 6, buyIn, name: "房间" })).toHaveProperty("roomCode")
    }
    for (const buyIn of [500, 2000, 1001, 50001]) {
      await expect(poker.createRoom("owner", { mode, maxSeats: 6, buyIn, name: "房间" })).rejects.toMatchObject({ response: { code: "POKER_ILLEGAL_ACTION" } })
    }
  })

  function legacyRoom(humans: number, count: number) {
    const room = { id: "room", code: "1234", maxSeats: 10, status: "waiting", mode: "practice", ownerUserId: "owner" }
    const seats = Array.from({ length: count }, (_, seatNo) => ({ seatNo, userId: `user-${seatNo}`, participantKind: seatNo < humans ? "account" : "bot" }))
    const tx = { $queryRaw: async () => [room], gamePokerSeat: { findMany: async () => seats }, gamePokerBot: { findUnique: async () => null } }
    const poker = new PokerService({ $transaction: async (work: any) => work(tx) } as PrismaService, {} as HallService)
    return poker
  }
  it("旧10座房已有6人时拒绝真人和AI加入", async () => {
    for (const caller of ["human", "mcp"] as const) {
      await expect(legacyRoom(6, 6).join("new-user", "1234", {}, new Date(), caller))
        .rejects.toMatchObject({ response: { code: "POKER_ROOM_FULL" } })
    }
  })
  it.each([[1, 6], [0, 5]])("旧房有%s位真人、共%s人时不再添加机器人并预留真人位置", async (humans, count) => {
    await expect(new PokerBotService(legacyRoom(humans, count)).add("owner", "1234", randomUUID()))
      .rejects.toMatchObject({ response: { code: "POKER_ROOM_FULL" } })
  })
})
