import { rng, seedOf } from "./math"
import { createGame, observation, bet, roll, quote, features, type Config, type Game, type Kind, type PriceModel, type Street } from "./simulator"
import { makeSnapshot, rollOpportunities, chooseCandidate, type PolicyFit } from "./policies"
import { conditionalValue, type HistoryRow } from "./history"

/** Solve admission funding before play; never top up an in-progress hand. */
export function multiHistoryPair(config:Config,street:Street,sequences:Kind[][],model:PriceModel,foldLast:boolean):{control:Game;matched:Game;total:Game;iterations:number} {
  if(sequences.length<2||sequences.length>=config.players)throw new Error("Need at least two prior actors and one later actor")
  const source=makeSnapshot({...config,seed:config.seed-config.seed%config.players,shape:"equal"},street)
  const control=structuredClone(source),actors:number[]=[]
  function normalAction(g:Game,j:number){const o=observation(g);bet(g,{action:foldLast&&j===sequences.length-1?"fold":o.legal.actions.includes("check")?"check":"call"})}
  for(let j=0;j<sequences.length;j++){actors.push(observation(control).seat);normalAction(control,j)}
  if(control.hand.street!==street)throw new Error("Assigned prior actions exhausted this action point")
  function apply(g:Game,strict:boolean):{paid:number[];shortfall?:{seat:number;amount:number}}{
    const paid=g.original.map(()=>0)
    for(let j=0;j<sequences.length;j++){
      if(observation(g).seat!==actors[j])throw new Error("Prior actor order changed")
      for(let k=0;k<sequences[j].length;k++){
        const o=observation(g),kind=sequences[j][k],fee=quote(o,kind,model),slot=rollOpportunities(o)[kind].index
        if(fee>=o.stack){if(strict)return {paid,shortfall:{seat:o.seat,amount:fee-o.stack+1}};break}
        roll(g,kind,slot,fee,rng(seedOf(source.config.seed,"multi-prior",j,k)),cs=>chooseCandidate(o,slot,cs))
        paid[o.seat]+=fee
      }
      normalAction(g,j)
    }
    return {paid}
  }
  let funding=source.original.map(()=>0),matched:Game|undefined,iterations=0
  for(;iterations<64;iterations++){
    const game=createGame({...source.config,stacks:source.original.map((v,i)=>v+funding[i])})
    for(const action of source.bets)bet(game,action)
    const result=apply(game,true)
    // The incomplete trial is discarded. Recreate from admission with more capital;
    // no trial is mutated in place to make an unaffordable Roll appear legal.
    if(result.shortfall){funding[result.shortfall.seat]+=result.shortfall.amount;continue}
    const required=result.paid
    if(required.every((v,i)=>v===funding[i])){matched=game;break}
    funding=required
  }
  if(!matched)throw new Error("Admission funding fixed point did not converge; no unmatched row recorded")
  const total=structuredClone(source);apply(total,false)
  const a=observation(control),b=observation(matched)
  if(a.seat!==b.seat||a.street!==b.street||a.stack!==b.stack||a.pot!==b.pot||a.effectivePot!==b.effectivePot||a.effectiveFuture!==b.effectiveFuture||a.count!==b.count)throw new Error("Multi-actor current funding not exactly matched")
  return {control,matched,total,iterations:iterations+1}
}

export function multiHistoryRows(job:{variant:"standard52"|"short32";players:number;street:Street;start:number;size:number;model:PriceModel;fit:PolicyFit}):HistoryRow[]{
  const rows:HistoryRow[]=[]
  for(let index=job.start;index<job.start+job.size;index++){
    const pattern=index%4,third=job.players>3&&pattern===3
    const sequences:Kind[][]=pattern===0?[["normal"],["super"]]:pattern===1?[["super","super"],["normal","normal"]]:third?[["normal"],["super"],["normal","super"]]:[["normal","super"],["super","normal"]]
    const pair=multiHistoryPair({variant:job.variant,players:job.players,depth:[25,100,500,2500][Math.floor(index/4)%4],seed:seedOf(20261101,"multi-history-final",job.variant,job.players,job.street,index),bigBlind:2},job.street,sequences,job.model,pattern>=2)
    const o=observation(pair.control),group=`${o.variant}:${o.seats.filter(s=>!s.folded).length}:${o.street}`
    for(const kind of ["normal","super"] as Kind[]){
      const profiles=["adaptive","tight","loose","conservative"] as const
      const control=conditionalValue(pair.control,kind,job.model,job.fit,[...profiles]),matched=conditionalValue(pair.matched,kind,job.model,job.fit,[...profiles]),total=conditionalValue(pair.total,kind,job.model,job.fit,[...profiles])
      rows.push({id:`multi-history-final:${job.variant}:${job.players}:${job.street}:${index}:${kind}`,group,pattern:`${sequences.length}actors-${sequences.map(s=>s.join("+")).join("/")}${pattern>=2?"-then-fold":""}`,kind,control,matched,total,conditional:matched-control,overall:total-control,exactMatched:true,x:features(o).map(v=>v/o.bigBlind),h:0,baseValue:0})
    }
  }
  return rows
}
