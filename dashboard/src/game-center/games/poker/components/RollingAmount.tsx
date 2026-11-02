import { useEffect, useLayoutEffect, useRef } from "react"
import { amount } from "../lib/view"
import { useReducedMotion } from "../hooks/useReducedMotion"
type Wheel={node:HTMLSpanElement;track:HTMLSpanElement;digit:number;animation:Animation|null}
const transform=(position:number)=>`translateY(calc(${-position} * 1.15em))`
export function reelDestination(position:number,digit:number,direction:number) {
  const start=10+((position%10)+10)%10
  return {start,end:start+direction*((direction*(digit-start%10)+10)%10)}
}
export function RollingAmount({value,scope,className="",onAnimating}: {value:number;scope:string;className?:string;onAnimating?:(active:boolean)=>void}) {
  const reduced=useReducedMotion(),nodes=useRef(new Map<number,HTMLSpanElement>()),wheels=useRef(new Map<number,Wheel>())
  const before=useRef<{value:number;scope:string}|null>(null),notify=useRef(onAnimating)
  notify.current=onAnimating
  const moving=()=>{notify.current?.([...wheels.current.values()].some(w=>!!w.animation))}
  useLayoutEffect(()=>{
    const previous=before.current,animate=!!previous&&previous.scope===scope&&!reduced
    const direction=previous&&value<previous.value?-1:1,used=new Set<number>()
    const digits=String(value)
    for(let index=0;index<digits.length;index++) {
      const place=digits.length-index-1,digit=Number(digits[index]),node=nodes.current.get(place)!
      used.add(place)
      let wheel=wheels.current.get(place)
      if(!wheel||wheel.node!==node){wheel?.animation?.cancel();wheel={node,track:node.firstElementChild as HTMLSpanElement,digit:0,animation:null};wheels.current.set(place,wheel)}
      if(!animate||typeof wheel.track.animate!=="function") {
        wheel.animation?.cancel();wheel.animation=null;wheel.digit=digit;wheel.track.style.transform=transform(10+digit);continue
      }
      if(wheel.digit===digit)continue
      const height=node.getBoundingClientRect().height
      const position=wheel.animation&&height>0&&typeof DOMMatrixReadOnly!=="undefined"?-new DOMMatrixReadOnly(getComputedStyle(wheel.track).transform).m42/height:10+wheel.digit
      const {start,end}=reelDestination(position,digit,direction)
      wheel.animation?.cancel();wheel.digit=digit;wheel.track.style.transform=transform(start)
      const animation=wheel.track.animate([{transform:transform(start)},{transform:transform(end)}],{duration:440,easing:"cubic-bezier(.2,.65,.25,1)",fill:"both"})
      wheel.animation=animation
      const current=wheel
      animation.onfinish=()=>{if(current.animation!==animation)return;current.track.style.transform=transform(10+digit);current.animation=null;animation.cancel();moving()}
    }
    for(const [place,wheel] of wheels.current)if(!used.has(place)){wheel.animation?.cancel();wheels.current.delete(place);nodes.current.delete(place)}
    before.current={value,scope};moving()
  },[value,scope,reduced])
  useEffect(()=>()=>{for(const wheel of wheels.current.values())wheel.animation?.cancel();wheels.current.clear()},[])
  let place=String(value).length-1
  return <strong className={`poker-rolling-amount ${className}`} data-value={value}><span className="sr-only">{amount(value)}</span><span className="poker-number-reels" aria-hidden="true">{[...amount(value)].map((character,index)=>{
    if(character===",")return <span className="poker-number-comma" key={`comma-${index}`} />
    const slot=place--
    return <span key={`digit-${slot}`} className="poker-number-digit" data-digit={character} ref={node=>{if(node)nodes.current.set(slot,node)}}><span className="poker-number-track" /></span>
  })}</span></strong>
}
