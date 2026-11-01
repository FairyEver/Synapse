import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { saveHand, engine } from "../poker-lifecycle"
import { act as engineAct } from "../engine/hand-runner"
import { gameTestDatabaseUrl } from "./test-database"
import { advanceNextHand, scopedDeadlineTask } from "./advance-next-hand"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("独立审查回归", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall),
    actions = new PokerActionService(poker),
    wait = new PokerWaitService(actions)
  afterAll(() => {
    wait.onModuleDestroy()
    return db.$disconnect()
  })
  async function table() {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(a, code, {})
    await poker.join(b, code, {})
    return { a, b, code }
  }
  it("盲注直接结算保留结果，全员准备后继续开局或暂停", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(a, code, {})
    await db.gamePokerSeat.updateMany({ where: { userId: a }, data: { stack: 1 } })
    await db.gameSession.updateMany({ where: { userId: a }, data: { inPlay: 1 } })
    await db.gameAccount.update({ where: { userId: a }, data: { points: { increment: 999 } } })
    await poker.join(b, code, {})
    let state = await actions.state(b, code)
    if (state.status === "running" && state.street === "settled") {
      expect(state.actionOnSeat).toBeNull()
      expect(state.deadlineMs).toBeNull()
      expect(state.nextHandAt).toBeNull()
      await advanceNextHand(actions, code)
      state = await actions.state(b, code)
    }
    expect(
      state.status === "paused" || (state.street !== "settled" && state.deadlineMs !== null),
    ).toBe(true)
  })
  it("空cursor重连直达当前行动，wait每次刷新心跳", async () => {
    const { a, b, code } = await table()
    for (let i = 0; i < 5; i++) {
      const view = await actions.state(a, code)
      const user = view.actionOnSeat === 0 ? a : b
      await actions.act(user, code, {
        handId: view.handId!,
        street: view.street!,
        actionId: randomUUID(),
        action: "fold",
      })
      await advanceNextHand(actions, code)
    }
    const current = await actions.state(a, code),
      user = current.actionOnSeat === 0 ? a : b,
      now = new Date()
    const result = await wait.wait(user, code, "", 0, undefined, now)
    expect(result.status).toBe("your_turn")
    expect(
      (await db.gamePokerSeat.findFirstOrThrow({ where: { userId: user } })).lastSeenAt.getTime(),
    ).toBe(now.getTime())
  })
  it("暂停桌消费结果后游标单调，不能重复返回同一结果", async () => {
    const { a, b, code } = await table(),
      view = await actions.state(a, code)
    await poker.sit(a, code, true)
    await actions.act(a, code, {
      handId: view.handId!,
      street: view.street!,
      actionId: randomUUID(),
      action: "fold",
    })
    const result = await wait.wait(b, code, "1:0", 0)
    expect(result.status).toBe("hand_result")
    const next = await wait.wait(b, code, result.cursor, 0)
    expect(next.status).toBe("ready_required")
    expect(next.cursor).toBe(result.cursor)
    if (next.status !== "ready_required") throw new Error("等待显式准备信号")
    await poker.ready(b, code, next.handId, next.controlVersion)
    expect((await wait.wait(b, code, next.cursor, 0)).status).toBe("waiting")
  })
  it("房主可要求本手结束后解散，停止连续发牌并事务退款", async () => {
    const { a, b, code } = await table(),
      view = await actions.state(a, code)
    await expect(poker.close(a, code)).resolves.toMatchObject({ pending: true })
    await actions.act(a, code, {
      handId: view.handId!,
      street: view.street!,
      actionId: randomUUID(),
      action: "fold",
    })
    expect((await actions.state(a, code)).status).toBe("closed")
    expect((await hall.overview(a)).sessions).toEqual([])
    expect((await hall.overview(b)).sessions).toEqual([])
    expect((await hall.overview(a)).points.total + (await hall.overview(b)).points.total).toBe(
      2000000,
    )
  })
  it("自动续局预算之间收到解散请求时不能再开新手", async () => {
    const { a, b, code } = await table()
    await poker.withRoom(code, async (c) => {
      const hand = await c.tx.gamePokerHand.findUniqueOrThrow({
        where: { id: c.room.currentHandId! },
      })
      await saveHand(poker, c, hand, engineAct(engine(hand), 0, { action: "fold" }))
      await c.tx.gamePokerRoom.update({
        where: { id: c.room.id },
        data: { actionDeadlineAt: new Date(0) },
      })
    })
    await poker.close(a, code)
    await actions.expire(code)
    const state = await actions.state(b, code)
    expect(state.status).toBe("closed")
    expect(state.handNo).toBe(1)
    expect((await hall.overview(a)).points.total + (await hall.overview(b)).points.total).toBe(
      2000000,
    )
  })
  it("维护轮转能处理第101个房间，不被100个在线等候房间饿死", async () => {
    const now = new Date(),
      rooms = []
    for (let i = 0; i < 100; i++) {
      const created = await poker.createRoom("maintenance", { maxSeats: 2, buyIn: 1000 })
      rooms.push(
        await db.gamePokerRoom.update({
          where: { code: created.roomCode },
          data: { createdAt: new Date(now.getTime() - 7200000) },
        }),
      )
    }
    await db.gamePokerSeat.createMany({
      data: rooms.map((r) => ({
        roomId: r.id,
        userId: randomUUID(),
        seatNo: 0,
        displayName: "在线等待",
        stack: 1,
        lastSeenAt: now,
      })),
    })
    const created = await poker.createRoom("cold", { maxSeats: 2, buyIn: 1000 })
    const cold = await db.gamePokerRoom.update({
      where: { code: created.roomCode },
      data: { createdAt: new Date(now.getTime() - 3600000) },
    })
    const task = scopedDeadlineTask(actions, [...rooms.map((r) => r.code), cold.code])
    await task.scan(now)
    await task.scan(new Date(now.getTime() + 30000))
    expect((await db.gamePokerRoom.findUniqueOrThrow({ where: { id: cold.id } })).status).toBe(
      "closed",
    )
  }, 30000)
})
