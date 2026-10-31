import "../styles/lobby.css"
import { Card } from "./Card"
/** Decorative game identity; never represents a live hand. */
export function PokerArtwork() {
  return (
    <span className="gc-poker-art">
      <span className="gc-art-orbit" />
      <span className="gc-art-orbit gc-art-orbit-inner" />
      <span className="gc-art-hand">
        <Card card="Qs" />
        <Card card="Kh" />
        <Card card="As" />
      </span>
      <span className="gc-art-chip gc-art-chip-back" />
      <span className="gc-art-chip" />
    </span>
  )
}
