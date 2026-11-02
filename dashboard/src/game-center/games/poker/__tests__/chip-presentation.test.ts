import { describe, expect, it } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { chipValue } from "@synapse/shared/game-contracts"
import { seedChipPresentation, updateChipPresentation, startChipTransfer, finishChipTransfer, activeChipTransfers } from "../lib/chip-presentation"
const table: PokerTableView = {roomCode:"1234",name:null,status:"running",buyIn:100,maxSeats:2,handId:"h",handNo:1,street:"flop",board:[],pot:12,dealerSeat:0,actionOnSeat:0,deadlineMs:10000,cursor:"1:1",mySeatNo:0,actionSeq:1,seats:[{seatNo:0,displayName:"我",isMe:true,stack:90,streetBet:0,status:"active",aiState:"online"},{seatNo:1,displayName:"对手",isMe:false,stack:92,streetBet:0,status:"active",aiState:"online"}],recentActions:[],deckRemaining:44,chipState:{pot:[{value:10,count:1},{value:1,count:2}],roll:[{value:5,count:1},{value:1,count:1}],recent:[]}}
const settled: PokerTableView = {...table,status:"paused",street:"settled",pot:0,settlement:{handId:"h",handNo:1,rules:{variant:"standard52",smallBlind:1,bigBlind:2},board:[],mixedControl:false,seats:[{seatNo:0,displayName:"我",participantKind:"human",isMe:true,folded:false,payout:6,endingStack:98,delta:-2,rollReceived:2},{seatNo:1,displayName:"对手",participantKind:"human",isMe:false,folded:false,payout:6,endingStack:102,delta:2,rollReceived:4}],pots:[{amount:12,eligible:[0,1],winners:[0,1],shares:{0:6,1:6},refund:false}]},seats:table.seats.map((s,i)=>({...s,stack:i?102:98}))}
describe("筹码展示状态与结算屏障",()=>{
  it("初次打开已结算手不重播，直接使用最终余额",()=>{
    const state=seedChipPresentation(settled,"user")
    expect(state.transfers).toEqual([])
    expect(state.banks).toEqual({0:98,1:102})
    expect(chipValue(state.funds.pot)).toBe(0)
  })
  it("Roll支付进入独立堆，choose或重复轮询不重播",()=>{
    const start={...table,actionSeq:2,chipState:{...table.chipState!,roll:[{value:5 as const,count:1},{value:1 as const,count:5}],recent:[{id:"r",seq:2,seatNo:0,amount:4,fund:"roll" as const}]}}
    let state=updateChipPresentation(seedChipPresentation(table,"user"),start,"user")
    expect(activeChipTransfers(state).map(t=>[t.fund,t.amount])).toEqual([["roll",4]])
    expect(chipValue(state.funds.pot)).toBe(12)
    state=updateChipPresentation(state,{...start,actionSeq:3},"user")
    expect(state.transfers).toHaveLength(1)
    state=finishChipTransfer(state,"r")
    expect(chipValue(state.funds.roll)).toBe(10)
    expect(state.transfers).toEqual([])
  })
  it("快速新增动作保留未落地批次，重复完成不重复加钱",()=>{
    const payment={id:"a",seq:2,seatNo:0,amount:5,fund:"pot" as const}
    const next={...table,actionSeq:2,pot:17,chipState:{...table.chipState!,pot:[{value:10 as const,count:1},{value:5 as const,count:1},{value:1 as const,count:2}],recent:[payment]}}
    let state=updateChipPresentation(seedChipPresentation(table,"user"),next,"user")
    const again={...next,actionSeq:3,pot:18,chipState:{...next.chipState,pot:[{value:10 as const,count:1},{value:5 as const,count:1},{value:1 as const,count:3}],recent:[payment,{id:"b",seq:3,seatNo:1,amount:1,fund:"pot" as const}]}}
    state=updateChipPresentation(state,again,"user")
    expect(state.transfers.map(t=>t.id)).toEqual(["a","b"])
    state=finishChipTransfer(finishChipTransfer(state,"a"),"b")
    expect(chipValue(state.funds.pot)).toBe(18)
    expect(finishChipTransfer(state,"a")).toBe(state)
  })
  it("真实平分先派普通底池后派Roll补偿，落地才增加余额",()=>{
    let state=updateChipPresentation(seedChipPresentation(table,"user"),settled,"user")
    expect(state.banks).toEqual({0:90,1:92})
    expect(activeChipTransfers(state).map(t=>[t.fund,t.seatNo,t.amount])).toEqual([["pot",0,6],["pot",1,6]])
    for(const job of activeChipTransfers(state)) state=startChipTransfer(state,job.id)
    expect(chipValue(state.funds.pot)).toBe(0)
    expect(state.banks).toEqual({0:90,1:92})
    for(const job of activeChipTransfers(state)) state=finishChipTransfer(state,job.id)
    expect(state.banks).toEqual({0:96,1:98})
    expect(activeChipTransfers(state).map(t=>[t.fund,t.seatNo,t.amount])).toEqual([["roll",0,2],["roll",1,4]])
    for(const job of activeChipTransfers(state)) state=finishChipTransfer(startChipTransfer(state,job.id),job.id)
    expect(state.banks).toEqual({0:98,1:102})
    expect(state.transfers).toEqual([])
  })
  it("换手、身份变化和旧回调不污染新展示",()=>{
    let state=updateChipPresentation(seedChipPresentation(table,"user"),settled,"user")
    const id=state.transfers[0].id
    state=updateChipPresentation(state,{...table,handId:"new",handNo:2},"other")
    expect(state.transfers).toEqual([])
    expect(finishChipTransfer(state,id)).toBe(state)
    expect(updateChipPresentation(state,table,"other")).toBe(state)
  })
  it("旁观时同手座位换人取消旧派彩，旧落地回调不改变新玩家余额",()=>{
    let state=updateChipPresentation(seedChipPresentation(table,"spectator"),settled,"spectator")
    const oldPayout=activeChipTransfers(state).find(t=>t.seatNo===0)!
    state=startChipTransfer(state,oldPayout.id)
    const replacement={...settled,seats:settled.seats.map(s=>s.seatNo===0?{...s,displayName:"新玩家",stack:5,inCurrentHand:false}:s)}
    state=updateChipPresentation(state,replacement,"spectator")
    expect(state.banks[0]).toBe(5)
    expect(state.transfers).toEqual([])
    expect(finishChipTransfer(state,oldPayout.id)).toBe(state)
  })
  it("最新快照中的历史付款不从新占位玩家发出",()=>{
    const replacement={...table,actionSeq:2,pot:17,seats:table.seats.map(s=>s.seatNo===0?{...s,displayName:"新玩家",stack:5,inCurrentHand:false}:s),chipState:{...table.chipState!,pot:[{value:10 as const,count:1},{value:5 as const,count:1},{value:1 as const,count:2}],recent:[{id:"old",seq:2,seatNo:0,amount:5,fund:"pot" as const}]}}
    const state=updateChipPresentation(seedChipPresentation(table,"spectator"),replacement,"spectator")
    expect(state.transfers).toEqual([])
    expect(chipValue(state.funds.pot)).toBe(17)
    expect(state.banks[0]).toBe(5)
  })
})
