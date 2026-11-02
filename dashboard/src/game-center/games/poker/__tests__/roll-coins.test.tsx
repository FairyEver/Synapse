/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { HumanControls } from "../components/HumanControls"
import { projectTable } from "../lib/view"
const api=vi.hoisted(()=>({start:vi.fn(),choose:vi.fn(),state:vi.fn()}))
vi.mock("../../../lib/api",()=>({gameApi:()=>({poker:{roll:{start:api.start,choose:api.choose},table:{state:api.state}}})}))
vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}})
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const table:PokerTableView={roomCode:"1234",name:null,status:"running",mode:"practice",buyIn:1000,maxSeats:2,handId:"coins-hand",handNo:1,street:"flop",board:[],pot:20,dealerSeat:0,actionOnSeat:0,deadlineMs:20000,cursor:"1:3",mySeatNo:0,seats:[{seatNo:0,displayName:"本人",isMe:true,stack:100,status:"active",streetBet:2,aiState:"online",controller:"human"}],recentActions:[],deckRemaining:40,actionSeq:3,controlVersion:4,controller:"human",legalActions:["fold","call"],toCall:4,hole:["As","Kd"],roll:{enabled:true,count:0,coins:{balance:12,limit:12},normal:{fee:3,coinCost:1,available:true},super:{fee:8,coinCost:3,available:true},pending:null}}
const roots:Root[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.resetAllMocks();sessionStorage.clear();document.body.replaceChildren()})
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===label)!
async function mount(value=table){const host=document.createElement("div"),root=createRoot(host);roots.push(root);document.body.append(host);await act(async()=>root.render(<HumanControls identityKey="coins-user" table={value} perspective="owner" onRefresh={vi.fn()}/>));return root}
async function open(){await act(async()=>button("Roll · 钻石 12/12").click())}
describe("Roll coin controls",()=>{
 it("shows both costs and post-payment balance, submits only after confirmation",async()=>{
  api.start.mockResolvedValue({ok:true})
  await mount();await open()
  expect(document.body.textContent).toContain("本手钻石 12/12")
  expect(document.body.textContent).toContain("1 钻石 + 3 筹码")
  expect(document.body.textContent).toContain("3 钻石 + 8 筹码")
  await act(async()=>document.querySelector<HTMLInputElement>('input[type="radio"][value="0"]')!.click())
  expect(document.body.textContent).toContain("扣后钻石 11/12")
  expect(api.start).not.toHaveBeenCalled()
  await act(async()=>button("确认换牌").click())
  expect(api.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({kind:"normal",cardIndex:0,expectedFee:3}))
  expect(document.body.textContent).toContain("本手钻石 12/12") // No speculative decrement before refreshed state.
 })
 it("updates coins from refreshed snapshots and never exposes owner coins in public projection",async()=>{
  const root=await mount();await open()
  const next={...table,actionSeq:4,roll:{...table.roll!,coins:{balance:11,limit:12}}}
  await act(async()=>root.render(<HumanControls identityKey="coins-user" table={next} perspective="owner" onRefresh={vi.fn()}/>))
  expect(button("Roll · 钻石 11/12")).toBeDefined()
  await act(async()=>button("Roll · 钻石 11/12").click())
  expect(document.body.textContent).toContain("本手钻石 11/12")
  expect(projectTable(next,"public").roll).not.toHaveProperty("coins")
  expect(projectTable(next,"public").roll).not.toHaveProperty("normal")
 })
 it("exhausted coins leave the explanation entry and normal betting available",async()=>{
  const reason="POKER_ROLL_INSUFFICIENT_COINS"
  await mount({...table,roll:{...table.roll!,coins:{balance:0,limit:12},normal:{fee:3,coinCost:1,available:false,reason},super:{fee:8,coinCost:3,available:false,reason}}})
  expect(button("跟注 4").disabled).toBe(false)
  await act(async()=>button("Roll · 钻石 0/12").click())
  expect(document.body.textContent).toContain("本手钻石已用完")
  expect(button("确认换牌").disabled).toBe(true)
  expect(api.start).not.toHaveBeenCalled()
 })
 it.each([1,2])("%i coins disables super but leaves normal usable",async balance=>{
  await mount({...table,roll:{...table.roll!,coins:{balance,limit:12},super:{fee:8,coinCost:3,available:false,reason:"POKER_ROLL_INSUFFICIENT_COINS"}}})
  await act(async()=>button(`Roll · 钻石 ${balance}/12`).click())
  expect(document.body.textContent).toContain("钻石不足，需 3")
  expect(document.querySelector<HTMLInputElement>('input[type="radio"][value="super"]')!.disabled).toBe(true)
  expect(document.querySelector<HTMLInputElement>('input[type="radio"][value="normal"]')!.disabled).toBe(false)
 })
 it("zero coins keeps paid candidates selectable and both rerolls disabled",async()=>{
  api.choose.mockResolvedValue({ok:true})
  await mount({...table,roll:{...table.roll!,coins:{balance:0,limit:12},normal:{fee:3,coinCost:1,available:false,reason:"POKER_ROLL_INSUFFICIENT_COINS"},super:{fee:8,coinCost:3,available:false,reason:"POKER_ROLL_INSUFFICIENT_COINS"},pending:{rollId:"paid",cardIndex:1,candidates:["2c","3c","4c"]}}})
  expect(document.body.textContent).toContain("本手钻石已用完")
  expect(button("普通重抽 · 1 钻石 + 3 筹码").disabled).toBe(true)
  expect(button("超级重抽 · 3 钻石 + 8 筹码").disabled).toBe(true)
  await act(async()=>document.querySelector<HTMLInputElement>('input[type="radio"][value="1"]')!.click())
  expect(button("选择这张牌").disabled).toBe(false)
  await act(async()=>button("选择这张牌").click())
  expect(api.choose).toHaveBeenCalledWith(expect.objectContaining({rollId:"paid",candidateIndex:1}))
  expect(api.start).not.toHaveBeenCalled()
 })
 it("normal reroll uses committed slot and preserves candidates on rejection",async()=>{
  api.start.mockRejectedValue(Object.assign(new Error("钻石不足"),{code:"POKER_ROLL_INSUFFICIENT_COINS"}))
  await mount({...table,roll:{...table.roll!,coins:{balance:9,limit:12},pending:{rollId:"paid",cardIndex:1,candidates:["2c","3c","4c"]}}})
  await act(async()=>button("普通重抽 · 1 钻石 + 3 筹码").click())
  expect(api.start).toHaveBeenCalledWith(expect.objectContaining({kind:"normal",cardIndex:1,expectedFee:3}))
  expect(document.querySelector('[aria-label="选择候选 1，2♣"]')).not.toBeNull()
 })
 it("legacy responses keep the existing entry and do not fabricate coins",async()=>{
  const legacy={...table,roll:{enabled:true,count:0,normal:{fee:3,available:true},super:{fee:8,available:true},pending:null}}
  await mount(legacy);await act(async()=>button("Roll 换牌").click())
  expect(document.body.textContent).not.toContain("钻石")
 })
})
