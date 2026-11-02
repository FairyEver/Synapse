import { describe, expect, it } from "vitest"
import { applyDeadlineOperation } from "../cards/deadlines"

describe("卡牌时限", () => {
  it("clock_keeps_start：按剩余时间翻倍，延时不能超过起点1200秒", () => {
    let clock = applyDeadlineOperation(null, { kind: "start", seatNo: 0, turnId: "t" }, 0)!
    clock = applyDeadlineOperation(clock, { kind: "double" }, 100000)!
    expect(clock).toMatchObject({ startedAt: 0, deadlineAt: 1100000 })
    clock = applyDeadlineOperation(clock, { kind: "extend", milliseconds: 60000 }, 100000)!
    clock = applyDeadlineOperation(clock, { kind: "double" }, 100000)!
    expect(clock.deadlineAt).toBe(1200000)
  })
  it("缩时记录实际量，期限内净化只返还一次，超时不能复活", () => {
    const clock = applyDeadlineOperation(null, { kind: "start", seatNo: 1, turnId: "t", reductions: [{ id: "slow", milliseconds: 300000 }] }, 0)!
    expect(clock.deadlineAt).toBe(300000)
    const restored = applyDeadlineOperation(clock, { kind: "restore", effectId: "slow" }, 200000)!
    expect(restored.deadlineAt).toBe(600000)
    expect(applyDeadlineOperation(restored, { kind: "restore", effectId: "slow" }, 200000)).toEqual(restored)
    expect(() => applyDeadlineOperation(clock, { kind: "restore", effectId: "slow" }, 300000)).toThrow("POKER_ACTION_EXPIRED")
    expect(clock.deadlineAt).toBe(300000)
  })
  it("缓流只影响新回合，缩时仍可手动延长", () => {
    const clock = applyDeadlineOperation(null, { kind: "start", seatNo: 1, turnId: "t", bonusMs: 60000, reductions: [{ id: "slow", milliseconds: 300000 }] }, 10)!
    expect(clock.deadlineAt).toBe(360010)
    expect(applyDeadlineOperation(clock, { kind: "extend", milliseconds: 60000 }, 100010)!.deadlineAt).toBe(420010)
    expect(() => applyDeadlineOperation(clock, { kind: "extend", milliseconds: -1 }, 1)).toThrow()
  })
})
