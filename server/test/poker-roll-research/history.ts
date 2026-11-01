import { rng, seedOf, summarize, mean } from "./math"
import { createGame, observation, bet, roll, quote, coupleFuture, features, type Config, type Game, type Kind, type PriceModel, type Street } from "./simulator"
import { makeSnapshot, rollOpportunities, chooseCandidate, chooseBet, continueGame, type PolicyFit, type Profile } from "./policies"
/** Extra capital is assigned at admission, then the identical legal warmup is replayed. No mid-hand top-up. */
export function historyPair(config:Config,street:Street,sequence:Kind[],model:PriceModel,folded:boolean):{control:Game;matched:Game;total:Game} {
  const source=makeSnapshot({...config,seed:config.seed-config.seed%config.players,shape:"equal"},street),o=observation(source),actor=o.seat
  const fees=sequence.map((kind,k)=>quote({...o,count:k},kind,model)),stacks=[...source.original]
  stacks[actor]+=fees.reduce((a,b)=>a+b,0)
  const matched=createGame({...source.config,stacks})
  for(const action of source.bets)bet(matched,action)
  const total=structuredClone(source),control=structuredClone(source)
  function apply(g:Game,strict:boolean){
    for(let k=0;k<sequence.length;k++){
      const observed=observation(g),kind=sequence[k],fee=quote(observed,kind,model),slot=rollOpportunities(observed)[kind].index
      if(strict&&fee!==fees[k])throw new Error("Controlled history fee changed after admission replay")
      if(fee>=observed.stack){if(strict)throw new Error("Controlled history unexpectedly unaffordable");break}
      roll(g,kind,slot,fee,rng(seedOf(source.config.seed,"prior-roll",k)),cs=>chooseCandidate(observed,slot,cs))
    }
    const current=observation(g)
    bet(g,{action:folded?"fold":current.legal.actions.includes("check")?"check":"call"})
  }
  apply(matched,true);apply(total,false)
  const before=observation(control)
  bet(control,{action:folded?"fold":before.legal.actions.includes("check")?"check":"call"})
  if(control.hand.street==="settled"||matched.hand.street==="settled"||total.hand.street==="settled")throw new Error("No later decision after assigned history")
  const a=observation(control),b=observation(matched)
  if(a.seat!==b.seat||a.stack!==b.stack||a.pot!==b.pot||a.effectivePot!==b.effectivePot||a.effectiveFuture!==b.effectiveFuture||a.count!==b.count)throw new Error("Public funding was not exactly matched")
  return {control,matched,total}
}
export function conditionalValue(g:Game,kind:Kind,model:PriceModel,fit:PolicyFit|undefined,profiles:Profile[]):number {
  const o=observation(g),who=o.seat,slot=rollOpportunities(o)[kind].index,seed=seedOf(g.config.seed,"history-pair-future")
  const baseline=structuredClone(g),branch=structuredClone(g),options={model,fit,profiles,rollMode:"adaptive" as const}
  coupleFuture(baseline,seed)
  bet(baseline,chooseBet(o,profiles[who%profiles.length],rng(seedOf(g.config.seed,"history-bet"))))
  const b=continueGame(baseline,options)
  // Zero only for this one randomized intervention: measure gross opportunity, all future Roll is paid.
  roll(branch,kind,slot,0,rng(seedOf(g.config.seed,"history-candidate")),cs=>chooseCandidate(o,slot,cs))
  coupleFuture(branch,seed)
  const a=continueGame(branch,options)
  return (a.ending[who]-b.ending[who])/o.bigBlind
}
export interface HistoryRow {id:string;group:string;pattern:string;kind:Kind;control:number;matched:number;total:number;conditional:number;overall:number;exactMatched:boolean;x:number[];h:number;baseValue:number}
export function historyJob(job:{variant:"standard52"|"short32";players:number;street:Street;size:number;model:PriceModel;fit:PolicyFit;split?:string}):HistoryRow[] {
  const rows:HistoryRow[]=[]
  for(let index=0;index<job.size;index++){
    const pattern=index%4,sequence:Kind[]=pattern===0?["normal"]:pattern===1?["super"]:["normal","super"]
    const folded=pattern===3&&job.players>2
    const seed=seedOf(20261101,job.split??"history-holdout",job.variant,job.players,job.street,index)
    const pair=historyPair({variant:job.variant,players:job.players,depth:[25,100,500,2500][Math.floor(index/4)%4],seed,bigBlind:2},job.street,sequence,job.model,folded)
    const observed=observation(pair.control),group=`${job.variant}:${observed.seats.filter(s=>!s.folded).length}:${observed.street}`
    for(const kind of ["normal","super"] as Kind[]){
      const control=conditionalValue(pair.control,kind,job.model,job.fit,["adaptive","tight","loose","conservative"])
      const matched=conditionalValue(pair.matched,kind,job.model,job.fit,["adaptive","tight","loose","conservative"])
      const total=conditionalValue(pair.total,kind,job.model,job.fit,["adaptive","tight","loose","conservative"])
      const coefficients=(job.model.cells?.[group]??job.model.coefficients)[kind],x=features(observed).map(v=>v/observed.bigBlind)
      const baseValue=coefficients.reduce((s,c,i)=>s+c*x[i],0)
      rows.push({h:1/Math.max(1,observed.seats.filter(s=>!s.folded).length-1),baseValue,id:`${group}:${index}:${kind}`,group,pattern:folded?"mixed-then-fold":sequence.join("-"),kind,control,matched,total,conditional:matched-control,overall:total-control,exactMatched:true,x:features(observed).map(v=>v/observed.bigBlind)})
    }
  }
  return rows
}
export function summarizeHistory(rows:HistoryRow[]){
  const groups=Object.fromEntries([...new Set(rows.map(r=>`${r.pattern}:${r.kind}`))].map(key=>{
    const a=rows.filter(r=>`${r.pattern}:${r.kind}`===key),conditional=summarize(a.map(r=>r.conditional)),overall=summarize(a.map(r=>r.overall))
    return [key,{n:a.length,conditional,overall,controlValue:mean(a.map(r=>r.control)),evidence:conditional.lower>0?"positive":conditional.upper<0?"negative":"unresolved",provenEquivalentToZero:false}]
  }))
  return {rows:rows.length,exactMatches:rows.filter(r=>r.exactMatched).length,groups,interpretation:"Controlled history uses different initial funding to exactly match current public funding. Assigned prior actions and finite strategies do not identify universal causal effects. CI crossing zero means unresolved, not zero effect."}
}

