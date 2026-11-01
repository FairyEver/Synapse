export function rng(seed: number): () => number {
  let value = seed >>> 0
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
}
export function seedOf(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const c of parts.join(":")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}
export function choose(n: number, k: number): number {
  if (k < 0 || n < k) return 0
  let a = 1
  for (let i = 1; i <= k; i++) a *= (n - i + 1) / i
  return a
}
export function repeatedTargetProbability(deck: number, players: number, targets: number, normal: number, superRoll: number): number {
  const U = deck - 2, L = deck - 2 * players
  let result = 0
  for (let s = 0; s <= targets; s++) {
    const weight = choose(targets,s) * choose(U-targets,L-s) / choose(U,L)
    result += weight * (1 - (1-s/L)**normal * (choose(L-s,3)/choose(L,3))**superRoll)
  }
  return result
}
export type Summary = {n:number;mean:number;sd:number;halfWidth:number;lower:number;upper:number}
export function summarize(values: readonly number[],z=1.96): Summary {
  const n = values.length
  if (!n) return {n:0,mean:0,sd:0,halfWidth:Infinity,lower:-Infinity,upper:Infinity}
  const mean = values.reduce((a,b)=>a+b,0)/n
  const sd = n>1 ? Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(n-1)) : Infinity
  const halfWidth = z*sd/Math.sqrt(n)
  return {n,mean,sd,halfWidth,lower:mean-halfWidth,upper:mean+halfWidth}
}
export function percentile(values: readonly number[], q: number): number {
  if (!values.length) return 0
  const a = [...values].sort((x,y)=>x-y)
  return a[Math.min(a.length-1,Math.floor(q*(a.length-1)))]
}
export function mean(values: readonly number[]): number { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0 }

export function bootstrapMean(values:readonly number[],seed:number,repetitions=400):{lower:number;upper:number;repetitions:number} {
  if(!values.length)return {lower:-Infinity,upper:Infinity,repetitions}
  const random=rng(seed),estimates:number[]=[]
  for(let r=0;r<repetitions;r++){let sum=0;for(let i=0;i<values.length;i++)sum+=values[Math.floor(random()*values.length)];estimates.push(sum/values.length)}
  return {lower:percentile(estimates,.025),upper:percentile(estimates,.975),repetitions}
}

export function appendBatches<T>(first:T[],batches:T[][]):T[] { return first.concat(...batches) }

/** Acklam rational inverse-normal approximation; verified against independent NormalDist values. */
export function normalQuantile(p:number):number {
  if(p<=0||p>=1)throw new Error("Normal quantile requires 0<p<1")
  const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239]
  const b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572]
  const c=[-.007784894002430293,-.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783]
  const d=[.007784695709041462,.3224671290700398,2.445134137142996,3.754408661907416]
  const poly=(coefficients:number[],x:number)=>coefficients.reduce((s,v)=>s*x+v,0)
  if(p<.02425){const q=Math.sqrt(-2*Math.log(p));return poly(c,q)/(poly(d,q)*q+1)}
  if(p>1-.02425){const q=Math.sqrt(-2*Math.log1p(-p));return -poly(c,q)/(poly(d,q)*q+1)}
  const q=p-.5,r=q*q
  return poly(a,r)*q/(poly(b,r)*r+1)
}
export function stratifiedBootstrap(rows:readonly {group:string;voluntary:number;chosen:boolean;chosenKind:string|null}[],seed:number,repetitions=400){
  const random=rng(seed),groups=new Map<string,typeof rows[number][]>()
  for(const row of rows){if(!groups.has(row.group))groups.set(row.group,[]);groups.get(row.group)!.push(row)}
  const samples={all:[] as number[],chosen:[] as number[],normal:[] as number[],super:[] as number[]}
  for(let rep=0;rep<repetitions;rep++){
    let all=0,chosen=0,normal=0,superRoll=0,nChosen=0,nNormal=0,nSuper=0
    for(const group of groups.values())for(let i=0;i<group.length;i++){
      const row=group[Math.floor(random()*group.length)];all+=row.voluntary
      if(row.chosen){chosen+=row.voluntary;nChosen++}
      if(row.chosenKind==="normal"){normal+=row.voluntary;nNormal++}
      if(row.chosenKind==="super"){superRoll+=row.voluntary;nSuper++}
    }
    samples.all.push(all/rows.length);samples.chosen.push(nChosen?chosen/nChosen:-Infinity)
    samples.normal.push(nNormal?normal/nNormal:-Infinity);samples.super.push(nSuper?superRoll/nSuper:-Infinity)
  }
  const interval=(a:number[])=>({lower:percentile(a,.025),upper:percentile(a,.975),repetitions})
  return {all:interval(samples.all),chosen:interval(samples.chosen),byKind:{normal:interval(samples.normal),super:interval(samples.super)}}
}
