import { describe, expect, it, vi } from "vitest"
import { projectChipState } from "../poker-chip-projection"

const hand = {id:"h",dealerSeat:0,rules:{variant:"standard52",smallBlind:5,bigBlind:10}}
const seats = [{seatNo:0,startingStack:5000},{seatNo:1,startingStack:5000}]
describe("公开筹码展示投影", () => {
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
