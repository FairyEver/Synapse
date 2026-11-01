import { summarize, mean } from "./math"
import type { Coefficients, PriceModel, Kind } from "./simulator"
import type { PolicyFit } from "./policies"
export interface Row {
  id:string;group:string;split:string;seed:number;variant:string;players:number;street:string;depth:number;shape:string;profile:string
  x:[number,number,number];history:[number,number];count:number;proxy:[number,number]
  normal:number;super:number;voluntary:number;normalFee:number;superFee:number;paid:number;totalPaid:number;received:number;chosenKind:Kind|null;futureRolls:number
  texture:string;rolls:number;normalRolls:number;superRolls:number;ending:number;baseline:number;chosen:boolean;allinOpponents:number;folded:number;sidePots:number;refundPots:number
}
export function fitNonnegative(x:readonly number[][],y:readonly number[]):number[] {
  if(!x.length)return [0,0,0]
  const dims=x[0].length,scales=Array.from({length:dims},(_,j)=>Math.sqrt(mean(x.map(r=>r[j]*r[j])))||1)
  const a=x.map(r=>r.map((v,j)=>v/scales[j])),b=Array(dims).fill(0),pred=Array(y.length).fill(0)
  for(let iteration=0;iteration<80;iteration++)for(let j=0;j<dims;j++){
    let numerator=0,denominator=1e-6
    for(let i=0;i<y.length;i++){numerator+=a[i][j]*(y[i]-pred[i]+a[i][j]*b[j]);denominator+=a[i][j]**2}
    const updated=Math.max(0,numerator/denominator),delta=updated-b[j]
    for(let i=0;i<y.length;i++)pred[i]+=a[i][j]*delta
    b[j]=updated
  }
  return b.map((v,j)=>v/scales[j])
}
export function fitModels(rows:Row[]):{price:PriceModel;policy:PolicyFit} {
  const cells:Record<string,Coefficients>={},privateCells:Record<string,Coefficients>={}
  const fit=(data:Row[],privateFit:boolean):Coefficients=>Object.fromEntries((["normal","super"] as Kind[]).map((kind,j)=>{
    const available=data.filter(r=>Number.isFinite(r[kind])&&(privateFit||r.count===0))
    return [kind,fitNonnegative(available.map(r=>r.x.map(v=>v*(privateFit?r.proxy[j]:1))),available.map(r=>r[kind]+(r.split==="train"?0:r[kind==="normal"?"normalFee":"superFee"])))]
  })) as Coefficients
  const fallback=fit(rows,false),privateFallback=fit(rows,true)
  for(const key of new Set(rows.map(r=>r.group))){const data=rows.filter(r=>r.group===key);cells[key]=fit(data,false);privateCells[key]=fit(data,true)}
  return {price:{scale:1,curve:"linear",growth:.5,coefficients:fallback,cells,history:{normal:0,super:0}},policy:{cells:privateCells,fallback:privateFallback}}
}
export function evaluateRows(rows:Row[]):unknown {
  return {count:rows.length,normal:summarize(rows.map(r=>r.normal)),super:summarize(rows.map(r=>r.super)),voluntary:summarize(rows.map(r=>r.voluntary)),paid:mean(rows.map(r=>r.paid)),chosen:rows.filter(r=>r.chosen).length}
}

export function fixedSample<T extends {id:string}>(rows:readonly T[],perGroup:number):T[] {return rows.filter(r=>Number(r.id.slice(r.id.lastIndexOf(":")+1))<perGroup)}
