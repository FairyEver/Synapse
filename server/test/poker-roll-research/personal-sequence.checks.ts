import {expect,it} from "vitest"
import {continuePersonal} from "./personal-sequence"
import {makeSnapshot,continueGame} from "./policies"
import {observation,assertState} from "./simulator"
import {EXPLORATION_MODEL} from "./study"
it("只改变本人模式；自适应对照与冻结续局逐筹码一致，对手始终自适应",()=>{
 for(const variant of ["standard52","short32"] as const)for(const street of ["preflop","flop","turn"] as const){
  const g=makeSnapshot({variant,players:6,depth:25,seed:43,bigBlind:2},street),hero=observation(g).seat
  const options={model:EXPLORATION_MODEL,fit:undefined,profiles:["adaptive","tight","loose","conservative"] as const,startCounts:[...g.counts]}
  const original=continueGame(structuredClone(g),{...options,profiles:[...options.profiles],rollMode:"adaptive"})
  const actual=continuePersonal(structuredClone(g),{...options,profiles:[...options.profiles],hero,mode:"adaptive"})
  expect(actual).toEqual(original)
  const seen:{seat:number;mode:string}[]=[],branch=structuredClone(g)
  continuePersonal(branch,{...options,profiles:[...options.profiles],hero,mode:"normal-super"},event=>seen.push(event))
  expect(seen.some(e=>e.seat===hero&&e.mode==="normal-super")).toBe(true)
  expect(seen.filter(e=>e.seat!==hero).every(e=>e.mode==="adaptive")).toBe(true)
  assertState(branch)
 }
},30000)
