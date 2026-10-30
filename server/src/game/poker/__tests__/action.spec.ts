import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { gameTestDatabaseUrl } from "./test-database"
import { advanceNextHand } from "./advance-next-hand"
const url = gameTestDatabaseUrl()
const suite = url ? describe : describe.skip
suite("权威行动、隐私与重连", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall),
    actions = new PokerActionService(poker),
    waiter = new PokerWaitService(actions)
  afterAll(() => db.$disconnect())
  async function table() {
    const a = randomUUID(),
      b = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 6, buyIn: 1000 })).roomCode
    const agent = await poker.upsertAgent(a, { persona: "旧风格" })
    await poker.join(a, code, { agentId: agent.id }, new Date(0))
    await poker.join(b, code, {}, new Date(0))
    return { a, b, code, agent }
  }
  async function request(a: string, code: string) {
    const s = await actions.state(a, code, "owner", false, new Date(1))
    return { handId: s.handId!, street: s.street!, actionId: randomUUID(), action: "call" as const }
  }
  it("轮次、旧手、旧街道、非法check、加注范围、观战者均被拒绝，窗口不变", async () => {
    const { a, b, code } = await table(),
      req = await request(a, code)
    await expect(actions.act(b, code, req, new Date(1))).rejects.toMatchObject({
      response: { code: "POKER_NOT_YOUR_TURN" },
    })
    await expect(
      actions.act(a, code, { ...req, handId: "old" }, new Date(1)),
    ).rejects.toMatchObject({ response: { code: "POKER_STALE_ACTION" } })
    await expect(
      actions.act(a, code, { ...req, street: "flop" }, new Date(1)),
    ).rejects.toMatchObject({ response: { code: "POKER_STALE_ACTION" } })
    for (const d of [
      { action: "check" as const },
      { action: "raise" as const, to: 3 },
      { action: "raise" as const, to: 1001 },
    ])
      await expect(actions.act(a, code, { ...req, ...d }, new Date(1))).rejects.toMatchObject({
        response: { code: "POKER_ILLEGAL_ACTION" },
      })
    await expect(actions.act("spectator", code, req, new Date(1))).rejects.toMatchObject({
      response: { code: "POKER_SEAT_NOT_FOUND" },
    })
    expect((await actions.state(a, code, "owner", false, new Date(1))).deadlineMs).toBe(599999)
  })
  it("actionId三次相同返回同一响应，只插一条；当前版本与note同事务且私密", async () => {
    const { a, b, code, agent } = await table(),
      req = await request(a, code)
    await poker.upsertAgent(a, { id: agent.id, persona: "新风格" })
    const turn = await waiter.wait(a, code, "", 0, undefined, new Date(1))
    expect(turn).toMatchObject({ status: "your_turn", persona: "新风格" })
    const result = await actions.act(a, code, { ...req, note: "我选择跟注" }, new Date(10))
    expect(await actions.act(a, code, req, new Date(11))).toEqual(result)
    expect(await actions.act(a, code, req, new Date(12))).toEqual(result)
    expect(await db.gamePokerAction.count({ where: { actionId: req.actionId } })).toBe(1)
    const row = await db.gamePokerAction.findUniqueOrThrow({ where: { actionId: req.actionId } })
    expect(row.personaVersionId).not.toBeNull()
    const other = JSON.stringify(await actions.state(b, code, "owner", false, new Date(20)))
    expect(other).not.toContain("新风格")
    expect(other).not.toContain("我选择跟注")
    expect(other).not.toContain("personaVersion")
    const view = await actions.state(a, code, "public", false, new Date(20))
    expect(view.seats.every((s) => !s.hole)).toBe(true)
    expect(JSON.stringify(view)).not.toContain("我选择跟注")
  })
  it("60秒离线但不提前弃牌，600秒超时离场退款且只通知一次", async () => {
    const { a, code } = await table()
    const before = await actions.state(a, code, "owner", false, new Date(61000))
    expect(before.seats.find((s) => s.isMe)?.aiState).toBe("offline")
    expect((await hall.overview(a, new Date(120000))).sessions).toHaveLength(1)
    await actions.expire(code, new Date(599999))
    expect((await hall.overview(a)).sessions).toHaveLength(1)
    await actions.expire(code, new Date(600000))
    expect((await hall.overview(a)).sessions).toHaveLength(0)
    expect((await hall.overview(a)).points.available).toBe(999999)
    expect(await waiter.wait(a, code, "", 0, undefined, new Date(600001))).toMatchObject({
      lastAutoAction: { action: "fold", reason: "timeout" },
    })
    expect(await waiter.wait(a, code, "", 0, undefined, new Date(600002))).not.toHaveProperty(
      "lastAutoAction",
    )
  })
  it("无人干预的两个测试客户端连续推进10手，wait非轮次仅status/cursor", async () => {
    const { a, b, code } = await table()
    const waiting = await waiter.wait(b, code, "", 0)
    expect(Object.keys(waiting).sort()).toEqual(["cursor", "status"])
    let done = 0
    let now = new Date(1)
    for (let i = 0; i < 1000 && done < 10; i++) {
      for (const user of [a, b]) {
        const state = await actions.state(user, code, "owner", false, now)
        if (state.street === "settled") { now = await advanceNextHand(actions, code); continue }
        done = state.handNo - 1
        if (state.actionOnSeat !== state.mySeatNo) continue
        await actions.act(
          user,
          code,
          {
            handId: state.handId!,
            street: state.street!,
            actionId: randomUUID(),
            action: state.toCall ? "call" : "check",
          },
          new Date(now.getTime() + 1),
        )
      }
    }
    expect(done).toBeGreaterThanOrEqual(10)
    const pointA = (await hall.overview(a)).points,
      pointB = (await hall.overview(b)).points
    expect(pointA.total + pointB.total).toBe(2000000)
  })
  it("无欠注超时记录check但离场，不得继续赢池；通知携带原手编号", async () => {
    const { a, b, code } = await table(),
      req = await request(a, code)
    await actions.act(a, code, req, new Date(1))
    await actions.expire(code, new Date(600001))
    expect((await hall.overview(b)).sessions).toEqual([])
    expect(await waiter.wait(b, code, "", 0)).toMatchObject({
      lastAutoAction: { handNo: 1, action: "check" },
    })
    expect((await hall.overview(a)).points.total + (await hall.overview(b)).points.total).toBe(
      2000000,
    )
  })
  it("同一行动与超时竞争只有一个生效，拒绝第二个不同actionId", async () => {
    const { a, code } = await table(),
      req = await request(a, code)
    const result = await Promise.allSettled([
      actions.act(a, code, req, new Date(599000)),
      actions.expire(code, new Date(599000)),
    ])
    expect(result.every((r) => r.status === "fulfilled")).toBe(true)
    expect(await db.gamePokerAction.count({ where: { handId: req.handId, userId: a } })).toBe(1)
    await expect(
      actions.act(a, code, { ...req, actionId: randomUUID() }, new Date(599001)),
    ).rejects.toThrow()
  })
  it("长轮询被行动唤醒，手结束后能消费同手cursor之后的结果", async () => {
    const { a, b, code } = await table(),
      req = await request(a, code)
    const waiting = waiter.wait(b, code, "1:0", 25000)
    await actions.act(a, code, { ...req, action: "fold" }, new Date(1))
    const result = await waiting
    expect(result.status).toBe("hand_result")
    expect(result.handNo).toBe(1)
  })

  it("超时后同一位置的新座位不能继承上一选手底牌或筹码", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID(),
      d = randomUUID(),
      code = (await poker.createRoom(a, { maxSeats: 3, buyIn: 1000 })).roomCode
    await poker.join(a, code, {}, new Date(0))
    await poker.join(b, code, {}, new Date(0))
    await poker.join(c, code, {}, new Date(0))
    // The third seat joins mid-hand; finish the heads-up hand to bring all three in.
    let view = await actions.state(a, code, "owner", false, new Date(1))
    await actions.act(
      a,
      code,
      { handId: view.handId!, street: view.street!, actionId: randomUUID(), action: "fold" },
      new Date(1),
    )
    const nextAt = await advanceNextHand(actions, code)
    const next = await actions.state(b, code, "owner", false, nextAt)
    const actor = [a, b, c][next.actionOnSeat!]
    await actions.expire(code, new Date(nextAt.getTime() + 600000))
    await poker.join(d, code, {}, new Date(nextAt.getTime() + 600001))
    view = await actions.state(d, code, "owner", false, new Date(600003))
    expect(view.hole).toEqual([])
    expect(view.seats.find((s) => s.isMe)?.hole).toBeUndefined()
    expect(view.seats.find((s) => s.isMe)?.stack).toBe(1000)
    const other = [a, b, c].find((user) => user !== actor)!
    const state = await actions.state(other, code, "owner", false, new Date(600003))
    const actingUser = [a, b, c][state.actionOnSeat!]
    await actions.act(
      actingUser,
      code,
      { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "call" },
      new Date(600004),
    )
    expect(
      (await actions.state(d, code, "owner", false, new Date(600005))).seats.find((s) => s.isMe)
        ?.stack,
    ).toBe(1000)
  })

  it("会话口述覆盖不绑定游戏内版本，也不会写回持久提示词", async () => {
    const { a, code, agent } = await table(),
      req = await request(a, code)
    await actions.act(a, code, { ...req, personaSource: "session" }, new Date(2))
    expect(
      (await db.gamePokerAction.findUniqueOrThrow({ where: { actionId: req.actionId } }))
        .personaVersionId,
    ).toBeNull()
    expect((await db.gamePokerAgent.findUniqueOrThrow({ where: { id: agent.id } })).persona).toBe(
      "旧风格",
    )
  })
})