export function estimateHistory(rows:HistoryRow[]){
  const coefficients={normal:{normal:0,super:0},super:{normal:0,super:0}}
  const details:Record<string,{n:number;estimate:number;se:number;lower:number;upper:number;enabled:boolean}>={}
  for(const kind of ["normal","super"] as Kind[])for(const prior of ["normal","super"] as Kind[]){
    const selected=rows.filter(r=>r.kind===kind&&r.pattern===prior),x=selected.map(r=>r.baseValue*r.h),y=selected.map(r=>r.conditional)
    const xx=x.reduce((s,v)=>s+v*v,0),estimate=xx?x.reduce((s,v,i)=>s+v*y[i],0)/xx:0
    const se=xx&&selected.length>1?Math.sqrt(x.reduce((s,v,i)=>s+v*v*(y[i]-estimate*v)**2,0)*selected.length/(selected.length-1))/xx:Infinity
    // Four current-tier/prior-tier comparisons: Bonferroni family-wise alpha=.05, not four unadjusted claims.
    const lower=estimate-2.497705*se,upper=estimate+2.497705*se,enabled=lower>0||upper<0
    details[`${kind}:${prior}`]={n:selected.length,estimate,se,lower,upper,enabled}
    coefficients[kind][prior]=enabled?estimate:0
  }
  return {coefficients,details,interpretation:"Signed first-order log price correction; exact current-funding matched samples, finite assigned strategy model. Zero applied coefficient means insufficient evidence, not proven zero effect."}
}
