import { useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { amount } from "../lib/view"
import type { ChipTransfer } from "../lib/table-motion"
type Point = { x: number; y: number }
type Flight = ChipTransfer & { from: Point; to: Point }
/** Measure real anchors in felt coordinates; canvas scaling and seat rotation stay aligned. */
export function ChipMotion({transfers,layout}: {transfers:ChipTransfer[];layout:string}) {
  const layer=useRef<HTMLDivElement>(null), [flights,setFlights]=useState<Flight[]>([])
  useLayoutEffect(()=>{
    const root=layer.current?.parentElement
    if (!root) return
    const bounds=root.getBoundingClientRect(), scale=bounds.width/root.offsetWidth || 1
    const point=(selector:string):Point=>{
      const rect=root.querySelector(selector)?.getBoundingClientRect()
      return rect ? {x:(rect.x+rect.width/2-bounds.x)/scale,y:(rect.y+rect.height/2-bounds.y)/scale} : {x:0,y:0}
    }
    const pot=point(".poker-pot")
    setFlights(transfers.map(t=>{
      const seat=point(`[data-seat="${t.seatNo}"] .poker-seat-plate`), bet=point(`.poker-wager[data-seat="${t.seatNo}"]`)
      return {...t,from:t.kind === "bet" ? seat : t.kind === "collect" ? bet : pot,to:t.kind === "bet" ? bet : t.kind === "collect" ? pot : seat}
    }))
  },[transfers,layout])
  return <div ref={layer} className="poker-chip-motion" aria-hidden="true">{flights.map(t=><span key={t.id} className="poker-chip-transfer" data-motion={t.kind} style={{"--chip-from-x":`${t.from.x}px`,"--chip-from-y":`${t.from.y}px`,"--chip-to-x":`${t.to.x}px`,"--chip-to-y":`${t.to.y}px`,animationDelay:`${t.delay}ms`} as CSSProperties}>{amount(t.amount)}</span>)}</div>
}
