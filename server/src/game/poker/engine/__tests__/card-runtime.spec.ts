import { describe, expect, it } from "vitest"
import { z } from "zod"
import { OperationRegistry } from "../cards/registry"
import { runResolution } from "../cards/runner"
import type { EffectInstance, ResolutionContext } from "../cards/types"

const context = (): ResolutionContext => ({ handId: "h", actionSeq: 1, rootActionId: "root", actorSeatNo: 0, actorAdmissionId: "a", source: "human", nowMs: 10, randomInt: () => { throw new Error("entropy must not be needed") }, nextId: () => "event" })
type State = { value: number; trace: string[]; effects: EffectInstance[] }
const effect = (id: string, installedSeq = 0): EffectInstance => ({ id, kind: id, cardId: "41", ownerAdmissionId: "a", ownerSeatNo: 0, polarity: "positive", installedSeq, remaining: 1, dispellable: true, data: {} })
describe("卡牌生命周期执行器", () => {
  it("按执行前、事实、执行后处理且不改变输入", () => {
    const registry = new OperationRegistry<State>({ effects: s => s.effects })
    registry.register({ id: "add", schema: z.object({ amount: z.number() }), apply(s, input) { s.trace.push("fact"); s.value += input.amount } })
    registry.registerHook({ kind: "before", event: "add", phase: "before", priority: 0, apply(s, _e, _event, api) { s.trace.push("before"); api.replaceInput({ amount: 2 }); return true } })
    registry.registerHook({ kind: "after", event: "add", phase: "after", priority: 0, apply(s) { s.trace.push("after"); return true } })
    const input: State = { value: 0, trace: [], effects: [effect("before"), effect("after")] }
    const result = runResolution(input, [{ type: "add", input: { amount: 1 } }], context(), registry)
    expect(result.state.trace).toEqual(["before", "fact", "after"])
    expect(result.state.value).toBe(2)
    expect(input.value).toBe(0)
    expect(input.effects.map(e => e.remaining)).toEqual([1, 1])
  })
  it("按优先级、安装顺序稳定触发，首次阻止后保留其他护盾", () => {
    const registry = new OperationRegistry<State>({ effects: s => s.effects })
    registry.register({ id: "add", schema: z.object({}), apply(s) { s.value++ } })
    for (const kind of ["later", "first"]) registry.registerHook({ kind, event: "add", phase: "before", priority: 1, apply(s, e, _event, api) { s.trace.push(e.id); api.block(); return true } })
    const result = runResolution({ value: 0, trace: [], effects: [effect("later", 2), effect("first", 1)] }, [{ type: "add", input: {} }], context(), registry)
    expect(result.state.value).toBe(0)
    expect(result.state.trace).toEqual(["first"])
    expect(result.state.effects.find(e => e.id === "later")?.remaining).toBe(1)
    expect(result.frame.events.some(e => e.status === "blocked")).toBe(true)
  })
  it("重复事实只触发一次", () => {
    const registry = new OperationRegistry<State>({ effects: s => s.effects })
    registry.register({ id: "emit", schema: z.object({}), apply(_s, _p, api) { api.emit("draw", {}, "public", "same"); api.emit("draw", {}, "public", "same") } })
    registry.registerHook({ kind: "listener", event: "draw", phase: "after", priority: 0, apply(s) { s.value++; return true } })
    const e = { ...effect("listener"), remaining: null }
    expect(runResolution({ value: 0, trace: [], effects: [e] }, [{ type: "emit", input: {} }], context(), registry).state.value).toBe(1)
  })
  it.each(["count", "depth"])("%s超限原子拒绝且输入不变", mode => {
    const registry = new OperationRegistry<State>({ effects: s => s.effects })
    registry.register({ id: "loop", schema: z.object({ n: z.number() }), apply(s, p, api) { s.value++; if (p.n) api.enqueue({ type: "loop", input: { n: p.n - 1 } }) } })
    const input: State = { value: 0, trace: [], effects: [] }
    const ops = mode === "count" ? Array.from({ length: 129 }, () => ({ type: "loop", input: { n: 0 } })) : [{ type: "loop", input: { n: 33 } }]
    expect(() => runResolution(input, ops, context(), registry)).toThrow("POKER_CARD_BUDGET_EXCEEDED")
    expect(input.value).toBe(0)
  })
  it("后置监听不能回头修改已发生的操作", () => {
    const registry = new OperationRegistry<State>({ effects: s => s.effects })
    registry.register({ id: "add", schema: z.object({}), apply(s) { s.value++ } })
    registry.registerHook({ kind: "late", event: "add", phase: "after", priority: 0, apply(_s, _e, _event, api) { api.replaceInput({}); return true } })
    const state: State = { value: 0, trace: [], effects: [effect("late")] }
    expect(() => runResolution(state, [{ type: "add", input: {} }], context(), registry)).toThrow("POKER_CARD_INVALID_PHASE")
    expect(state.value).toBe(0)
  })
  it("后续前置钩子以修正后的输入判断，已免为零不消耗第二个效果", () => {
    const registry = new OperationRegistry<State>({ effects: s => s.effects })
    registry.register({ id: "pay", schema: z.object({ amount: z.number() }), apply(s, p) { s.value = p.amount } })
    registry.registerHook({ kind: "first", event: "pay", phase: "before", priority: 0, apply(_s, _e, _event, api) { api.replaceInput({ amount: 0 }); return true } })
    registry.registerHook({ kind: "second", event: "pay", phase: "before", priority: 1, when: (_s, _e, event) => Number(event.data.amount) > 0, apply(s) { s.trace.push("wrong"); return true } })
    const result = runResolution({ value: 5, trace: [], effects: [effect("first"), effect("second")] }, [{ type: "pay", input: { amount: 5 } }], context(), registry)
    expect(result.state.effects.find(e => e.kind === "second")?.remaining).toBe(1)
    expect(result.state.trace).toEqual([])
  })
})
