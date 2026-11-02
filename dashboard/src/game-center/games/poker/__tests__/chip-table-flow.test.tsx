/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Table } from "../components/Table"
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const running:PokerTableView={roomCode:"1234",name:null,status:"running",buyIn:100,maxSeats:2,handId:"h",handNo:1,street:"river",board:[],pot:12,dealerSeat:0,actionOnSeat:0,deadlineMs:10000,cursor:"1:1",mySeatNo:0,actionSeq:1,ruleOptions:{roll:true},seats:[{seatNo:0,displayName:"我",isMe:true,stack:90,streetBet:0,status:"active",aiState:"online"},{seatNo:1,displayName:"对手",isMe:false,stack:92,streetBet:0,status:"active",aiState:"online"}],recentActions:[],deckRemaining:44,chipState:{pot:[{value:10,count:1},{value:1,count:2}],roll:[{value:5,count:1},{value:1,count:1}],recent:[]}}
const settled:PokerTableView={...running,status:"paused",street:"settled",pot:0,seats:running.seats.map((s,i)=>({...s,stack:i?102:98})),settlement:{handId:"h",handNo:1,board:[],rules:{variant:"standard52",smallBlind:1,bigBlind:2,ruleOptions:{roll:true}},mixedControl:false,pots:[{amount:12,eligible:[0,1],winners:[0,1],shares:{0:6,1:6},refund:false}],seats:[{seatNo:0,displayName:"我",isMe:true,participantKind:"human",folded:false,delta:-2,payout:6,endingStack:98,rollReceived:2},{seatNo:1,displayName:"对手",isMe:false,participantKind:"human",folded:false,delta:2,payout:6,endingStack:102,rollReceived:4}]}}
it("真实Table先派普通再派Roll，最后一个实际动画完成前结算不自动或手动打开",async()=>{
  const original=Element.prototype.animate,pending:{done:()=>void;cancelled:boolean;finished:boolean}[]=[]
  Element.prototype.animate=function(){
    let resolve!:()=>void,reject!:(error:Error)=>void,observed=false
    const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no})
    const item={done:()=>{},cancelled:false,finished:false}
    const animation={get finished(){observed=true;return promise},cancel(){item.cancelled=true;if(observed)reject(new DOMException("Cancelled","AbortError"))},onfinish:null} as unknown as Animation
    item.done=()=>{if(item.cancelled||item.finished)return;item.finished=true;resolve();animation.onfinish?.call(animation,{} as AnimationPlaybackEvent)};pending.push(item);return animation
  }
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  const render=(table:PokerTableView)=>act(async()=>root.render(<Table table={table} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} />))
  const finish=()=>act(async()=>{const current=[...pending];current.forEach(animation=>animation.done())})
  try{
    await render(running)
    expect(host.querySelector('.poker-chip-pile[data-fund="pot"]')?.getAttribute('aria-label')).toContain("12")
    expect(host.querySelector('.poker-chip-pile[data-fund="roll"]')?.getAttribute('aria-label')).toContain("6")
    await render(settled)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.querySelector<HTMLButtonElement>('[aria-label="本局结算"]')?.disabled).toBe(true)
    expect(host.querySelector('[data-transfer-id][data-fund="pot"]')).not.toBeNull()
    expect(host.querySelector('[data-transfer-id][data-fund="roll"]')).toBeNull()
    await finish()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.querySelector('[data-transfer-id][data-fund="roll"]')).not.toBeNull()
    await render({...settled})
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await finish()
    // A final reel can finish after a chip; it participates in the same barrier.
    await finish()
    expect(host.querySelectorAll('[data-transfer-id]')).toHaveLength(0)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本局结算")
    expect(host.querySelector('[data-seat="0"] .poker-stack')?.textContent).toBe("98")
    expect(host.querySelector('[data-seat="1"] .poker-stack')?.textContent).toBe("102")
  }finally{await act(async()=>root.unmount());Element.prototype.animate=original;host.remove()}
})
it("隐藏恢复建立基线，同时取消已到目标值但尚未滚完的金额动画",async()=>{
  const original=Element.prototype.animate,animations:{element:Element;cancelled:boolean}[]=[]
  Element.prototype.animate=function(){
    let reject!:(error:Error)=>void,observed=false
    const promise=new Promise<void>((_,no)=>{reject=no}),item={element:this,cancelled:false}
    animations.push(item)
    return {get finished(){observed=true;return promise},cancel(){item.cancelled=true;if(observed)reject(new DOMException("Cancelled","AbortError"))},onfinish:null} as unknown as Animation
  }
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  const render=(table:PokerTableView)=>act(async()=>root.render(<Table table={table} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} />))
  try{
    await render(running)
    await render(settled)
    const reels=animations.filter(a=>a.element.classList.contains("poker-number-track"))
    expect(reels.length).toBeGreaterThan(0)
    expect(reels.some(a=>!a.cancelled)).toBe(true)
    await act(async()=>document.dispatchEvent(new Event("visibilitychange")))
    expect(reels.every(a=>a.cancelled)).toBe(true)
    expect(host.querySelectorAll('[data-transfer-id]')).toHaveLength(0)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本局结算")
    expect(host.querySelector('[data-seat="0"] .poker-stack')?.textContent).toBe("98")
  }finally{await act(async()=>root.unmount());Element.prototype.animate=original;host.remove()}
})
