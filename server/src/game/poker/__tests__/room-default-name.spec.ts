import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../../../prisma/prisma.service"
import type { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"

describe("默认房间名称", () => {
  function setup(nickname = "李杨") {
    const create = vi.fn(async ({ data }) => ({ ...data })),
      findUnique = vi.fn(async () => ({ nickname, handle: "liyang" }))
    const service = new PokerService({ gamePokerRoom: { create }, user: { findUnique } } as unknown as PrismaService, {} as HallService)
    return { service, create, findUnique }
  }
  it.each([undefined, "", " \n\t "])("未指定名称 %s 使用账号昵称并带实际房间号", async (name) => {
    const { service, create } = setup()
    const result = await service.createRoom("user", { name, maxSeats: 6, buyIn: 1000 })
    expect(create.mock.calls[0][0].data.name).toBe(`李杨的房间 #${result.roomCode}`)
  })
  it("自定义名称保持原样", async () => {
    const { service, create } = setup()
    await service.createRoom("user", { name: "朋友的牌桌", maxSeats: 6, buyIn: 1000 })
    expect(create.mock.calls[0][0].data.name).toBe("朋友的牌桌")
  })
  it("缺少昵称时回退账号名", async () => {
    const { service, create } = setup("")
    const result = await service.createRoom("user", { maxSeats: 6, buyIn: 1000 })
    expect(create.mock.calls[0][0].data.name).toBe(`liyang的房间 #${result.roomCode}`)
  })
  it("房间号碰撞重试时名称匹配最终成功的房间号", async () => {
    const { service, create } = setup()
    create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("collision", { code: "P2002", clientVersion: "test" }))
    const result = await service.createRoom("user", { maxSeats: 6, buyIn: 1000 })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0].data.name).toBe(`李杨的房间 #${result.roomCode}`)
  })
  it("长昵称仍保留完整房间号且名称不超过48字", async () => {
    const { service, create } = setup("长".repeat(60))
    const result = await service.createRoom("user", { maxSeats: 6, buyIn: 1000 })
    const name = create.mock.calls[0][0].data.name
    expect(name.length).toBeLessThanOrEqual(48)
    expect(name.endsWith(`的房间 #${result.roomCode}`)).toBe(true)
  })
})
