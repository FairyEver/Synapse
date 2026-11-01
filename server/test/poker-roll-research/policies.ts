import { choose } from "./math"
import { rng, seedOf } from "./math"
import { createGame, observation, bet, roll, finish, quote, coupleFuture, features, cell, pinned, type Game, type Observation, type Kind, type Config, type PriceModel, type Coefficients, type Street } from "./simulator"
import type { Decision } from "../../src/game/poker/engine/betting"
export type Profile="conservative"|"tight"|"loose"|"adaptive"
export type RollMode="none"|"adaptive"|"normal"|"super"|"alternate"|"normal-super"|"super-normal"
export interface PolicyFit {cells:Record<string,Coefficients>;fallback:Coefficients}
export const POLICY_PARAMETERS={
  conservative:{callMargin:0,raiseAt:.8,bluff:0,betFraction:.33,rollMargin:1.25},
  tight:{callMargin:.06,raiseAt:.65,bluff:0,betFraction:.5,rollMargin:1.15},
  loose:{callMargin:-.06,raiseAt:.45,bluff:.08,betFraction:1,rollMargin:.85},
  adaptive:{callMargin:0,raiseAt:.58,bluff:.03,betFraction:.75,rollMargin:1},
}
const cache=new Map<string,{normal:Opportunity;super:Opportunity}>()
export interface Opportunity {index:number;gain:number}
/** Bounded visible-card heuristic, not an equity oracle. Calibration measures actual full-hand outcomes. */
export function visibleRank(cards:readonly string[],variant:string):{category:number;kickers:number[]} {
  const counts=Array(15).fill(0),suits:Record<string,number[]>={s:[],h:[],d:[],c:[]}
  for(const c of cards){const r="23456789TJQKA".indexOf(c[0])+2;counts[r]++;suits[c[1]].push(r)}
  const all=Array.from({length:13},(_,i)=>14-i).filter(r=>counts[r]>0)
  const straight=(values:readonly number[])=>{
    const set=new Set(values);if(set.has(14))set.add(variant==="short32"?6:1)
    for(let high=14;high>=(variant==="short32"?10:5);high--)if([0,1,2,3,4].every(d=>set.has(high-d)))return high
    return 0
  }
  const flush=Object.values(suits).find(v=>v.length>=5),sf=flush?straight(flush):0
  if(sf)return {category:sf===14?9:8,kickers:[sf]}
  const quad=all.find(r=>counts[r]===4)
  if(quad)return {category:7,kickers:[quad,...all.filter(r=>r!==quad).slice(0,1)]}
  const trips=all.filter(r=>counts[r]>=3),pairs=all.filter(r=>counts[r]>=2)
  const full=trips.length?pairs.find(r=>r!==trips[0]):undefined
  if(flush&&(variant==="short32"||!full))return {category:variant==="short32"?6:5,kickers:[...flush].sort((a,b)=>b-a).slice(0,5)}
  if(full)return {category:variant==="short32"?5:6,kickers:[trips[0],full]}
  const line=straight(all);if(line)return {category:4,kickers:[line]}
  if(trips.length)return {category:3,kickers:[trips[0],...all.filter(r=>r!==trips[0]).slice(0,2)]}
  if(pairs.length>=2)return {category:2,kickers:[pairs[0],pairs[1],...all.filter(r=>r!==pairs[0]&&r!==pairs[1]).slice(0,1)]}
  if(pairs.length)return {category:1,kickers:[pairs[0],...all.filter(r=>r!==pairs[0]).slice(0,3)]}
  return {category:0,kickers:all.slice(0,5)}
}
export function visibleStrength(hole:readonly string[],board:readonly string[],variant:string):number {
  const values=hole.map(c=>"23456789TJQKA".indexOf(c[0])+2).sort((a,b)=>b-a)
  if(board.length<3){
    const low=variant==="short32"?7:2,span=14-low
    return Math.min(.985,.16+.36*(values[0]-low)/span+.20*(values[1]-low)/span+(values[0]===values[1]?.29:0)+(hole[0][1]===hole[1][1]?.035:0)+(Math.abs(values[0]-values[1])<=2?.025:0))
  }
  const cards=[...hole,...board],r=visibleRank(cards,variant)
  const levels=[.14,.52,.72,.82,.88,.93,.96,.98,.995,.999]
  let kicker=0
  for(let i=0;i<r.kickers.length;i++)kicker+=r.kickers[i]/(15**(i+1))
  let score=levels[r.category]+.09*kicker
  if(board.length<5){
    const suits=[..."shdc"].map(s=>cards.filter(c=>c[1]===s).length)
    if(Math.max(...suits)===4)score+=.035
    const ranks=new Set(cards.map(c=>"23456789TJQKA".indexOf(c[0])+2))
    if(ranks.has(14))ranks.add(variant==="short32"?6:1)
    for(let low=variant==="short32"?6:1;low<=10;low++)if(Array.from({length:5},(_,i)=>ranks.has(low+i)).filter(Boolean).length===4){score+=.025;break}
  }
  return Math.min(.9999,score)
}
export function candidateWeights(o:Observation):{card:string;weight:number;known:boolean}[] {
  const unavailable=new Set([...o.hole,...o.board])
  const unknown=(pinned.cards.orderedDeck(o.variant) as string[]).filter(c=>!unavailable.has(c))
  const lastOther=o.history.reduce((n,h,i)=>h.seat!==o.seat?i:n,-1),certain=new Set<string>()
  for(const h of o.privateHistory){
    if(h.ordinal<=lastOther||h.boardCount!==o.board.length)continue
    certain.add(h.old);h.candidates.forEach((c,i)=>{if(i!==h.selected)certain.add(c)})
  }
  for(const c of unavailable)certain.delete(c)
  const physical=(o.variant==="short32"?32:52)-o.seats.length*2-o.board.length-o.burnedCount
  if(certain.size>physical)throw new Error("Private returned-card knowledge exceeds legal remaining deck")
  const unknownWeight=(physical-certain.size)/((unknown.length-certain.size)*physical)
  return unknown.map(card=>({card,known:certain.has(card),weight:certain.has(card)?1/physical:unknownWeight}))
}
export function rollOpportunities(o:Observation):{normal:Opportunity;super:Opportunity} {
  const n=o.seats.filter(s=>!s.folded).length
  const weighted=candidateWeights(o)
  const key=`${o.variant}:${n}:${o.seats.length}:${o.burnedCount}:${o.hole.join("")}:${o.board.join("")}:${weighted.filter(w=>w.known).map(w=>w.card).sort().join("")}`
  const existing=cache.get(key);if(existing)return existing
  const value=(hole:string[])=>visibleStrength(hole,o.board,o.variant)**Math.max(1,n-1)
  const before=value(o.hole)
  const result={normal:{index:0,gain:-Infinity},super:{index:0,gain:-Infinity}}
  for(let index=0;index<2;index++){
    const scores=weighted.map(w=>{const h=[...o.hole];h[index]=w.card;return {...w,value:value(h)}}).sort((a,b)=>a.value-b.value)
    const ordinary=scores.reduce((a,w)=>a+w.value*w.weight,0)-before
    const certain=scores.filter(w=>w.known).length,uncertain=scores.length-certain
    const physical=(o.variant==="short32"?32:52)-o.seats.length*2-o.board.length-o.burnedCount
    let expected=0
    if(!certain)expected=scores.reduce((a,w,j)=>a+w.value*choose(j,2)/choose(scores.length,3),0)
    else {
      const mixture=Array.from({length:4},(_,j)=>choose(certain,j)*choose(physical-certain,3-j)/choose(physical,3))
      let k=0,u=0,previous=0
      for(let i=0;i<scores.length;i++){
        if(scores[i].known)k++;else u++
        if(i+1<scores.length&&scores[i+1].value===scores[i].value)continue
        let cdf=0
        for(let j=0;j<=3;j++)if(mixture[j]>0)cdf+=mixture[j]*choose(k,j)/choose(certain,j)*choose(u,3-j)/choose(uncertain,3-j)
        expected+=scores[i].value*(cdf-previous);previous=cdf
      }
    }
    const bestOfThree=expected-before
    if(ordinary>result.normal.gain)result.normal={index,gain:ordinary}
    if(bestOfThree>result.super.gain)result.super={index,gain:bestOfThree}
  }
  if(cache.size>=60000)cache.clear()
  cache.set(key,result);return result
}
export function chooseCandidate(o:Observation,index:number,candidates:readonly string[]):number {
  let best=0,score=-Infinity
  candidates.forEach((c,j)=>{const h=[...o.hole];h[index]=c;const value=visibleStrength(h,o.board,o.variant);if(value>score){score=value;best=j}})
  return best
}
export function chooseBet(o:Observation,profile:Profile,random:()=>number):Decision {
  const legal=o.legal
  if(profile==="conservative")return pinned.conservative.chooseBotAction({variant:o.variant,hole:o.hole,board:o.board,stack:o.stack,streetBet:o.seats.find(s=>s.seatNo===o.seat)!.streetBet,pot:o.pot,legal},random())
  const params=POLICY_PARAMETERS[profile],live=o.seats.filter(s=>!s.folded).length
  const q=visibleStrength(o.hole,o.board,o.variant)**Math.max(1,live-1)
  const call=Math.min(legal.toCall,o.stack),odds=call/(o.pot+call||1)
  const aggressive=legal.actions.includes("raise")?"raise":legal.actions.includes("bet")?"bet":null
  if(aggressive&&(q>=params.raiseAt||random()<params.bluff)){
    const own=o.seats.find(s=>s.seatNo===o.seat)!
    const desired=Math.max(legal.minRaiseTo,Math.round(own.streetBet+legal.toCall+(o.pot+call)*params.betFraction))
    if(desired<=legal.maxRaiseTo)return {action:aggressive,to:desired}
    if(legal.actions.includes("allin"))return {action:"allin"}
  }
  if(legal.actions.includes("check"))return {action:"check"}
  if(legal.actions.includes("call")&&q>=odds+params.callMargin)return {action:"call"}
  return {action:"fold"}
}
export function predictGain(o:Observation,kind:Kind,fit:PolicyFit|undefined,model:PriceModel):number {
  const opportunity=rollOpportunities(o)[kind],x=features(o)
  if(fit){const c=(fit.cells[cell(o)]??fit.fallback)[kind];return Math.max(0,c.reduce((s,v,i)=>s+v*x[i]*opportunity.gain,0))}
  // Explicit exploratory policy only; never used as fitted pricing evidence.
  return Math.max(0,opportunity.gain)*(o.effectivePot+.12*o.effectiveFuture+2*o.bigBlind)
}
export function chooseRoll(o:Observation,profile:Profile,model:PriceModel,fit:PolicyFit|undefined,mode:RollMode,initialCount=0):{kind:Kind;index:number;fee:number}|null {
  if(mode==="none"||!["preflop","flop","turn"].includes(o.street))return null
  const candidates:Kind[]=mode==="normal"?["normal"]:mode==="super"?["super"]:mode==="alternate"?[o.count%2?"super":"normal"]:mode==="normal-super"?[(o.count-initialCount)%2?"super":"normal"]:mode==="super-normal"?[(o.count-initialCount)%2?"normal":"super"]:["normal","super"]
  let result:null|{kind:Kind;index:number;fee:number}=null,best=0
  for(const kind of candidates){
    const fee=quote(o,kind,model)
    if(fee>=o.stack)continue
    const surplus=predictGain(o,kind,fit,model)-fee*POLICY_PARAMETERS[profile].rollMargin
    if(surplus>best){best=surplus;result={kind,index:rollOpportunities(o)[kind].index,fee}}
  }
  return result
}
export interface ContinueOptions {model:PriceModel;profiles:Profile[];fit:PolicyFit|undefined;rollMode:RollMode;tag?:string;startCounts?:number[]}
export function continueGame(g:Game,options:ContinueOptions):ReturnType<typeof finish> {
  while(g.hand.street!=="settled"){
    if(g.steps>20000)throw new Error("Nonterminating research trial; no result recorded")
    const o=observation(g),profile=options.profiles[o.seat%options.profiles.length]
    const command=chooseRoll(o,profile,options.model,options.fit,options.rollMode,options.startCounts?.[o.seat]??o.count)
    if(command){
      roll(g,command.kind,command.index,command.fee,rng(seedOf(g.config.seed,"roll",o.seat,o.count,o.street,options.tag??"")),cs=>chooseCandidate(o,command.index,cs))
      coupleFuture(g,seedOf(g.config.seed,"after-roll",o.seat,o.count,o.street))
    }else bet(g,chooseBet(o,profile,rng(seedOf(g.config.seed,"bet",g.steps,o.seat,options.tag??""))))
  }
  return finish(g)
}
/** Reachable, public-only warmup: everyone calls and at most one public-sized raise per earlier street. */
export function makeSnapshot(config:Config,street:Street):Game {
  for(let retry=0;retry<200;retry++){
    const g=createGame({...config,seed:seedOf(config.seed,"snapshot",retry)}),used=new Set<string>()
    const fraction=[0,.25,1,2][config.seed%4]
    let targetSteps=0
    const targetPreOffset=config.seed%Math.max(1,g.hand.seats.filter(s=>!s.folded&&!s.allIn).length)
    while(g.hand.street!=="settled"){
      if(g.hand.street===street){
        // Vary preflop investment and position without looking at any private cards.
        if(street!=="preflop"||targetSteps>=targetPreOffset)return g
        targetSteps++
      }
      if(g.hand.street==="river")break
      const o=observation(g),kind=o.legal.actions.includes("raise")?"raise":o.legal.actions.includes("bet")?"bet":null
      if(!used.has(o.street)&&kind&&fraction>0){
        used.add(o.street)
        const to=Math.max(o.legal.minRaiseTo,Math.min(Math.floor(Math.min(...o.seats.filter(s=>!s.folded).map(s=>s.stack+s.streetBet))/4),Math.round(o.pot*fraction+o.legal.toCall)))
        if(to<=o.legal.maxRaiseTo&&to<=Math.floor(Math.min(...o.seats.filter(s=>!s.folded).map(s=>s.stack+s.streetBet))/4)){bet(g,{action:kind,to});continue}
      }
      bet(g,{action:o.legal.actions.includes("check")?"check":"call"})
    }
  }
  throw new Error(`Could not reach ${street} with configuration ${JSON.stringify(config)}`)
}
