import { describe, expect, it } from "vitest"
import { applyCardPoolOperation, assertCardPoolIntegrity, createCardPool } from "../cards/pool"
import type { CardDefinition, ResolutionContext } from "../cards/types"

const def = (id: string, copies?: number): CardDefinition => ({ id, name: id, description: id, artId: id, copies, tags: [], selections: [], steps: [] })
function context(): ResolutionContext { let n = 0; return { handId: "h", actionSeq: 1, rootActionId: "root", actorSeatNo: 0, actorAdmissionId: "a0", source: "human", nowMs: 0, randomInt: () => 0, nextId: () => `instance-${++n}` } }
const players = (humans: number, bots = 0) => Array.from({ length: humans + bots }, (_, i) => ({ admissionId: `a${i}`, userId: `u${i}`, seatNo: i, kind: i < humans ? "human" as const : "bot" as const, folded: false, allIn: false }))
describe("共享能力牌池", () => {
  it("默认单份、显式多份、实例唯一", () => {
    const c = context(), pool = createCardPool([def("a"), def("b", 2), def("c")], c)
    expect(pool.pool.map(x => x.definitionId).sort()).toEqual(["a", "b", "b", "c"])
    expect(new Set(pool.pool.map(x => x.id)).size).toBe(4)
  })
  it("六真人四阶段最多获得36张，重复阶段不再补发", () => {
    const c = context(); let s = createCardPool([def("21", 90)], c); s.participants = players(6)
    for (const stage of ["initial", "flop", "turn", "river", "river"] as const) s = applyCardPoolOperation(s, { kind: "deal", stage, dealerSeat: 5 }, c).state
    expect(Object.values(s.hands).map(h => h.length)).toEqual([6, 6, 6, 6, 6, 6])
    expect(s.pool).toHaveLength(54)
    assertCardPoolIntegrity(s)
  })
  it("机器人不领牌；弃牌全下不补，原入座不会被同座新身份继承", () => {
    const c = context(); let s = createCardPool([def("21", 90)], c); s.participants = players(2, 3)
    s = applyCardPoolOperation(s, { kind: "deal", stage: "initial", dealerSeat: 4 }, c).state
    expect(Object.values(s.hands).map(h => h.length)).toEqual([3, 3])
    s.participants[0].allIn = true; s.participants[1].folded = true
    s = applyCardPoolOperation(s, { kind: "deal", stage: "flop", dealerSeat: 4 }, c).state
    expect(s.pool).toHaveLength(84)
    expect(() => applyCardPoolOperation(s, { kind: "draw", admissionId: "new-a0", count: 1 }, c)).toThrow("POKER_CARD_INVALID_SELECTION")
  })
  it("抽取不放回，空池不足额不凭空补足", () => {
    const c = context(); let s = createCardPool([def("21", 2)], c); s.participants = players(1)
    const first = applyCardPoolOperation(s, { kind: "draw", admissionId: "a0", count: 3 }, c)
    expect(first.drawn).toHaveLength(2); s = first.state
    const empty = applyCardPoolOperation(s, { kind: "draw", admissionId: "a0", count: 1 }, c)
    expect(empty.drawn).toHaveLength(0)
    s = applyCardPoolOperation(s, { kind: "consume", admissionId: "a0", instanceIds: [s.hands.a0[0].id] }, c).state
    expect(s.pool).toHaveLength(0)
    expect(s.spent).toHaveLength(1)
    assertCardPoolIntegrity(s)
  })
  it("候选未选归还但已消费不回收；生成创建新的实例", () => {
    const c = context(); let s = createCardPool([def("21", 5)], c); s.participants = players(1)
    s = applyCardPoolOperation(s, { kind: "reserve", admissionId: "a0", count: 3, choiceId: "choice", street: "flop", paymentVersion: "q", sourceCardId: "25" }, c).state
    expect(s.pool).toHaveLength(2)
    const selected = s.reserved[1].id
    s = applyCardPoolOperation(s, { kind: "choose", admissionId: "a0", choiceId: "choice", index: 1 }, c).state
    expect(s.hands.a0[0].id).toBe(selected); expect(s.pool).toHaveLength(4)
    s = applyCardPoolOperation(s, { kind: "consume", admissionId: "a0", instanceIds: [selected] }, c).state
    s = applyCardPoolOperation(s, { kind: "generate", definitionIds: ["21"] }, c).state
    expect(s.generatedCount).toBe(1); expect(s.pool).toHaveLength(5)
    expect(s.pool.some(x => x.id === selected)).toBe(false)
    assertCardPoolIntegrity(s)
  })
  it("超出实例预算、重复消耗或陌生定义全部原子拒绝", () => {
    const c = context(), s = createCardPool([def("21", 1024)], c); s.participants = players(1)
    expect(() => applyCardPoolOperation(s, { kind: "generate", definitionIds: ["21"] }, c)).toThrow("POKER_CARD_BUDGET_EXCEEDED")
    expect(s.generatedCount).toBe(0)
    expect(() => applyCardPoolOperation(s, { kind: "generate", definitionIds: ["unknown"] }, c)).toThrow("POKER_CARD_INVALID_SELECTION")
    const drawn = applyCardPoolOperation(s, { kind: "draw", admissionId: "a0", count: 1 }, c).state
    const id = drawn.hands.a0[0].id
    expect(() => applyCardPoolOperation(drawn, { kind: "consume", admissionId: "a0", instanceIds: [id, id] }, c)).toThrow("POKER_CARD_INVALID_SELECTION")
    expect(drawn.hands.a0).toHaveLength(1)
  })
  it("本局清理移除运行态，保留消费/使用审计且不丢实例", () => {
    const c = context(); let s = createCardPool([def("21", 5)], c); s.participants = players(1)
    s = applyCardPoolOperation(s, { kind: "draw", admissionId: "a0", count: 1 }, c).state
    s.used.push({ id: "used", instanceId: s.hands.a0[0].id, cardId: "21", seatNo: 0, seq: 1, status: "completed" })
    s = applyCardPoolOperation(s, { kind: "clear" }, c).state
    expect(s.pool).toHaveLength(0); expect(s.hands.a0).toHaveLength(0); expect(s.spent).toHaveLength(5)
    expect(s.used).toHaveLength(1); assertCardPoolIntegrity(s)
  })
  it("非法总池在取用ID或随机数之前就拒绝", () => {
    const c = { ...context(), nextId: () => { throw new Error("不应分配ID") }, randomInt: () => { throw new Error("不应取熵") } }
    expect(() => createCardPool([def("a", 512), def("b", 513)], c)).toThrow("POKER_CARD_BUDGET_EXCEEDED")
  })
})
