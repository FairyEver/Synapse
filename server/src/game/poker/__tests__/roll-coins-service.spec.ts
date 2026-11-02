import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { PokerRollService } from "../poker-roll.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { quoteRoll } from "../engine/hand-runner"
import { rollStore } from "./roll-service-store"
const command = (f:Awaited<ReturnType<typeof rollStore>>,kind:"normal"|"super"="super")=>{
 const hand=f.hands[0],state=hand.engineState
 return {roomCode:f.room.code,handId:hand.id,street:state.street,expectedActionSeq:hand.actionSeq,controlVersion:0,actionId:randomUUID(),kind,cardIndex:0,expectedFee:quoteRoll(state,state.actionOnSeat)[kind].fee}
}
describe("Roll coin transactions and projections",()=>{
 it("snapshots the configured room allowance for hands and owner quotes",async()=>{
  const f=await rollStore("practice",3,{ruleOptions:{roll:true,rollCoins:21},rollPricingVersion:"roll-v1"})
  const seat=f.hands[0].engineState.actionOnSeat,user=f.seats.find(s=>s.seatNo===seat)!.userId
  expect(f.hands[0].rules.ruleOptions).toEqual({roll:true,rollCoins:21})
  expect(f.hands[0].engineState.roll.coinPolicy).toEqual({limit:21,normal:1,super:3})
  const actions=new PokerActionService(f.poker)
  expect((await actions.state(user,f.room.code,"owner",false,f.now)).roll).toMatchObject({coins:{balance:21,limit:21}})
  await new PokerRollService(f.poker).start(user,command(f),f.now)
  expect(quoteRoll(f.hands[0].engineState,seat)).toMatchObject({coins:{balance:18,limit:21},super:{coinCost:3},normal:{coinCost:1}})
 })
 it("wait includes owner coin balance and reroll offers while candidates are pending",async()=>{
  const f=await rollStore(),svc=new PokerRollService(f.poker),input=command(f),user=f.seats.find(s=>s.seatNo===f.hands[0].engineState.actionOnSeat)!.userId
  await svc.start(user,input,f.now)
  const actions=new PokerActionService(f.poker),wait=new PokerWaitService(actions)
  const result=await wait.wait(user,f.room.code,"",0,undefined,f.now)
  wait.onModuleDestroy()
  expect(result).toMatchObject({status:"roll_choice_required",roll:{coins:{balance:9,limit:12},normal:{coinCost:1},super:{coinCost:3}}})
 })
 it("rejects exhausted rerolls without discarding candidates; receipts and free choice survive service recovery",async()=>{
  const f=await rollStore(),svc=new PokerRollService(f.poker),seat=f.hands[0].engineState.actionOnSeat,user=f.seats.find(s=>s.seatNo===seat)!.userId,deadline=f.room.actionDeadlineAt
  let last=command(f),result
  for(let i=0;i<4;i++){last=command(f);result=await svc.start(user,last,f.now)}
  const before=structuredClone({hand:f.hands[0],rolls:f.rolls,actions:f.actions,transfers:f.db.transfers})
  await expect(svc.start(user,command(f),f.now)).rejects.toMatchObject({response:{code:"POKER_ROLL_INSUFFICIENT_COINS"}})
  expect({hand:f.hands[0],rolls:f.rolls,actions:f.actions,transfers:f.db.transfers}).toEqual(before)
  expect(await new PokerRollService(f.poker).start(user,last,f.now)).toEqual(result)
  const pending=f.hands[0].engineState.roll.pending
  await svc.choose(user,{roomCode:f.room.code,handId:last.handId,rollId:pending.id,candidateIndex:1,expectedActionSeq:f.hands[0].actionSeq,controlVersion:0,actionId:randomUUID()},f.now)
  expect(f.rolls).toHaveLength(4);expect(f.room.actionDeadlineAt).toEqual(deadline)
  expect(quoteRoll(f.hands[0].engineState,seat)).toMatchObject({coins:{balance:0,limit:12}})
 })
 it("serializes competing requests against the last three coins",async()=>{
  const f=await rollStore(),svc=new PokerRollService(f.poker),seat=f.hands[0].engineState.actionOnSeat,user=f.seats.find(s=>s.seatNo===seat)!.userId
  for(let i=0;i<9;i++)await svc.start(user,command(f,"normal"),f.now)
  const first=command(f),second={...first,actionId:randomUUID()}
  const results=await Promise.allSettled([svc.start(user,first,f.now),svc.start(user,second,f.now)])
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1)
  expect(f.rolls).toHaveLength(10);expect(f.receipts).toHaveLength(10)
  expect(quoteRoll(f.hands[0].engineState,seat)).toMatchObject({coins:{balance:0,limit:12}})
 })
 it("failed funding writes roll back coin history, funds and pending candidates",async()=>{
  const f=await rollStore(),svc=new PokerRollService(f.poker),user=f.seats.find(s=>s.seatNo===f.hands[0].engineState.actionOnSeat)!.userId
  await svc.start(user,command(f),f.now)
  const before=structuredClone({hand:f.hands[0],rolls:f.rolls,transfers:f.db.transfers})
  const spy=vi.spyOn(f.poker.hall,"freezeTransfers").mockRejectedValueOnce(new Error("funding unavailable"))
  await expect(svc.start(user,command(f),f.now)).rejects.toThrow("funding unavailable")
  expect({hand:f.hands[0],rolls:f.rolls,transfers:f.db.transfers}).toEqual(before)
  spy.mockRestore()
 })
})
