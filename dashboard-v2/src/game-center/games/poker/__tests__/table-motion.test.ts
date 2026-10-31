import { describe, expect, it } from "vitest"
import type { PokerTableView, PokerSettlementView } from "@synapse/shared/game-contracts"
import { tableMotion } from "../lib/table-motion"
const before: PokerTableView = {roomCode:"1234",name:null,status:"running",buyIn:1000,maxSeats:2,handId:"h",handNo:1,street:"preflop",board:[],pot:3,dealerSeat:0,actionOnSeat:0,deadlineMs:600000,cursor:"1:0",mySeatNo:0,seats:[{seatNo:0,displayName:"本人",stack:999,status:"active",isMe:true,streetBet:1,aiState:"online"},{seatNo:1,displayName:"对手",stack:998,status:"active",isMe:false,streetBet:2,aiState:"online"}],recentActions:[],deckRemaining:48,actionSeq:0}
const result: PokerSettlementView = {handId:"h",handNo:1,board:[],rules:{variant:"standard52",smallBlind:1,bigBlind:2},mixedControl:false,seats:[{seatNo:0,displayName:"本人",participantKind:"human",isMe:true,folded:false,delta:-2,payout:8,endingStack:998},{seatNo:1,displayName:"对手",participantKind:"human",isMe:false,folded:false,delta:2,payout:12,endingStack:1002}],pots:[{amount:12,eligible:[0,1],winners:[0,1],shares:{0:6,1:6},refund:false},{amount:6,eligible:[1],winners:[1],shares:{1:6},refund:false},{amount:2,eligible:[0],winners:[0],shares:{0:2},refund:true}]}
describe("确认后筹码与结果时序",()=>{
  it("轮询和失败请求没有新动作时不播放成功下注",()=>{
    expect(tableMotion(before,{...before}).transfers).toEqual([])
    expect(tableMotion(before,{...before}).actions).toEqual([])
  })
  it("同一快照中的连续加注只展示实际追加，收池含原盲注",()=>{
    const next={...before,actionSeq:2,street:"flop",recentActions:[{seq:1,seatNo:0,street:"preflop",action:"raise",amount:5,potAfter:8,isAuto:false},{seq:2,seatNo:1,street:"preflop",action:"call",amount:4,potAfter:12,isAuto:false}]}
    const transfers=tableMotion(before,next).transfers
    expect(transfers.map(t=>[t.kind,t.seatNo,t.amount])).toEqual([["bet",0,5],["bet",1,4],["collect",0,6],["collect",1,6]])
    expect(transfers[2].delay).toBeGreaterThan(transfers[0].delay)
  })
  it("平分、边池和返还按各池派发；赢池但净亏损不庆祝",()=>{
    const settled={...before,street:"settled",settlement:result,actionOnSeat:null}
    const motion=tableMotion(before,settled)
    expect(motion.transfers.filter(t=>t.kind==="payout").map(t=>[t.seatNo,t.amount])).toEqual([[0,6],[1,6],[1,6]])
    expect(motion.transfers.filter(t=>t.kind==="refund").map(t=>[t.seatNo,t.amount])).toEqual([[0,2]])
    expect(motion.celebrate).toEqual([])
    expect(tableMotion(settled,{...settled}).transfers).toEqual([])
  })
  it("本人真正净盈利才短暂庆祝，新手丢弃旧手动作和派彩",()=>{
    const settlement={...result,seats:result.seats.map(s=>s.isMe?{...s,delta:4}:s)}
    const settled={...before,street:"settled",settlement}
    expect(tableMotion(before,settled).celebrate).toEqual([0])
    const next={...before,handId:"new",handNo:2}
    const motion=tableMotion(settled,next)
    expect(motion.transfers).toEqual([])
    expect(motion.celebrate).toEqual([])
    expect(motion.turn).toBe(0)
  })
})
