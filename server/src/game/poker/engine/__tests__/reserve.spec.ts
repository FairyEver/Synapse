import { describe, expect, it } from "vitest"
import { applyReserveOperation, assertReserveIntegrity, lastReserveDeposit } from "../chips/reserve"
import type { ReserveState, ReserveOperation } from "../chips/types"
import { cardContext } from "../../__tests__/card-test-fixtures"

const person = (n: number) => ({ admissionId: String(n), userId: `user-${n}`, seatNo: n })
const order = [1, 2, 3, 0]
const empty = (): ReserveState => ({ revision: 0, lots: [], claims: [], movements: [], finalized: false })
function run(state: ReserveState, operation: ReserveOperation, seq = 1) {
  return applyReserveOperation(state, operation, cardContext({ actionSeq: seq, rootActionId: `action-${seq}` }), order)
}
function deposit(state: ReserveState, amount: number, seq = 1) {
  return run(state, { kind: "deposit", payer: person(0), recipients: [person(1), person(2), person(3)], amount, sourceId: `deposit-${seq}`, sourceType: "roll" }, seq)
}
describe("可追溯暂存", () => {
  it("份额只保留入座资金身份，不扩散真人或行动状态字段至持久层", () => {
    const recipient = { ...person(1), kind: "human", folded: false, allIn: false }
    const result = run(empty(), { kind: "deposit", payer: person(0), recipients: [recipient], amount: 4, sourceId: "card", sourceType: "card" })
    expect(Object.keys(result.state.claims[0]).sort()).toEqual(["admissionId", "id", "lotId", "originalAmount", "remainingAmount", "seatNo", "status", "userId"])
  })
  it("deposit_120_steal_60_refund_60：取回不追溯已经偷到手的60", () => {
    const original = empty(), paid = deposit(original, 120)
    expect(paid.debits).toEqual({ 0: 120 })
    expect(paid.state.claims.map(c => c.remainingAmount)).toEqual([40, 40, 40])
    const stolen = run(paid.state, { kind: "steal", actorAdmissionId: "1", cap: 60, target: "all" }, 2)
    expect(stolen.state.claims.map(c => c.remainingAmount)).toEqual([40, 10, 10])
    expect(stolen.credits).toEqual({ 1: 60 })
    const refunded = run(stolen.state, { kind: "refund", actorAdmissionId: "0", lotId: paid.state.lots[0].id }, 3)
    expect(refunded.amount).toBe(60); expect(refunded.credits).toEqual({ 0: 60 })
    expect(refunded.state.claims.map(c => c.remainingAmount)).toEqual([0, 0, 0])
    expect(original).toEqual(empty())
    assertReserveIntegrity(refunded.state)
  })
  it("拆分同一付款不改变受益人总损失，两级取整按庄家左侧与原序号", () => {
    const one = deposit(empty(), 120).state
    const split = deposit(deposit(empty(), 60).state, 60, 2).state
    const totals = (s: ReserveState) => [1, 2, 3].map(n => s.claims.filter(c => c.admissionId === String(n)).reduce((sum, c) => sum + c.remainingAmount, 0))
    const steal: ReserveOperation = { kind: "steal", actorAdmissionId: "1", cap: 31, target: "all" }
    expect(totals(run(one, steal, 3).state)).toEqual([40, 24, 25])
    expect(totals(run(split, steal, 3).state)).toEqual([40, 24, 25])
    expect(run(split, steal, 3).state.claims.filter(c => c.admissionId === "2").map(c => c.remainingAmount)).toEqual([12, 12])
  })
  it("群体盗取剔除受保护人再分摊；定向富者被护盾阻止不会换目标", () => {
    const state = deposit(empty(), 120).state
    const all = run(state, { kind: "steal", actorAdmissionId: "1", cap: 60, target: "all", protectedAdmissions: ["2"] }, 2)
    expect(all.amount).toBe(40); expect(all.protectedAdmissions).toEqual(["2"])
    expect(all.state.claims.map(c => c.remainingAmount)).toEqual([40, 40, 0])
    const richest = run(state, { kind: "steal", actorAdmissionId: "1", cap: 60, target: "richest", protectedAdmissions: ["2"] }, 2)
    expect(richest.amount).toBe(0); expect(richest.credits).toEqual({})
    expect(richest.state.claims.map(c => c.remainingAmount)).toEqual([40, 40, 40])
  })
  it("最近正额批次不跳过已空，不将当前卡费作为退款目标", () => {
    let state = deposit(empty(), 120).state
    state = deposit(state, 30, 2).state
    const last = lastReserveDeposit(state, "0", 3)!
    state = run(state, { kind: "refund", actorAdmissionId: "0", lotId: last.id, cap: 30 }, 3).state
    state = deposit(state, 10, 4).state
    expect(lastReserveDeposit(state, "0", 4)?.id).toBe(last.id)
    expect(() => run(state, { kind: "refund", actorAdmissionId: "0", lotId: last.id }, 4)).toThrow("POKER_RESERVE_EMPTY")
    expect(() => run(state, { kind: "refund", actorAdmissionId: "new-same-seat", lotId: state.lots[0].id }, 4)).toThrow()
    expect(deposit(state, 0, 5).state.lots).toHaveLength(3)
  })
  it("部分退款和结算重试守恒；既定资格不由当前座位身份替代", () => {
    const paid = deposit(empty(), 121)
    const returned = run(paid.state, { kind: "refund", actorAdmissionId: "0", lotId: paid.state.lots[0].id, cap: 31 }, 2)
    expect(returned.state.claims.map(c => c.remainingAmount)).toEqual([30, 30, 30])
    const final = run(returned.state, { kind: "finalize" }, 3)
    expect(final.credits).toEqual({ 1: 30, 2: 30, 3: 30 })
    expect(final.amount + returned.amount).toBe(121)
    const retry = run(final.state, { kind: "finalize" }, 4)
    expect(retry.amount).toBe(0); expect(retry.state).toEqual(final.state)
    assertReserveIntegrity(final.state)
    expect(() => deposit(final.state, 1, 5)).toThrow()
  })
  it("来源幂等且不允许篡改金额，无受益人的正额存入必须拒绝", () => {
    const first = deposit(empty(), 10)
    expect(deposit(first.state, 10).debits).toEqual({})
    expect(() => deposit(first.state, 20)).toThrow("POKER_RESERVE_SOURCE_CONFLICT")
    expect(() => run(empty(), { kind: "deposit", payer: person(0), recipients: [], amount: 1, sourceId: "x", sourceType: "card" })).toThrow()
  })
})
