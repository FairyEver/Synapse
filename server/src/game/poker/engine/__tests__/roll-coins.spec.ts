import { describe, expect, it } from "vitest"
import { orderedDeck } from "../deck"
import { act, assertHandIntegrity, chooseRollCard, legalActions, quoteRoll, startHand, startRoll, type HandState } from "../hand-runner"
const create = (variant: "standard52" | "short32" = "standard52") => startHand([{seatNo:0,stack:1000},{seatNo:1,stack:1000}],0,orderedDeck(variant),{variant,ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
const draw = (h: HandState, kind: "normal" | "super" = "normal") => startRoll(h,h.actionOnSeat!,{rollId:`coin-${h.roll!.history.length}`,kind,cardIndex:0,fee:quoteRoll(h,h.actionOnSeat!)[kind].fee},()=>0)
const advance = (h: HandState) => {const street=h.street;while(h.street===street)h=act(h,h.actionOnSeat!,{action:legalActions(h,h.actionOnSeat!).toCall?"call":"check"});return h}
describe("Roll per-hand coins",()=>{
 it.each([1,2,21])("uses a configured %i coin limit with fixed one/three costs",limit=>{
  const h=startHand([{seatNo:0,stack:1000},{seatNo:1,stack:1000}],0,orderedDeck(),{ruleOptions:{roll:true,rollCoins:limit},rollPricingVersion:"roll-v1"})
  const seat=h.actionOnSeat!
  expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:limit,limit},normal:{coinCost:1,available:true},super:{coinCost:3,available:limit>=3}})
  const next=draw(h)
  expect(quoteRoll(next,seat)).toMatchObject({coins:{balance:limit-1,limit}})
  expect(next.roll!.coinPolicy).toEqual({limit,normal:1,super:3})
  assertHandIntegrity(next)
 })
 it.each(["standard52","short32"] as const)("%s allows twelve normal rolls then rejects without changing cards or funds",variant=>{
  let h=create(variant);const seat=h.actionOnSeat!
  expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:12,limit:12},normal:{coinCost:1},super:{coinCost:3}})
  for(let i=0;i<12;i++)h=draw(h)
  const before=structuredClone(h)
  expect(quoteRoll(h,seat).normal).toMatchObject({available:false,reason:"POKER_ROLL_INSUFFICIENT_COINS"})
  expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:0,limit:12}})
  expect(()=>draw(h)).toThrow("POKER_ROLL_INSUFFICIENT_COINS")
  expect(h).toEqual(before);expect(quoteRoll(h,1-seat)).toMatchObject({coins:{balance:12,limit:12}})
  expect(()=>act(h,seat,{action:"call"})).not.toThrow();assertHandIntegrity(h)
 })
 it("charges each discarded super attempt; the fourth remains selectable for free at zero coins",()=>{
  let h=create();const seat=h.actionOnSeat!
  for(let i=0;i<4;i++)h=draw(h,"super")
  expect(h.roll!.counts[seat]).toBe(4)
  expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:0,limit:12},super:{available:false}})
  const pending=h.roll!.pending!,before=structuredClone(h)
  expect(()=>draw(h,"super")).toThrow("POKER_ROLL_INSUFFICIENT_COINS")
  expect(h).toEqual(before)
  h=chooseRollCard(h,seat,pending.id,2,()=>0)
  expect(h.roll!.pending).toBeNull();expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:0,limit:12}})
  assertHandIntegrity(h)
 })
 it.each([1,2,3])("remaining %i coins independently gates normal and super",balance=>{
  let h=create();for(let i=0;i<12-balance;i++)h=draw(h)
  const seat=h.actionOnSeat!
  expect(quoteRoll(h,seat)).toMatchObject({coins:{balance,limit:12},normal:{available:true},super:{available:balance>=3}})
  if(balance===3){h=draw(h,"super");expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:0,limit:12}})}
 })
 it("mixed costs persist across streets and serialized recovery; a new hand resets",()=>{
  let h=draw(draw(create(),"super"));const seat=h.actionOnSeat!
  expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:8,limit:12}})
  h=advance(h);h=JSON.parse(JSON.stringify(h))
  expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:8,limit:12}})
  expect(quoteRoll(create(),seat)).toMatchObject({coins:{balance:12,limit:12}})
 })
 it("legacy snapshots remain unlimited and do not advertise a fabricated balance",()=>{
  let h=create();delete h.roll!.coinPolicy
  for(let i=0;i<5;i++)h=draw(h,"super")
  expect(quoteRoll(h,h.actionOnSeat!)).not.toHaveProperty("coins")
  expect(quoteRoll(h,h.actionOnSeat!).super).not.toHaveProperty("coinCost")
  assertHandIntegrity(h)
 })
 it("does not issue coins to seats outside the current hand",()=>{
  expect(quoteRoll(create(),9)).not.toHaveProperty("coins")
 })
 it("ten-player short deck settles after four paid super choices without losing cards",()=>{
  let h=startHand(Array.from({length:10},(_,seatNo)=>({seatNo,stack:1000})),0,orderedDeck("short32"),{variant:"short32",ruleOptions:{roll:true},rollPricingVersion:"roll-v1"})
  for(let i=0;i<4;i++){h=draw(h,"super");h=chooseRollCard(h,h.actionOnSeat!,h.roll!.pending!.id,1,()=>0);assertHandIntegrity(h)}
  while(h.street!=="settled")h=advance(h)
  expect(h.burnedCards).toHaveLength(3);expect(h.deck).toHaveLength(4);assertHandIntegrity(h)
 })
 it("stack limits and failed entropy retain coin budget and original candidates",()=>{
  const h=draw(create(),"super"),seat=h.actionOnSeat!,before=structuredClone(h)
  expect(()=>startRoll(h,seat,{rollId:"bad",kind:"super",cardIndex:0,fee:quoteRoll(h,seat).super.fee},max=>max)).toThrow()
  expect(h).toEqual(before);expect(quoteRoll(h,seat)).toMatchObject({coins:{balance:9,limit:12}})
  const poor=structuredClone(h);poor.seats.find(s=>s.seatNo===seat)!.stack=1
  expect(quoteRoll(poor,seat).normal).toMatchObject({available:false,reason:"POKER_ROLL_INSUFFICIENT_STACK"})
 })
})
