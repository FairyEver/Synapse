import type { ComponentProps, CSSProperties, PointerEvent } from "react"
import type { PokerCardDefinitionView } from "@synapse/shared/game-contracts"
import { Diamond, Layers3 } from "lucide-react"
import { cardArtwork } from "../lib/card-artwork"

type Props = Omit<ComponentProps<"button">, "children"> & { definition?: PokerCardDefinitionView; caption?: string; cost?: string; interactive?: boolean }
function tilt(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const box = event.currentTarget.getBoundingClientRect()
  event.currentTarget.style.setProperty("--tilt-x", `${(0.5 - (event.clientY - box.top) / box.height) * 5}deg`)
  event.currentTarget.style.setProperty("--tilt-y", `${((event.clientX - box.left) / box.width - 0.5) * 7}deg`)
}
/** One local card face for held cards, materials, candidates and private observations. */
export function PokerAbilityCard({ definition, caption, cost, interactive = true, className = "", ...button }: Props) {
  const face = <>
    <span className="card-type"><Layers3 aria-hidden="true" />{caption ?? "能力牌"}</span>
    {definition && <img className="ability-art" src={cardArtwork(definition.id)} alt="" width={1122} height={1402} loading="lazy" draggable={false} />}
    <span className="card-body"><strong className="card-name">{definition?.name ?? caption ?? "卡牌"}</strong><span className="card-divider" aria-hidden="true"><Diamond /></span>
      {definition && <span className="card-description">{definition.description}</span>}{cost && <span className="card-cost">{cost}</span>}
    </span>
  </>
  if (!interactive) return <div className={`ability-card ${className}`}>{face}</div>
  return <button {...button} type="button" className={`ability-card ${className}`} onPointerMove={tilt} onPointerLeave={event => {
    event.currentTarget.style.removeProperty("--tilt-x"); event.currentTarget.style.removeProperty("--tilt-y")
  }}>{face}</button>
}
export function cardFanStyle(index: number, count: number): CSSProperties {
  const offset = index - (count - 1) / 2
  return { "--rest-r": `${offset * 2.4}deg`, "--rest-y": `${Math.abs(offset) * 8}px`, "--deal-i": index } as CSSProperties
}
