import { gameApi } from "../../../lib/api"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { Card } from "./Card"
export function PokerPreview() {
  const history = useGameQuery(
    () => gameApi().poker.hand.history({ limit: 1 }),
    "poker:preview",
    10000,
  )
  const last = history.data?.items[0]
  return last ? (
    <div className="flex items-center gap-2" data-card-size="xs">
      <span className="text-sm text-muted-foreground">最近一手</span>
      {last.hole.map((card, i) => (
        <Card key={i} card={card} />
      ))}
      <span className="tabular-nums">
        {last.delta > 0 ? "+" : ""}
        {last.delta}
      </span>
    </div>
  ) : null
}
