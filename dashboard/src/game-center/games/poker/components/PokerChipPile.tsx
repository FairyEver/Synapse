import { useMemo, type CSSProperties } from "react"
import { chipValue, layoutChipPile, type PokerChipCount } from "@synapse/shared/game-contracts"
import { amount } from "../lib/view"
import { PokerChip } from "./PokerChip"
export function PokerChipPile({chips,label,seed=0,fund,className=""}: {chips:PokerChipCount[];label:string;seed?:number;fund?:"pot"|"roll";className?:string}) {
  const layout=useMemo(()=>layoutChipPile(chips,seed),[chips,seed])
  return <div className={`poker-chip-pile ${className}`} data-fund={fund} role="img" aria-label={`${label} ${amount(chipValue(chips))}`}>
    <span className="poker-chip-anchor" data-chip-anchor={fund} aria-hidden="true" />
    {layout.chips.map(chip=><span key={chip.id} className="poker-placed-chip" data-chip-stack={chip.stack} data-chip-level={chip.level} style={{"--chip-x":chip.x,"--chip-y":chip.y,"--chip-turn":`${chip.rotation}deg`,zIndex:chip.depth} as CSSProperties}><PokerChip value={chip.value} /></span>)}
    {layout.overflow.length>0&&<span className="poker-chip-overflow" aria-hidden="true">{layout.overflow.map(c=>`${c.value} × ${amount(c.count)}`).join(" · ")}</span>}
  </div>
}
