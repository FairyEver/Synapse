import { rng, seedOf, summarize, mean } from "./math"
import { observation, roll, bet, quote, features, historyFeatures, cell, coupleFuture, type Kind, type Game, type PriceModel, type Street, type Config } from "./simulator"
import { makeSnapshot, chooseBet, chooseCandidate, rollOpportunities, chooseRoll, continueGame, type Profile, type PolicyFit, type RollMode } from "./policies"
import type { Row } from "./calibration"
export const DEPTHS=[10,25,50,100,250,500,1000,2500]
export const PROFILES:Profile[]=["conservative","tight","loose","adaptive"]
export const EXPLORATION_MODEL:PriceModel={scale:1,curve:"linear",growth:.5,coefficients:{normal:[.5,.02,.001],super:[1,.05,.003]},history:{normal:0,super:0}}
export interface Job {phase:string;variant:"standard52"|"short32";players:number;street:Street;start:number;size:number;model:PriceModel;fit?:PolicyFit;continuation?:RollMode}
function initialSnapshot(job:Job,index:number):{g:Game;profiles:Profile[];depth:number;shape:string;profile:string} {
  const seed=seedOf(20261101,job.phase,job.variant,job.players,job.street,index),random=rng(seed)
  const depth=DEPTHS[index%DEPTHS.length];let shape=(["equal","short","deep","allin"] as const)[Math.floor(index/8)%4]
  if(job.players===2&&job.street!=="preflop"&&shape==="allin")shape="equal"
  const assignment=index%5,profiles=assignment===4?PROFILES:[PROFILES[assignment]]
  const historyCase=Math.floor(index/3)%5,folded=historyCase===4&&job.players<10
  const bigBlind=[2,4,10,20][Math.floor(index/24)%4]
  const config:Config={variant:job.variant,players:job.players+(folded?1:0),depth,shape,seed,bigBlind}
  let g=makeSnapshot(config,job.street)
  // Assigned public interventions provide coverage; histories and their exploratory/actual fee model are recorded.
  if(historyCase!==0){
    const repetitions=historyCase===3?2:1
    for(let k=0;k<repetitions;k++){
      const o=observation(g),kind:Kind=historyCase===2||k%2?"super":"normal",fee=quote(o,kind,job.model)
      if(fee>=o.stack)break
      const index=rollOpportunities(o)[kind].index
      roll(g,kind,index,fee,random,cs=>chooseCandidate(o,index,cs))
    }
    const o=observation(g)
    bet(g,{action:folded?"fold":o.legal.actions.includes("check")?"check":"call"})
  }
  // Very shallow assigned histories can naturally end the hand. Keep the requested main cell reachable.
  if(g.hand.street!==job.street||observation(g).seats.filter(s=>!s.folded).length!==job.players){
    g=makeSnapshot({...config,players:job.players},job.street)
  }
  const ownTimes=[0,0,0,0,1,1,2,3][Math.floor(index/5)%8]
  for(let k=0;k<ownTimes;k++){
    const o=observation(g),kind:Kind=k%2?"super":"normal",fee=quote(o,kind,job.model)
    if(fee>=o.stack)break
    const slot=rollOpportunities(o)[kind].index
    roll(g,kind,slot,fee,random,cs=>chooseCandidate(o,slot,cs))
  }
  return {g,profiles,depth,shape,profile:assignment===4?"mixed":PROFILES[assignment]}
}
export function runRow(job:Job,index:number):Row {
  const source=initialSnapshot(job,index),g=source.g,o=observation(g),who=o.seat,opportunities=rollOpportunities(o),bb=o.bigBlind
  const options={model:job.model,profiles:source.profiles,fit:job.fit,rollMode:job.continuation??"adaptive",startCounts:[...g.counts]}
  const baseline=structuredClone(g),futureSeed=seedOf(g.config.seed,"paired-future")
  coupleFuture(baseline,futureSeed)
  bet(baseline,chooseBet(o,source.profiles[who%source.profiles.length],rng(seedOf(g.config.seed,"bet",g.steps,who,""))))
  const base=continueGame(baseline,options)
  const gains:Record<Kind,number>={normal:0,super:0},fees:Record<Kind,number>={normal:0,super:0}
  for(const kind of ["normal","super"] as Kind[]){
    const branch=structuredClone(g)
    const fee=job.phase==="train"?0:quote(o,kind,job.model)
    fees[kind]=fee/bb
    if(fee>=o.stack){gains[kind]=NaN;continue}
    const slot=opportunities[kind].index
    roll(branch,kind,slot,fee,rng(seedOf(g.config.seed,"roll",who,o.count,o.street,"")),cs=>chooseCandidate(o,slot,cs))
    coupleFuture(branch,futureSeed)
    const result=continueGame(branch,options)
    gains[kind]=(result.ending[who]-base.ending[who])/bb
  }
  let voluntary=structuredClone(g)
  const command=chooseRoll(o,source.profiles[who%source.profiles.length],job.model,job.fit,options.rollMode,o.count),chosen=!!command
  if(command){
    roll(voluntary,command.kind,command.index,command.fee,rng(seedOf(g.config.seed,"roll",who,o.count,o.street,"")),cs=>chooseCandidate(o,command.index,cs))
    coupleFuture(voluntary,futureSeed)
  }else voluntary=baseline
  const actual=chosen?continueGame(voluntary,options):base
  const actionRolls=voluntary.history.slice(g.history.length).filter(h=>h.seat===who&&h.epoch===g.bets.length)
  return {id:`${job.phase}:${job.variant}:${job.players}:${job.street}:${index}`,group:cell(o),split:job.phase,seed:g.config.seed,variant:job.variant,players:job.players,street:job.street,depth:source.depth,shape:source.shape,profile:source.profile,
    allinOpponents:o.seats.filter(s=>s.seatNo!==who&&s.allIn&&!s.folded).length,folded:o.seats.filter(s=>s.folded).length,sidePots:Math.max(0,voluntary.hand.pots.filter(p=>!p.refund).length-1),refundPots:voluntary.hand.pots.filter(p=>p.refund).length,
    x:features(o).map(v=>v/bb) as [number,number,number],history:historyFeatures(o),count:o.count,proxy:[opportunities.normal.gain,opportunities.super.gain],normal:gains.normal,super:gains.super,voluntary:(actual.ending[who]-base.ending[who])/bb,
    texture:boardTexture(o.board,o.variant),normalFee:fees.normal,superFee:fees.super,paid:actionRolls.reduce((s,h)=>s+h.fee,0)/bb,totalPaid:(actual.paid[who]-g.paid[who])/bb,chosenKind:command?.kind??null,received:(actual.received[who]-g.credits[who])/bb,
    rolls:actionRolls.length,futureRolls:voluntary.counts[who]-g.counts[who],normalRolls:actionRolls.filter(h=>h.kind==="normal").length,
    superRolls:actionRolls.filter(h=>h.kind==="super").length,ending:actual.ending[who]/bb,baseline:base.ending[who]/bb,chosen}
}
export function runJob(job:Job):Row[] {return Array.from({length:job.size},(_,j)=>{
  try{return runRow(job,job.start+j)}catch(cause){throw new Error(`Research scenario failed: ${job.phase} ${job.variant} ${job.players} ${job.street} index ${job.start+j}`,{cause})}
})}
export function summarizeRows(rows:Row[],model:PriceModel,diagnosticZ=2.807033768343811){
  const finite=(kind:Kind)=>rows.filter(r=>Number.isFinite(r[kind]))
  const chosen=rows.filter(r=>r.chosen),net=summarize(chosen.map(r=>r.voluntary))
  const groups=Object.fromEntries([...new Set(rows.map(r=>r.group))].map(key=>{
    const group=rows.filter(r=>r.group===key),n=group.filter(r=>Number.isFinite(r.normal)),s=group.filter(r=>Number.isFinite(r.super))
    const normal=summarize(n.map(r=>r.normal),diagnosticZ),superRoll=summarize(s.map(r=>r.super),diagnosticZ)
    const targetNormal=Math.max(.25,.1*mean(n.map(r=>r.normalFee))),targetSuper=Math.max(.25,.1*mean(s.map(r=>r.superFee)))
    return [key,{intervalMethod:"normal approximation, per-cell Bonferroni over two tiers and planned looks",diagnosticZ,n:group.length,normalAvailable:n.length,superAvailable:s.length,normal,super:superRoll,targetNormal,targetSuper,precisionMet:group.length>=2048&&normal.halfWidth<=targetNormal&&superRoll.halfWidth<=targetSuper,
      voluntary:summarize(group.filter(r=>r.chosen).map(r=>r.voluntary)),paid:mean(group.map(r=>r.paid)),meanNormalFee:mean(n.map(r=>r.normalFee)),meanSuperFee:mean(s.map(r=>r.superFee))}]
  }))
  return {model,rows:rows.length,chosen:chosen.length,chosenNet:net,byKind:Object.fromEntries((["normal","super"] as Kind[]).map(kind=>[kind,summarize(rows.filter(r=>r.chosenKind===kind).map(r=>r.voluntary))])),allOpportunitiesNet:summarize(rows.map(r=>r.voluntary)),meanCompensation:mean(rows.map(r=>r.paid)),meanRolls:mean(rows.map(r=>r.rolls)),
    normalForced:summarize(finite("normal").map(r=>r.normal)),superForced:summarize(finite("super").map(r=>r.super)),groups,
    countBreakdown:Object.fromEntries([...new Set(rows.map(r=>r.count))].sort((a,b)=>a-b).map(count=>[count,{n:rows.filter(r=>r.count===count).length,net:summarize(rows.filter(r=>r.count===count&&r.chosen).map(r=>r.voluntary)),meanFee:mean(rows.filter(r=>r.count===count).map(r=>r.paid))}]))}
}

export function boardTexture(board:readonly string[],variant:string):string {
  if(!board.length)return "preflop"
  const ranks=board.map(c=>"23456789TJQKA".indexOf(c[0])+2),set=new Set(ranks)
  const pairing=set.size<ranks.length?"paired":"unpaired"
  const maxSuit=Math.max(...[..."shdc"].map(s=>board.filter(c=>c[1]===s).length))
  if(set.has(14))set.add(variant==="short32"?6:1)
  let connected=false
  for(let low=variant==="short32"?6:1;low<=10;low++)if([0,1,2,3,4].filter(d=>set.has(low+d)).length>=3)connected=true
  return `${pairing}|max-suit-${maxSuit}|${connected?"connected":"disconnected"}`
}
