import { memo } from "react"
import type { PokerChipValue } from "@synapse/shared/game-contracts"
// One shared compound path retains the eight edge marks without eight SVG nodes per chip.
const edgePath=Array.from({length:8},(_,i)=>{
  const angle=i*Math.PI/4,c=Math.cos(angle),s=Math.sin(angle)
  return [[28,3],[36,3],[35,12],[29,12]].map(([x,y],index)=>`${index?"L":"M"}${(32+(x-32)*c-(y-32)*s).toFixed(3)} ${(32+(x-32)*s+(y-32)*c).toFixed(3)}`).join("")+"Z"
}).join("")
export const PokerChip=memo(function PokerChip({value}: {value:PokerChipValue}) {
  return <span className="poker-chip" data-chip-value={value} aria-hidden="true"><svg viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="31" className="poker-chip-disc" />
    <path d={edgePath} className="poker-chip-edge" />
    <circle cx="32" cy="32" r="23" className="poker-chip-ring" /><circle cx="32" cy="32" r="20" className="poker-chip-dots" />
    <text x="32" y="33" textAnchor="middle" dominantBaseline="middle">{value}</text>
  </svg></span>
})
