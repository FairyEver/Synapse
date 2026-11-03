import type { ReactNode } from "react"
import { cardArtwork } from "../lib/card-artwork"
import "../styles/ability-details.css"

type Face = { name: string; artId: string }

export function PokerAbilityFace({ name, artId, size, children }: Face & { size: "sm" | "lg"; children?: ReactNode }) {
  return <span className="poker-ability-face" data-ability-size={size}>
    <img src={cardArtwork(artId)} alt="" draggable={false} />
    <strong className="poker-ability-face-name">{name}</strong>
    {children}
  </span>
}

export function PokerAbilityDetails({ name, artId, description, children }: Face & { description?: string; children?: ReactNode }) {
  return <div className="poker-ability-details">
    <PokerAbilityFace name={name} artId={artId} size="lg" />
    <div className="poker-ability-details-text">
      <strong>{name}</strong>
      {description && <p>{description}</p>}
      {children}
    </div>
  </div>
}
