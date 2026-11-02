import { GameQueryFeedback } from "../../../components/GameQueryFeedback"
import type { PokerSummaryView } from "@synapse/shared/game-contracts"
import { gameApi } from "../../../lib/api"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { Card } from "./Card"
import { amount } from "../lib/view"
export function PokerHandPreview({ hand }: { hand: PokerSummaryView }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex shrink-0 gap-1" data-card-size="sm">
        {hand.hole.map((card, i) => (
          <Card key={i} card={card} />
        ))}
      </div>
      <div className="min-w-0 flex-1 basis-32">
        <p className="text-xs text-muted">最近点数牌局</p>
        <p className="mt-1 text-xs text-muted">
          #{hand.roomCode} · 第 {hand.handNo} 手
        </p>
      </div>
      <span className="max-w-full break-all text-sm font-medium tabular-nums">
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
  return (
    <>
      <GameQueryFeedback query={history} />
      {last ? (
        <PokerHandPreview hand={last} />
      ) : (
        !history.error && (
          <p className="text-sm text-muted">
            {history.data ? "暂无点数牌局记录" : "正在读取记录…"}
          </p>
        )
      )}
    </>
  )
}
