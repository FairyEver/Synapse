import type { PokerSummaryView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { Card } from "./Card"
import { amount } from "../lib/view"
export function PokerHandPreview({ hand }: { hand: PokerSummaryView }) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex gap-1" data-card-size="sm">
        {hand.hole.map((card, i) => (
          <Card key={i} card={card} />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">最近一手</p>
        <p className="mt-1 text-xs text-muted-foreground">
          #{hand.roomCode} · 第 {hand.handNo} 手
        </p>
      </div>
      <span className="text-sm font-medium tabular-nums">
        {hand.delta > 0 ? "+" : ""}
        {amount(hand.delta)}
      </span>
    </div>
  )
}
export function PokerPreview() {
  const history = useGameQuery(
    () => gameApi().poker.hand.history({ limit: 1 }),
    "poker:preview",
    10000,
  )
  const last = history.data?.items[0]
  return last ? <PokerHandPreview hand={last} /> : null
}
