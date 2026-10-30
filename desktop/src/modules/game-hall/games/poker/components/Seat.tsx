import { Coins } from "lucide-react"
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
    seat.participantKind === "bot" ? "机器人" : seat.aiState === "online" ? "在线" : seat.aiState === "offline" ? "掉线" : "暂离"
  const progress = 100 - Math.min(100, Math.max(0, deadlineMs ?? 0) / 6000)
  return (
    <div
      className="poker-seat"
      role="group"
      data-position={seatPosition(seat.seatNo, maxSeats)}
      data-acting={acting}
      data-folded={seat.status === "folded"}
      data-mine={seat.isMe}
      aria-label={`座位 ${seat.seatNo + 1} · ${seat.displayName}`}
    >
      <div className="poker-seat-cards" data-card-size="sm" data-dealt={dealt}>
        <Card card={seat.hole?.[0]} faceUp={!!seat.hole && dealt} />
        <Card card={seat.hole?.[1]} faceUp={!!seat.hole && dealt} />
      </div>
      <div className="poker-seat-plate">
        <span className="poker-seat-avatar" aria-hidden={!acting}>
          {seat.seatNo + 1}
          {acting && (
            <svg className="poker-turn-ring" viewBox="0 0 40 40" aria-label="行动剩余时间">
              <circle className="poker-turn-track" cx="20" cy="20" r="18" />
              <circle
                cx="20"
                cy="20"
                r="18"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={progress}
              />
            </svg>
          )}
        </span>
        <span className="poker-seat-identity">
          <span className="poker-seat-name" title={seat.displayName}>
            {seat.displayName}
          </span>
          <span className="poker-stack">{amount(seat.stack)}</span>
        </span>
        {dealer && (
          <span className="poker-dealer" role="img" aria-label="按钮位">
            D
          </span>
        )}
      </div>
      <div className="poker-seat-meta">
        <span className="poker-ai-state" data-acting={acting && seat.aiState === "online"}>
          <span className="poker-ai-dot" data-state={seat.aiState} />
          {acting && seat.aiState === "online" ? "行动中" : stateLabel}
        </span>
        {seat.streetBet > 0 && (
          <span className="poker-seat-bet">
            <Coins aria-hidden="true" />
            {amount(seat.streetBet)}
          </span>
        )}
        {seat.status === "folded" && <span>弃牌</span>}
      </div>
    </div>
  )
}
export function EmptySeat({ seatNo, maxSeats }: { seatNo: number; maxSeats: number }) {
  return (
    <div
      className="poker-seat poker-seat-empty"
      role="group"
      data-position={seatPosition(seatNo, maxSeats)}
      aria-label={`座位 ${seatNo + 1} · 空位`}
    >
      <span className="poker-empty-marker" aria-hidden="true">
        {seatNo + 1}
      </span>
      <span>空位</span>
    </div>
  )
}
