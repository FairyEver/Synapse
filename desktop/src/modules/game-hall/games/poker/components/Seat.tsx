import type { PokerSeatView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { amount, seatPosition } from "../lib/view"
export function Seat({
  seat,
  maxSeats,
  acting,
  dealer,
  dealt,
  deadlineMs,
}: {
  seat: PokerSeatView
  maxSeats: number
  acting: boolean
  dealer: boolean
  dealt: boolean
  deadlineMs: number | null
}) {
  const stateLabel =
    seat.aiState === "online" ? "在线" : seat.aiState === "offline" ? "掉线" : "暂离"
  return (
    <div
      className="poker-seat"
      data-position={seatPosition(seat.seatNo, maxSeats)}
      data-acting={acting}
      data-folded={seat.status === "folded"}
    >
      <div className="poker-seat-cards" data-card-size="sm" data-dealt={dealt}>
        <Card card={seat.hole?.[0]} faceUp={!!seat.hole} />
        <Card card={seat.hole?.[1]} faceUp={!!seat.hole} />
      </div>
      <div className="poker-seat-plate">
        {acting && (
          <svg className="poker-turn-ring" viewBox="0 0 24 24" aria-label="行动剩余时间">
            <circle
              cx="12"
              cy="12"
              r="10"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - Math.max(0, deadlineMs ?? 0) / 6000}
            />
          </svg>
        )}
        <span className="poker-ai-dot" data-state={seat.aiState} />
        <span className="truncate">{seat.displayName}</span>
        {dealer && (
          <span className="poker-dealer" aria-label="按钮位">
            D
          </span>
        )}
        <span className="poker-stack">{amount(seat.stack)}</span>
      </div>
      <div className="poker-seat-meta">
        {stateLabel}
        {seat.streetBet > 0 && <span> · 下注 {amount(seat.streetBet)}</span>}
      </div>
    </div>
  )
}
