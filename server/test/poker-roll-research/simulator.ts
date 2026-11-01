import pinned from "./engine.cjs"
import type { HandState } from "../../src/game/poker/engine/hand-runner"
import type { Decision } from "../../src/game/poker/engine/betting"
import type { PokerVariant } from "../../src/game/poker/engine/rules"
import { rng, seedOf } from "./math"
export { pinned }
export type Kind = "normal" | "super"
export type Street = "preflop" | "flop" | "turn"
export type Coefficients = Record<Kind, [number,number,number]>
export interface PriceModel {
  scale:number
  curve:"linear"|"quadratic"|"geometric"
  growth:number
  coefficients:Coefficients
  cells?:Record<string,Coefficients>
  history:{normal:number;super:number}
  historyByKind?:Record<Kind,{normal:number;super:number}>
}
export interface History {seat:number;kind:Kind;fee:number;street:string;index:number;epoch:number}
export interface Config {variant:PokerVariant;players:number;depth:number;seed:number;dealer?:number;shape?:"equal"|"short"|"deep"|"allin";bigBlind?:number;stacks?:number[]}
export interface PrivateRoll {kind:Kind;old:string;candidates:string[];selected:number;ordinal:number;boardCount:number}
export interface Game {
  config:Config; hand:HandState; original:number[]; credits:number[]; paid:number[]; counts:number[]
  history:History[]; privateHistory:PrivateRoll[][]; burned:string[]; released:boolean; steps:number;bets:Decision[]
}
export interface Observation {
  variant:PokerVariant;street:string;seat:number;dealer:number;hole:string[];board:string[];stack:number;count:number
  bigBlind:number;pot:number;effectivePot:number;effectiveFuture:number;burnedCount:number
  seats:{seatNo:number;stack:number;total:number;streetBet:number;folded:boolean;allIn:boolean}[]
  legal:{actions:Decision["action"][];toCall:number;minRaiseTo:number;maxRaiseTo:number}
  history:History[];privateHistory:PrivateRoll[]
}
const sum = (a:readonly number[]) => a.reduce((s,n)=>s+n,0)
export function createGame(config:Config): Game {
  const bb = config.bigBlind ?? 2
  const dealer=config.dealer??config.seed%config.players,allinSeat=(dealer+(config.players===2?1:2))%config.players
  const original = config.stacks ? [...config.stacks] : Array.from({length:config.players},(_,i)=>config.shape==="allin"&&i===allinSeat?bb:Math.max(1,Math.round(config.depth*bb*(config.shape==="short"&&i===0?.2:config.shape==="deep"&&i===0?3:1))))
  const random = rng(seedOf(config.seed,"initial-deck"))
  const deck = pinned.cards.shuffle(pinned.cards.orderedDeck(config.variant),(n:number)=>Math.floor(random()*n))
  const hand = pinned.hand.startHand(original.map((stack,seatNo)=>({stack,seatNo})),config.dealer??config.seed%config.players,deck,{variant:config.variant,smallBlind:bb/2,bigBlind:bb}) as HandState
  const g:Game = {config,hand,original,credits:original.map(()=>0),paid:original.map(()=>0),counts:original.map(()=>0),history:[],privateHistory:original.map(()=>[]),burned:[],released:false,steps:0,bets:[]}
  // Initial tiny stacks can run out immediately; reconstruct only cards absent from the current state.
  const used = new Set([...hand.deck,...hand.board,...hand.seats.flatMap(p=>p.hole)])
  g.burned = deck.filter((c:string)=>!used.has(c))
  assertState(g); return g
}
export function observation(g:Game, seat=g.hand.actionOnSeat!): Observation {
  const p = g.hand.seats.find(p=>p.seatNo===seat)
  if (!p) throw new Error("No observed participant")
  const cap = p.total+p.stack
  return {
    variant:g.hand.variant,street:g.hand.street,seat,dealer:g.hand.dealerSeat,hole:[...p.hole],board:[...g.hand.board],stack:p.stack,count:g.counts[seat],bigBlind:g.hand.bigBlind,
    pot:sum(g.hand.seats.map(s=>s.total)),effectivePot:sum(g.hand.seats.map(s=>Math.min(s.total,cap))),
    effectiveFuture:sum(g.hand.seats.filter(s=>s.seatNo!==seat&&!s.folded).map(s=>Math.max(0,Math.min(s.stack,cap-s.total)))),
    burnedCount:g.burned.length,seats:g.hand.seats.map(({seatNo,stack,total,streetBet,folded,allIn})=>({seatNo,stack,total,streetBet,folded,allIn})),
    legal:pinned.hand.legalActions(g.hand,seat),history:g.history.map(h=>({...h})),privateHistory:g.privateHistory[seat].map(h=>({...h,candidates:[...h.candidates]})),
  }
}
export function multiplier(model:PriceModel, count:number):number {
  return model.curve==="linear"?1+model.growth*count:model.curve==="quadratic"?1+model.growth*count*count:(1+model.growth)**count
}
export function historyFeatures(o:Observation): [number,number] {
  const opponents = Math.max(1,o.seats.filter(s=>!s.folded).length-1)
  return [o.history.filter(h=>h.seat!==o.seat&&h.kind==="normal").length/opponents,o.history.filter(h=>h.seat!==o.seat&&h.kind==="super").length/opponents]
}
export function features(o:Observation):[number,number,number] { return [o.bigBlind,o.effectivePot,o.effectiveFuture] }
export function cell(o:Observation):string { return `${o.variant}:${o.seats.filter(s=>!s.folded).length}:${o.street}` }
export function quote(o:Observation, kind:Kind, model:PriceModel):number {
  const coeff=(model.cells?.[cell(o)]??model.coefficients)[kind], x=features(o), h=historyFeatures(o)
  const adjustment=model.historyByKind?.[kind]??model.history
  const history=Math.exp(adjustment.normal*h[0]+adjustment.super*h[1])
  const base=Math.max(0,coeff.reduce((a,c,i)=>a+c*x[i],0))*model.scale*history
  const normalCoeff=(model.cells?.[cell(o)]??model.coefficients).normal
  const normalAdjustment=model.historyByKind?.normal??model.history
  const normalHistory=Math.exp(normalAdjustment.normal*h[0]+normalAdjustment.super*h[1])
  const normalBase=Math.max(1,normalCoeff.reduce((a,c,i)=>a+c*x[i],0)*model.scale*normalHistory)
  const firstBase=kind==="normal"?Math.max(1,base):Math.max(normalBase+1,base)
  return Math.min(Number.MAX_SAFE_INTEGER,Math.max(1,Math.ceil(firstBase*multiplier(model,o.count))))
}
export function roll(g:Game, kind:Kind, index:number, fee:number, random:()=>number, select:(candidates:string[])=>number=()=>0): {candidates:string[];selected:number} {
  const p = g.hand.seats.find(p=>p.seatNo===g.hand.actionOnSeat)
  if(!p||g.hand.street==="river"||g.hand.street==="settled"||p.folded||p.allIn||g.released||![0,1].includes(index)||!Number.isSafeInteger(fee)||fee<0||p.stack<=fee) throw new Error("Roll unavailable")
  const count=kind==="normal"?1:3
  if(g.hand.deck.length<count)throw new Error("Insufficient candidate cards")
  // Build/validate the choice before committing, so a throwing selector cannot corrupt a trial.
  const shuffled = pinned.cards.shuffle(g.hand.deck,(n:number)=>Math.floor(random()*n)) as string[]
  const candidates=shuffled.slice(0,count), selected=kind==="normal"?0:select([...candidates])
  if(!Number.isInteger(selected)||selected<0||selected>=count)throw new Error("Invalid candidate selection")
  const old=p.hole[index]
  p.hole[index]=candidates[selected]
  g.hand.deck=pinned.cards.shuffle([...shuffled.slice(count),old,...candidates.filter((_,i)=>i!==selected)],(n:number)=>Math.floor(random()*n))
  p.stack-=fee
  // Research adapter only: engine anchor excludes escrow; original capital is independently immutable.
  p.startingStack-=fee
  g.paid[p.seatNo]+=fee;g.counts[p.seatNo]++
  const eligible=g.hand.seats.filter(s=>s.seatNo!==p.seatNo&&!s.folded).sort((a,b)=>(a.seatNo-g.hand.dealerSeat-1+g.original.length)%g.original.length-(b.seatNo-g.hand.dealerSeat-1+g.original.length)%g.original.length)
  if(!eligible.length)throw new Error("No compensation recipient")
  eligible.forEach((s,i)=>{g.credits[s.seatNo]+=Math.floor(fee/eligible.length)+(i<fee%eligible.length?1:0)})
  g.privateHistory[p.seatNo].push({kind,old,candidates:[...candidates],selected,ordinal:g.history.length,boardCount:g.hand.board.length})
  g.history.push({seat:p.seatNo,kind,fee,street:g.hand.street,index:g.counts[p.seatNo],epoch:g.bets.length})
  g.steps++;assertState(g);return {candidates,selected}
}
export function bet(g:Game, decision:Decision):void {
  if(g.released)throw new Error("Hand already released")
  const oldDeck=[...g.hand.deck],oldBoard=new Set(g.hand.board)
  g.hand=pinned.hand.act(g.hand,g.hand.actionOnSeat!,decision)
  const present=new Set([...g.hand.deck,...g.hand.board.filter(c=>!oldBoard.has(c))])
  g.burned.push(...oldDeck.filter(c=>!present.has(c)))
  g.bets.push({...decision});g.steps++;assertState(g)
}
export function assertState(g:Game):void {
  const cards=[...g.hand.deck,...g.hand.board,...g.hand.seats.flatMap(s=>s.hole),...g.burned]
  const deck=pinned.cards.orderedDeck(g.hand.variant) as string[]
  if(cards.length!==deck.length||new Set(cards).size!==deck.length||cards.some(c=>!deck.includes(c)))throw new Error("Card conservation violated")
  const capital=sum(g.original),credits=sum(g.credits),paid=sum(g.paid)
  if(credits!==paid||sum(g.hand.seats.map(s=>s.startingStack))+paid!==capital)throw new Error("Escrow ownership violated")
  const active = sum(g.hand.seats.map(s=>s.stack+(g.hand.street==="settled"?0:s.total)))
  if(active+(g.released?0:credits)!==capital)throw new Error("Original capital conservation violated")
  if(g.hand.seats.some(s=>s.stack<0||!Number.isSafeInteger(s.stack)))throw new Error("Invalid stack")
}
export function finish(g:Game): {ending:number[];net:number[];paid:number[];received:number[]} {
  if(g.hand.street!=="settled")throw new Error("Hand not settled")
  if(!g.released){g.hand.seats.forEach(s=>{s.stack+=g.credits[s.seatNo]});g.released=true;assertState(g)}
  const ending=g.hand.seats.map(s=>s.stack)
  return {ending,net:ending.map((v,i)=>v-g.original[i]),paid:[...g.paid],received:[...g.credits]}
}

/** Common-random-number coupling: uniform full-deck priorities, restricted to each legal remaining pool. */
export function coupleFuture(g:Game,seed:number):void {
  const random=rng(seed)
  const full=pinned.cards.shuffle(pinned.cards.orderedDeck(g.hand.variant),(n:number)=>Math.floor(random()*n)) as string[]
  const priority=new Map(full.map((card,i)=>[card,i]))
  g.hand.deck.sort((a,b)=>priority.get(a)!-priority.get(b)!)
}
