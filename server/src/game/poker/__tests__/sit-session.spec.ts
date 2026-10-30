import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("暂离的大厅会话索引", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall),
    actions = new PokerActionService(poker)
  afterAll(() => db.$disconnect())
  async function status(userId: string, roomCode: string) {
    return (await hall.overview(userId)).sessions.find((s) => s.roomCode === roomCode)
  }
  async function fold(userId: string, code: string) {
    const state = await actions.state(userId, code)
    await actions.act(userId, code, {
      handId: state.handId!,
      street: state.street!,
      actionId: randomUUID(),
      action: "fold",
    })
  }
  it("未开手时暂离立即反映到overview，回座恢复waiting且不重复扣款", async () => {
    const a = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(a, code, {})
    expect(await status(a, code)).toMatchObject({ status: "waiting", needsAction: false })
    await poker.sit(a, code, true)
    expect(await status(a, code)).toMatchObject({
      status: "sitting_out",
      needsAction: false,
      deadlineMs: null,
    })
    await poker.sit(a, code, false)
    expect(await status(a, code)).toMatchObject({ status: "waiting", needsAction: false })
    expect((await hall.overview(a)).points.available).toBe(999000)
  })
  it("手中请求暂离仍保持active与行动点，结算后才标暂离，回座恢复active", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(a, code, {})
    await poker.join(b, code, {})
    expect(await status(a, code)).toMatchObject({ status: "active", needsAction: true })
    const pending = await poker.sit(a, code, true)
    expect(pending).toMatchObject({ sittingOut: true, pending: true, status: "active" })
    expect(await status(a, code)).toMatchObject({ status: "active", needsAction: true })
    await fold(a, code)
    expect(await status(a, code)).toMatchObject({
      status: "sitting_out",
      needsAction: false,
      deadlineMs: null,
    })
    expect((await actions.state(a, code)).status).toBe("paused")
    const resumed = await poker.sit(a, code, false)
    expect(resumed).toMatchObject({ sittingOut: false, pending: false, status: "active" })
    expect(await status(a, code)).toMatchObject({ status: "active" })
    expect((await actions.state(a, code)).handNo).toBe(2)
    expect((await hall.overview(a)).points.available).toBe(999000)
  })
  it("他人继续打牌时本人回座先保持waiting，下一手才同步active", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 3, buyIn: 1000 })).roomCode
    for (const user of [a, b, c]) await poker.join(user, code, {})
    await poker.sit(a, code, true)
    await fold(a, code)
    expect(await status(a, code)).toMatchObject({ status: "sitting_out" })
    expect((await actions.state(a, code)).handNo).toBe(2)
    expect(await poker.sit(a, code, false)).toMatchObject({
      sittingOut: false,
      pending: false,
      status: "waiting",
    })
    expect(await status(a, code)).toMatchObject({
      status: "waiting",
      needsAction: false,
      deadlineMs: null,
    })
    await fold(b, code)
    expect((await actions.state(a, code)).handNo).toBe(3)
    expect(await status(a, code)).toMatchObject({ status: "active" })
  })
})
