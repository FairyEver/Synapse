import "../styles/table-tokens.css"
const suits: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" }
/** The only playing-card DOM, shared by table, hall preview and records. */
export function Card({ card, faceUp = true }: { card?: string; faceUp?: boolean }) {
  if (!card && faceUp) return <span className="poker-card-placeholder" aria-label="未发牌" />
  const rank = card?.[0] === "T" ? "10" : (card?.[0] ?? ""),
    suit = suits[card?.[1] ?? ""] ?? ""
  return (
    <span
      className="poker-card"
      data-card={faceUp ? card : undefined}
      data-face={faceUp ? "up" : "down"}
      data-red={faceUp && (card?.[1] === "h" || card?.[1] === "d")}
      role="img"
      aria-label={faceUp ? `${rank}${suit}` : "牌背"}
    >
      <span className="poker-card-turn">
        <span className="poker-card-front" aria-hidden="true">
          <span className="poker-card-corner">
            {rank}
            <br />
            {suit}
          </span>
          <span className="poker-card-suit">{suit}</span>
        </span>
        <span className="poker-card-back" aria-hidden="true">
          <span>♠</span>
        </span>
      </span>
    </span>
  )
}
