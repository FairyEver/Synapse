import { describe, expect, it, vi } from "vitest"
import { projectChipState, projectFundedChipState } from "../poker-chip-projection"
import type { ResolutionFrame } from "../engine/cards/types"

const hand = {id:"h",dealerSeat:0,rules:{variant:"standard52",smallBlind:5,bigBlind:10}}
const seats = [{seatNo:0,startingStack:5000},{seatNo:1,startingStack:5000}]
describe("公开筹码展示投影", () => {
  it("v2根帧仅使用实付，暂存方向按因果顺序，不重复投影chips.paid", () => {
    const root: ResolutionFrame = { id: "root", handId: "h", seq: 4, rootActionId: "private-root", events: [
      { id: "0", index: 0, type: "bet.completed", phase: "after", audience: "public", actorSeatNo: 0, data: { amount: 0, nominalAmount: 100, waivedAmount: 100 } },
      { id: "1", index: 1, type: "chips.deposited", phase: "after", audience: "public", actorSeatNo: 0, data: { targetSeatNo: 0, amount: 120 } },
      { id: "2", index: 2, type: "chips.paid", phase: "after", audience: "public", actorSeatNo: 0, data: { amount: 120 } },
      { id: "3", index: 3, type: "chips.stolen", phase: "after", audience: "public", actorSeatNo: 1, data: { amount: 60 } },
      { id: "4", index: 4, type: "chips.refunded", phase: "after", audience: "public", actorSeatNo: 0, data: { amount: 60 } },
      { id: "5", index: 5, type: "poker.observed", phase: "after", audience: "owner", actorSeatNo: 0, data: { cards: ["As"] } },
    ] }
    const reserve = { revision: 0, finalized: false, lots: [], claims: [], movements: [] }
    const projected = projectFundedChipState({ pot: [], roll: [], recent: [] }, reserve, [], [root])
    expect(projected.reserve).toEqual([])
    expect(projected.recent.map(e => [e.fund, e.direction, e.amount])).toEqual([["reserve", "in", 120], ["reserve", "out", 60], ["reserve", "out", 60]])
    expect(JSON.stringify(projected)).not.toMatch(/As|private-root|nominal|waived/)
  })
  it("新版换牌费进入主池筹码堆，待选完成不重放筹码且没有暂存", async () => {
    const modern = { ...hand, rules: { ...hand.rules, chipRulesVersion: "chips-v2", cardRulesVersion: "cards-v2", ruleOptions: { cards: true } } }
    const base = await projectChipState({} as any, modern, seats, [], [
      { seq: 1, seatNo: 0, action: "card_play", amount: 25 },
      { seq: 2, seatNo: 0, action: "card_choose", amount: 0 },
    ])
    const root: ResolutionFrame = { id: "root", handId: "h", seq: 1, rootActionId: "play", events: [
      { id: "0", index: 0, type: "chips.paid", phase: "after", audience: "public", actorSeatNo: 0, data: { amount: 25, destination: "pot" } },
    ] }
    const view = projectFundedChipState(base, undefined, seats.map(s => ({ ...s, admissionId: null })), [root])
    expect(view.pot).toEqual([{ value: 25, count: 1 }, { value: 10, count: 1 }, { value: 5, count: 1 }])
    expect(view.recent).toEqual([{ id: "root:0", seq: 1, seatNo: 0, amount: 25, fund: "pot", direction: "in", kind: "card" }])
    expect(view).not.toHaveProperty("reserve")
  })
  it("最终分配按原接收人汇总动画，长期Roll不能把单根展示撑破预算", () => {
    const root: ResolutionFrame = { id: "settle", handId: "h", seq: 2001, rootActionId: "final", events: [{ id: "final", index: 0, type: "chips.distributed", phase: "after", audience: "public", actorSeatNo: 0, data: { amount: 2000 } }] }
    const reserve = { revision: 1, finalized: true, lots: [], claims: [], movements: Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}`, rootActionId: "final", eventIndex: i, kind: "finalize" as const, amount: 1, lotId: `l${i}`, toAdmissionId: "original" })) }
    const view = projectFundedChipState({ pot: [], roll: [], recent: [] }, reserve, [{ admissionId: "original", seatNo: 1 }], [root])
    expect(view.recent).toHaveLength(1); expect(view.recent[0]).toMatchObject({ amount: 2000, seatNo: 1, kind: "compensation" })
  })
  it("分页读取完整下注，五笔100和超过30条动作不被累计换成500", async () => {
    const actions = Array.from({length:260},(_,index)=>({seq:index+1,seatNo:0,action:"call",amount:100,rollId:null}))
    const findMany = vi.fn(async ({where,take}:any)=>actions.filter(a=>a.seq>where.seq.gt).slice(0,take))
    const result = await projectChipState({gamePokerAction:{findMany}} as any,hand,seats,[])
    expect(result.pot).toEqual([{value:100,count:260},{value:10,count:1},{value:5,count:1}])
    expect(result.recent).toHaveLength(32)
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany.mock.calls[1][0].where).toMatchObject({handId:"h",seq:{gt:256}})
    expect(JSON.stringify(result)).not.toMatch(/userId|hole|candidate|note/)
  })
  it("短盲注按原入座余额，Roll start入独立堆，choose不重复收费", async () => {
    const actions = [{seq:1,seatNo:0,action:"roll_start",amount:0,rollId:"r"},{seq:2,seatNo:0,action:"roll_choose",amount:0,rollId:"r"}]
    const result = await projectChipState({} as any,hand,[{seatNo:0,startingStack:3},{seatNo:1,startingStack:8}],[{id:"r",seatNo:0,fee:501}],actions)
    expect(result.pot).toEqual([{value:5,count:1},{value:1,count:6}])
    expect(result.roll).toEqual([{value:500,count:1},{value:1,count:1}])
    expect(result.recent.filter(a=>a.fund==="roll")).toEqual([{id:"h:1:roll",seq:1,seatNo:0,amount:501,fund:"roll"}])
  })
})
