import {rng,seedOf,summarize,mean,normalQuantile} from "./math"
import {observation,roll,bet,finish,coupleFuture,quote,type Game,type Kind,type PriceModel,type Street} from "./simulator"
import {makeSnapshot,chooseRoll,chooseBet,chooseCandidate,rollOpportunities,type PolicyFit,type Profile,type RollMode} from "./policies"
import {DEPTHS} from "./study"
export const PERSONAL_MODES=["none","normal","super","normal-super","super-normal","adaptive"] as const
type PersonalMode=typeof PERSONAL_MODES[number]
interface Options {hero:number;mode:RollMode;model:PriceModel;fit:PolicyFit|undefined;profiles:Profile[];startCounts:number[]}
/** Same frozen operations/seeds; only the hero's allowed mode changes. Opponents remain adaptive. */
export function continuePersonal(g:Game,options:Options,observe?:(event:{seat:number;mode:string})=>void):ReturnType<typeof finish>{
 while(g.hand.street!=="settled"){
  if(g.steps>20000)throw new Error("Nonterminating personal sequence trial; no truncated result")
  const o=observation(g),profile=options.profiles[o.seat%options.profiles.length],mode=o.seat===options.hero?options.mode:"adaptive"
  observe?.({seat:o.seat,mode})
  const command=chooseRoll(o,profile,options.model,options.fit,mode,options.startCounts[o.seat])
  if(command){
   roll(g,command.kind,command.index,command.fee,rng(seedOf(g.config.seed,"roll",o.seat,o.count,o.street,"")),cs=>chooseCandidate(o,command.index,cs))
   coupleFuture(g,seedOf(g.config.seed,"after-roll",o.seat,o.count,o.street))
  }else bet(g,chooseBet(o,profile,rng(seedOf(g.config.seed,"bet",g.steps,o.seat,""))))
 }
 return finish(g)
}
export interface PersonalRow {id:string;group:string;seed:number;depth:number;shape:string;profile:string;count:number;endings:Record<PersonalMode,number>;gains:Record<PersonalMode,number>;fees:Record<PersonalMode,number>;rolls:Record<PersonalMode,number>;atPointRolls:Record<PersonalMode,number>}
export function personalRows(job:{variant:"standard52"|"short32";players:number;street:Street;start:number;size:number;model:PriceModel;fit:PolicyFit}):PersonalRow[]{
 const rows:PersonalRow[]=[]
 for(let index=job.start;index<job.start+job.size;index++){
  const depth=DEPTHS[index%8],seed=seedOf(20261101,"personal-sequence-final",job.variant,job.players,job.street,index)
  let shape=(["equal","short","deep","allin"] as const)[Math.floor(index/8)%4]
  if(job.players===2&&job.street!=="preflop"&&shape==="allin")shape="equal"
  const g=makeSnapshot({variant:job.variant,players:job.players,depth,shape,seed,bigBlind:2},job.street)
  for(let k=0;k<Math.floor(index/32)%4;k++){
   const o=observation(g),kind:Kind=k%2?"super":"normal",fee=quote(o,kind,job.model),slot=rollOpportunities(o)[kind].index
   if(fee>=o.stack)break
   roll(g,kind,slot,fee,rng(seedOf(g.config.seed,"personal-prior",k)),cs=>chooseCandidate(o,slot,cs))
  }
  const o=observation(g),hero=o.seat,bb=o.bigBlind,all:Profile[]=["conservative","tight","loose","adaptive"],assignment=index%5,profiles=assignment===4?all:[all[assignment]]
  const endings={} as Record<PersonalMode,number>,fees={...endings},rolls={...endings},atPointRolls={...endings},gains={...endings}
  for(const mode of PERSONAL_MODES){
   const branch=structuredClone(g);coupleFuture(branch,seedOf(g.config.seed,"personal-common-future"))
   const result=continuePersonal(branch,{hero,mode,model:job.model,fit:job.fit,profiles,startCounts:[...g.counts]})
   endings[mode]=result.ending[hero]/bb;fees[mode]=(result.paid[hero]-g.paid[hero])/bb;rolls[mode]=branch.counts[hero]-g.counts[hero]
   atPointRolls[mode]=branch.history.slice(g.history.length).filter(h=>h.seat===hero&&h.epoch===g.bets.length).length
  }
  for(const mode of PERSONAL_MODES)gains[mode]=endings[mode]-endings.none
  rows.push({id:`personal-sequence-final:${job.variant}:${job.players}:${job.street}:${index}`,group:`${job.variant}:${job.players}:${job.street}`,seed:g.config.seed,depth,shape,profile:assignment===4?"mixed":all[assignment],count:o.count,endings,gains,fees,rolls,atPointRolls})
 }
 return rows
}
export function summarizePersonal(rows:PersonalRow[]){
 const z=normalQuantile(1-.05/(2*(PERSONAL_MODES.length-1)))
 const summary=(a:PersonalRow[])=>Object.fromEntries(PERSONAL_MODES.map(mode=>[mode,{n:a.length,net:summarize(a.map(r=>r.gains[mode]),z),meanFees:mean(a.map(r=>r.fees[mode])),meanRolls:mean(a.map(r=>r.rolls[mode])),meanAtPointRolls:mean(a.map(r=>r.atPointRolls[mode])),lossFraction:mean(a.map(r=>r.gains[mode]<0?1:0)),stops:Object.fromEntries([...new Set(a.map(r=>r.count+r.atPointRolls[mode]))].sort((a,b)=>a-b).map(k=>[k,a.filter(r=>r.count+r.atPointRolls[mode]===k).length]))}]))
 return {rows:rows.length,z,byMode:summary(rows),byCount:Object.fromEntries([...new Set(rows.map(r=>r.count))].sort((a,b)=>a-b).map(count=>[count,summary(rows.filter(r=>r.count===count))])),interpretation:"Only hero mode changes; opponents retain the same adaptive policy, responding naturally to state. Reference hero never Rolls for the rest of this hand, different from formal immediate-normal-action/preserve-later-options baseline. Five mode contrasts Bonferroni normal intervals, independent diagnostics only, no model fitting or gate changes."}
}
