import { afterAll, describe, expect, it } from "vitest"
import { BadRequestException } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService, json } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { PokerArchiveService } from "../poker-archive.service"
import { startHand } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"
import { gameTestDatabaseUrl } from "./test-database"
import { advanceNextHand } from "./advance-next-hand"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("离桌后的结算游标", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db)),
    actions = new PokerActionService(poker),
    wait = new PokerWaitService(actions),
    archive = new PokerArchiveService(db)
  afterAll(() => {
    wait.onModuleDestroy()
    return db.$disconnect()
  })
  async function table(now = new Date()) {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(a, code, {}, now)
    await poker.join(b, code, {}, now)
    const handId = (await actions.state(a, code)).handId!
    let clock = now
    async function advance() { clock = await advanceNextHand(actions, code) }
    async function move(userId: string, action: "fold" | "allin" | "call") {
      const state = await actions.state(userId, code)
      return actions.act(
        userId,
        code,
        {
          handId: state.handId!,
          street: state.street!,
          actionId: randomUUID(),
          action,
        },
        new Date(clock.getTime() + 1),
      )
    }
    return { a, b, code, handId, now, move, advance }
  }
  async function resultThenClosed(userId: string, code: string, expected: Record<string, unknown>) {
    const result = await wait.wait(userId, code, "1:0", 0)
    expect(result).toMatchObject({ status: "hand_result", handNo: 1, ...expected })
    expect(Object.keys(result).sort()).toEqual([
      "cursor",
      "delta",
      "handNo",
      "result",
      "stack",
      "status",
    ])
    expect(await wait.wait(userId, code, result.cursor, 0)).toMatchObject({
      status: "table_closed",
    })
    return result
  }
  it("主动离桌本手结束后先收到结果，再收到离桌状态", async () => {
    const t = await table()
    await poker.leave(t.a, t.code)
    await t.move(t.a, "fold")
    await resultThenClosed(t.a, t.code, { result: "lost", delta: -1, stack: 999 })
  })
  it("房主要求手后解散时双方仍各收到本人的结算", async () => {
    const t = await table()
    await poker.close(t.a, t.code)
    await t.move(t.a, "fold")
    await resultThenClosed(t.a, t.code, { result: "lost", delta: -1, stack: 999 })
    await resultThenClosed(t.b, t.code, { result: "won", delta: 1, stack: 1001 })
  })
  it("输光被自动移出座位仍收到零筹码结算", async () => {
    const t = await table(),
      prefix = ["As", "Kc", "Ah", "Qd", "2c", "2h", "3d", "7c", "3c", "8s", "4c", "9h"],
      deck = [...prefix, ...orderedDeck().filter((card) => !prefix.includes(card))],
      state = startHand(
        [
          { seatNo: 0, stack: 1000 },
          { seatNo: 1, stack: 1000 },
        ],
        0,
        deck,
      )
    await poker.withRoom(t.code, async (c) => {
      await c.tx.gamePokerHand.update({
        where: { id: t.handId },
        data: { engineState: json(state) },
      })
      for (const seat of state.seats)
        await c.tx.gamePokerHandSeat.update({
          where: { handId_seatNo: { handId: t.handId, seatNo: seat.seatNo } },
          data: { holeCards: seat.hole },
        })
    })
    await t.move(t.a, "allin")
    await t.move(t.b, "call")
    await resultThenClosed(t.a, t.code, { result: "lost", delta: -1000, stack: 0 })
  })
  it("离桌后的未消费结算归档后仍可读取且不会随游标重复", async () => {
    const t = await table(new Date(Date.now() - 91 * 86400000))
    await poker.close(t.a, t.code)
    await t.move(t.a, "fold")
    expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
    await resultThenClosed(t.a, t.code, { result: "lost", delta: -1, stack: 999 })
    await resultThenClosed(t.b, t.code, { result: "won", delta: 1, stack: 1001 })
    expect(await wait.wait(randomUUID(), t.code, "1:0", 0)).toMatchObject({
      status: "table_closed",
    })
  })
  it.each([false, true])("重新入座后旧游标不重放上次入座结果，旧手已归档=%s", async (archived) => {
    const t = await table(new Date(Date.now() - 91 * 86400000))
    await poker.leave(t.a, t.code)
    await t.move(t.a, "fold")
    if (archived) expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
    const now = new Date(t.now.getTime() + 5002)
    await poker.join(t.a, t.code, {}, now)
    const pending = await wait.wait(t.a, t.code, "1:0", 0, undefined, now)
    expect(pending).toMatchObject({ status: "ready_required", handId: t.handId, cursor: "1:2147483647" })
    await advanceNextHand(actions, t.code)
    const started = await wait.wait(t.a, t.code, pending.cursor, 0, undefined, now)
    expect(started.status).toBe("waiting")
    expect(started.cursor).toBe("2:0")
    await poker.leave(t.a, t.code, now)
    const state = await actions.state(t.b, t.code)
    await actions.act(
      t.b,
      t.code,
      { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "fold" },
      now,
    )
    const result = await wait.wait(t.a, t.code, "1:0", 0, undefined, now)
    expect(result).toMatchObject({
      status: "hand_result",
      handNo: 2,
      result: "won",
      delta: 1,
      stack: 1001,
    })
    expect(await wait.wait(t.a, t.code, result.cursor, 0, undefined, now)).toMatchObject({
      status: "table_closed",
    })
  })
  it("归档与读取结算竞争时仍拿到一致摘要", async () => {
    const t = await table(new Date(Date.now() - 91 * 86400000))
    await poker.close(t.a, t.code)
    await t.move(t.a, "fold")
    const [archived, result] = await Promise.all([
      archive.archiveHand(t.handId, new Date()),
      wait.wait(t.a, t.code, "1:0", 0),
    ])
    expect(archived).toBe(true)
    expect(result).toMatchObject({
      status: "hand_result",
      handNo: 1,
      result: "lost",
      delta: -1,
      stack: 999,
    })
    expect(await wait.wait(t.a, t.code, result.cursor, 0)).toMatchObject({ status: "table_closed" })
  })
  it("慢客户端积压200手后按游标逐条消费，不漏手、不重放并恢复当前行动", async () => {
    const t = await table()
    for (let handNo = 1; handNo <= 200; handNo++) {
      const state = await actions.state(t.a, t.code)
      expect(state.handNo).toBe(handNo)
      await t.move(state.actionOnSeat === 0 ? t.a : t.b, "fold")
      await t.advance()
    }
    let cursor = "1:0"
    for (let handNo = 1; handNo <= 200; handNo++) {
      const result = await wait.wait(t.a, t.code, cursor, 0)
      expect(result).toMatchObject({
        status: "hand_result",
        handNo,
        delta: handNo % 2 ? -1 : 1,
        stack: handNo % 2 ? 999 : 1000,
      })
      cursor = result.cursor
    }
    expect(await wait.wait(t.a, t.code, cursor, 0)).toMatchObject({
      status: "your_turn",
      handNo: 201,
    })
  }, 30000)
  it("空游标重连保持直接恢复当前行动，不追补旧结算", async () => {
    const t = await table()
    await t.move(t.a, "fold")
    await t.advance()
    const result = await wait.wait(t.b, t.code, "", 0)
    expect(result).toMatchObject({ status: "your_turn", handNo: 2 })
  })
  it("超时自动行动的单次提示优先于普通结算", async () => {
    const t = await table()
    await actions.expire(t.code, new Date(t.now.getTime() + 600000))
    expect(await wait.wait(t.a, t.code, "1:0", 0)).toMatchObject({
      status: "table_closed",
      lastAutoAction: { handNo: 1, action: "fold", reason: "timeout" },
    })
  })
  it.each(["2147483648:0", "1:2147483648", `${"9".repeat(400)}:0`, `1:${"9".repeat(400)}`])(
    "越界游标%s返回业务400而不是查询500",
    async (cursor) => {
      const t = await table()
      await expect(wait.wait(t.a, t.code, cursor, 0)).rejects.toBeInstanceOf(BadRequestException)
      await expect(wait.wait(t.a, t.code, cursor, 0)).rejects.toMatchObject({
        response: { code: "POKER_ILLEGAL_ACTION" },
      })
    },
  )
  it("int32最大游标与结果哨兵组合不溢出数据库边界", async () => {
    const t = await table()
    expect(await wait.wait(t.b, t.code, "2147483647:2147483647", 0)).toEqual({
      status: "waiting",
      cursor: "2147483647:2147483647",
    })
  })
})
