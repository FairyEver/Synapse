/// <reference types="vite/client" />
import "../styles/table-tokens.css"
const suits: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" }
const faces = import.meta.glob<string>("../assets/cards/*.svg", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
})
/** The only playing-card DOM, shared by table, hall preview and records. */
export function Card({ card, faceUp = true }: { card?: string; faceUp?: boolean }) {
  const visibleCard = faceUp ? card : undefined
  const artwork = visibleCard ? faces[`../assets/cards/${visibleCard}.svg`] : undefined
  if (faceUp && !artwork) return <span className="poker-card-placeholder" aria-label="未发牌" />
  const rank = visibleCard?.[0] === "T" ? "10" : (visibleCard?.[0] ?? ""),
    suit = suits[visibleCard?.[1] ?? ""] ?? ""
  return (
    <span
      className="poker-card"
      data-card={visibleCard}
      data-face={faceUp ? "up" : "down"}
      data-red={faceUp && (card?.[1] === "h" || card?.[1] === "d")}
      role="img"
      aria-label={faceUp ? `${rank}${suit}` : "牌背"}
    >
      <span className="poker-card-turn">
        <span className="poker-card-front" aria-hidden="true">
          {artwork && <img src={artwork} alt="" width={240} height={336} draggable={false} />}
        </span>
        <span className="poker-card-back" aria-hidden="true">
          <span>♠</span>
        </span>
      </span>
    </span>
  )
}
