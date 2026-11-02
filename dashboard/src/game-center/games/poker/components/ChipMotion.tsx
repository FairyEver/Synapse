import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react"
import type { PokerChipValue } from "@synapse/shared/game-contracts"
import type { PresentedTransfer } from "../lib/chip-presentation"
import { useReducedMotion } from "../hooks/useReducedMotion"
import { PokerChip } from "./PokerChip"
type Point={x:number;y:number}
type Running={cancelled:boolean;complete:boolean;animations:Animation[];timer?:ReturnType<typeof setTimeout>;remaining:number}
function visibleChips(transfer:PresentedTransfer):PokerChipValue[] {
  const result:PokerChipValue[]=[]
  for(const entry of transfer.chips)for(let i=0;i<entry.count&&result.length<24;i++)result.push(entry.value)
  return result
}
/** Measure actual contained-scene anchors; completion comes from the animations, not a guessed gate. */
export function ChipMotion({transfers,layout,scope,onStart,onComplete}: {transfers:PresentedTransfer[];layout:string;scope:string;onStart:(id:string)=>void;onComplete:(id:string)=>void}) {
  const layer=useRef<HTMLDivElement>(null),running=useRef(new Map<string,Running>()),reduced=useReducedMotion()
  const callbacks=useRef({onStart,onComplete});callbacks.current={onStart,onComplete}
  const geometry=useRef(`${scope}:${layout}`)
  const cancel=(job:Running)=>{job.cancelled=true;job.animations.forEach(a=>a.cancel());if(job.timer)clearTimeout(job.timer)}
  const complete=(id:string,job:Running)=>{if(job.cancelled||job.complete||running.current.get(id)!==job)return;job.complete=true;callbacks.current.onComplete(id)}
  useLayoutEffect(()=>{
    const key=`${scope}:${layout}`
    if(geometry.current!==key){running.current.forEach(cancel);running.current.clear();geometry.current=key}
    const ids=new Set(transfers.map(t=>t.id))
    for(const [id,job] of running.current)if(!ids.has(id)){cancel(job);running.current.delete(id)}
    const root=layer.current?.parentElement
    if(!root)return
    const pending=transfers.flatMap((transfer,batch)=>{
      const existing=running.current.get(transfer.id)
      if(existing){
        if(reduced&&!existing.complete){existing.animations.forEach(a=>a.cancel());if(existing.timer)clearTimeout(existing.timer);queueMicrotask(()=>complete(transfer.id,existing))}
        return []
      }
      const elements=[...layer.current!.querySelectorAll<HTMLElement>(`[data-transfer-id="${CSS.escape(transfer.id)}"] .poker-flying-chip`)]
      const job:Running={cancelled:false,complete:false,animations:[],remaining:elements.length};running.current.set(transfer.id,job)
      return [{transfer,batch,elements,job}]
    })
    if(!pending.length)return
    const bounds=!reduced&&pending.some(p=>p.elements.length)?root.getBoundingClientRect():null
    const width=bounds?root.offsetWidth:0,scale=bounds&&width?bounds.width/width:1,points=new Map<string,Point|null>()
    const point=(selector:string):Point|null=>{
      if(!bounds)return null
      if(points.has(selector))return points.get(selector)!
      const rect=root.querySelector(selector)?.getBoundingClientRect()
      const value=rect?{x:(rect.x+rect.width/2-bounds.x)/scale,y:(rect.y+rect.height/2-bounds.y)/scale}:null
      points.set(selector,value)
      return value
    }
    // Snapshot every unique anchor before starting any animation or changing styles.
    const measured=pending.map(p=>({...p,center:point(`[data-chip-anchor="${p.transfer.fund}"]`),seat:point(`[data-seat="${p.transfer.seatNo}"] .poker-seat-bank`)}))
    measured.forEach(({transfer,batch,elements,job,center,seat})=>{
      callbacks.current.onStart(transfer.id)
      if(reduced||!center||!seat||!elements.length){queueMicrotask(()=>complete(transfer.id,job));return}
      const from=transfer.direction==="in"?seat:center,to=transfer.direction==="in"?center:seat
      let fallback=false
      elements.forEach((element,index)=>{
        const delay=Math.min(index,20)*28+Math.min(batch,6)*36
        const spread=(index%3-1)*2
        const transform=(x:number,y:number,scale=1)=>`translate(${x+spread}px,${y}px) translate(-50%,-50%) scale(${scale})`
        const frames=[{transform:transform(from.x,from.y,.8),opacity:1},{transform:transform(from.x+(to.x-from.x)*.55,from.y+(to.y-from.y)*.55-28,1.04),offset:.55,opacity:1},{transform:transform(to.x,to.y,.9),opacity:1}]
        if(typeof element.animate==="function")job.animations.push(element.animate(frames,{duration:620,delay,easing:"cubic-bezier(.22,.65,.3,1)",fill:"both"}))
        else {
          fallback=true;element.dataset.fallback="true"
          element.style.setProperty("--chip-from-x",`${from.x}px`);element.style.setProperty("--chip-from-y",`${from.y}px`)
          element.style.setProperty("--chip-to-x",`${to.x}px`);element.style.setProperty("--chip-to-y",`${to.y}px`);element.style.animationDelay=`${delay}ms`
        }
      })
      if(fallback)job.timer=setTimeout(()=>complete(transfer.id,job),620+Math.min(elements.length-1,20)*28+Math.min(batch,6)*36+120)
      else void Promise.allSettled(job.animations.map(a=>a.finished)).then(()=>complete(transfer.id,job))
    })
  },[transfers,layout,scope,reduced])
  useEffect(()=>()=>{running.current.forEach(cancel);running.current.clear()},[])
  return <div ref={layer} className="poker-chip-motion" aria-hidden="true">{transfers.map(transfer=><span key={transfer.id} className="poker-chip-transfer" data-motion={transfer.kind} data-fund={transfer.fund} data-transfer-id={transfer.id}>{visibleChips(transfer).map((value,index)=><span key={index} className="poker-flying-chip" style={{"--chip-turn":`${(index*13)%17-8}deg`} as CSSProperties} onAnimationEnd={event=>{if(event.target!==event.currentTarget)return;const job=running.current.get(transfer.id);if(job&&--job.remaining===0)complete(transfer.id,job)}}><PokerChip value={value}/></span>)}</span>)}</div>
}
