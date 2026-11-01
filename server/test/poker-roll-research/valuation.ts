import { rng, seedOf, summarize, mean, normalQuantile } from "./math"
import { makeSnapshot, chooseBet, chooseCandidate, rollOpportunities, continueGame, type PolicyFit, type Profile } from "./policies"
import { observation, roll, bet, coupleFuture, quote, features, type PriceModel, type Kind, type Street } from "./simulator"
import { DEPTHS, boardTexture } from "./study"
export const FRACTIONS=[0,.01,.025,.05,.1,.2,.4,.7,.9]
export interface ValueRow {id:string;group:string;seed:number;texture:string;depth:number;shape:string;available:boolean;fees:number[];normal:number[];super:number[];quoted:number[];x:number[]}
export interface ValueInput {variant:"standard52"|"short32";players:number;street:Street;index:number;model:PriceModel;fit:PolicyFit|undefined}
export function valueRow(input:ValueInput):ValueRow {
  const seed=seedOf(20261101,"current-fee-audit",input.variant,input.players,input.street,input.index)
  let shape=(["equal","short","deep","allin"] as const)[Math.floor(input.index/8)%4]
  if(input.players===2&&input.street!=="preflop"&&shape==="allin")shape="equal"
  const depth=DEPTHS[input.index%DEPTHS.length]
  const g=makeSnapshot({variant:input.variant,players:input.players,depth,shape,seed,bigBlind:2},input.street),o=observation(g),who=o.seat,bb=o.bigBlind
  const row:ValueRow={id:`current-fee-audit:${input.variant}:${input.players}:${input.street}:${input.index}`,group:`${input.variant}:${input.players}:${input.street}`,seed:g.config.seed,texture:boardTexture(o.board,o.variant),depth,shape,available:o.stack>=2,fees:[],normal:[],super:[],quoted:[quote(o,"normal",input.model)/bb,quote(o,"super",input.model)/bb],x:features(o).map(x=>x/bb)}
  if(!row.available)return row
  const profiles:Profile[]=["conservative","tight","loose","adaptive"],options={model:input.model,fit:input.fit,profiles,rollMode:"adaptive" as const,startCounts:[...g.counts]}
  const future=seedOf(g.config.seed,"fee-audit-future"),baseline=structuredClone(g)
  coupleFuture(baseline,future)
  bet(baseline,chooseBet(o,profiles[who%profiles.length],rng(seedOf(g.config.seed,"fee-audit-bet"))))
  const b=continueGame(baseline,options)
  const opportunities=rollOpportunities(o)
  for(const fraction of FRACTIONS){
    const fee=fraction===0?0:Math.max(1,Math.floor(o.stack*fraction))
    row.fees.push(fee/bb)
    for(const kind of ["normal","super"] as Kind[]){
      const branch=structuredClone(g),index=opportunities[kind].index
      roll(branch,kind,index,fee,rng(seedOf(g.config.seed,"fee-audit-candidate")),cs=>chooseCandidate(o,index,cs))
      coupleFuture(branch,future)
      const a=continueGame(branch,options)
      row[kind].push((a.ending[who]-b.ending[who])/bb)
    }
  }
  return row
}
export function summarizeValues(rows:ValueRow[]){
  const available=rows.filter(r=>r.available),groups:Record<string,unknown>={}
  for(const group of new Set(rows.map(r=>r.group))){
    const all=rows.filter(r=>r.group===group),a=all.filter(r=>r.available)
    const kinds:Record<string,unknown>={}
    for(const kind of ["normal","super"] as Kind[]){
      const curve=FRACTIONS.map((fraction,j)=>({fraction,meanFee:mean(a.map(r=>r.fees[j])),net:summarize(a.map(r=>r[kind][j]),normalQuantile(1-.05/(2*2*FRACTIONS.length)))}))
      const crossings=[]
      for(let j=0;j<curve.length-1;j++)if(curve[j].net.mean>0&&curve[j+1].net.mean<=0){
        const weight=curve[j].net.mean/(curve[j].net.mean-curve[j+1].net.mean)
        crossings.push({lowerFee:curve[j].meanFee,upperFee:curve[j+1].meanFee,interpolatedFee:curve[j].meanFee+weight*(curve[j+1].meanFee-curve[j].meanFee),confidenceCertified:curve[j].net.lower>0&&curve[j+1].net.upper<0})
      }
      kinds[kind]={curve,crossings,quotedMean:mean(a.map(r=>r.quoted[kind==="normal"?0:1])),nonmonotonePointMeans:curve.some((p,i)=>i>0&&p.net.mean>curve[i-1].net.mean),allNonpositive:curve.every(p=>p.net.mean<=0),rightCensored:curve.at(-1)!.net.mean>0}
    }
    groups[group]={n:all.length,available:a.length,...kinds}
  }
  return {rows:rows.length,available:available.length,fractions:FRACTIONS,groups,interpretation:"Only current fee varies; future pricing parameters held fixed, future quotes still respond to financial state. Per-cell normal intervals use Bonferroni over both tiers and nine fixed fee levels; interpolations are not exact roots. Forced randomized interventions include all negative outcomes. Break-even interpolations of group means are exploratory, not per-private-hand reservation prices; no monotonicity assumption or maximum-win pricing."}
}
