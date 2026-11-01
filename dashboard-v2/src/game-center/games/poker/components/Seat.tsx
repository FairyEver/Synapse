import type { PokerSeatView, PokerSettlementView, PokerTableView } from "@synapse/shared/game-contracts"
import { Coins } from "lucide-react"
import { Card } from "./Card"
import { actionLabel, amount, seatPosition } from "../lib/view"
export function Seat({
  seat,
  maxSeats,
  origin = 0,
  acting,
  showWager = true,
  dealer,
  dealt,
  deadlineMs, result, feedback, feedbackKey, turnPulse, celebrate, departed,
}: {
  showWager?: boolean
  departed?: boolean
  result?: PokerSettlementView | null
  feedback?: PokerTableView["recentActions"][number]
  feedbackKey?: string
  turnPulse?: boolean
  celebrate?: boolean
  seat: PokerSeatView
  maxSeats: number
  origin?: number
  acting: boolean
  dealer: boolean
  dealt: boolean
  deadlineMs: number | null
}) {
  const won = seat.inCurrentHand !== false && !!result?.pots.some(p=>!p.refund && p.winners.includes(seat.seatNo))
  const wonChips = result?.pots.filter(p=>!p.refund).reduce((sum,p)=>sum+(p.shares[seat.seatNo] ?? 0),0) ?? 0
  const returned = result?.pots.filter(p=>p.refund).reduce((sum,p)=>sum+(p.shares[seat.seatNo] ?? 0),0) ?? 0
  const outcome = result?.seats.find(s=>s.seatNo===seat.seatNo)
  const waiting = seat.inCurrentHand === false && !seat.isHistorical && !departed
  const stateLabel =
    departed || seat.status === "left" ? "已离桌" : seat.participantKind === "bot" ? "机器人" : seat.handoffPending ? "等待 AI" : seat.controller === "human" ? seat.isMe ? "本人操作" : "真人操作" : seat.controller === "ai" ? "AI 操作" : seat.aiState === "online" ? "在线" : seat.aiState === "offline" ? "掉线" : "暂离"
  const progress = 100 - Math.min(100, Math.max(0, deadlineMs ?? 0) / 6000)
  return (
    <div
      className="poker-seat"
      role="group"
      data-seat={seat.seatNo}
      data-winner={won}
      data-celebrate={celebrate}
      data-position={seatPosition(seat.seatNo, maxSeats, origin)}
      data-acting={acting}
      data-folded={seat.status === "folded"}
      data-mine={seat.isMe}
      aria-label={`座位 ${seat.seatNo + 1} · ${seat.displayName}`}
    >
      {!waiting && <div className="poker-seat-cards" data-card-size={seat.status === "folded" ? "xs" : "sm"} data-dealt={dealt} data-visible-hole={!!seat.hole}>
        <Card card={seat.hole?.[0]} faceUp={!!seat.hole && dealt} />
        <Card card={seat.hole?.[1]} faceUp={!!seat.hole && dealt} />
      </div>}
      <div className="poker-seat-plate" data-turn-pulse={turnPulse}>
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
            {seat.isMe ? "你" : seat.displayName}
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
        {won && outcome ? <span className="poker-seat-result" title={`赢得 ${amount(wonChips)}${returned > 0 ? `，返还 ${amount(returned)}` : ""}，净变化 ${amount(outcome.delta)}`} aria-label={`赢得 ${amount(wonChips)}，净变化 ${amount(outcome.delta)}`}><strong>净 {outcome.delta > 0 ? "+" : ""}{amount(outcome.delta)}</strong></span>
          : seat.status === "folded" && !departed ? <strong className="poker-folded-label">已弃牌</strong>
          : feedback && !acting && !waiting && !departed ? <span key={feedbackKey} className="poker-action-receipt">{actionLabel[feedback.action]}{feedback.amount > 0 && ` +${amount(feedback.amount)}`}</span>
          : <span className="poker-ai-state" data-acting={acting}>
            {seat.status === "sitting_out" ? "已暂离" : waiting ? "下一手加入" : acting ? seat.isMe && seat.controller === "human" ? "轮到你" : "行动中" : seat.status === "allin" ? "已全下" : stateLabel}
          </span>}
        <span className="poker-wager" data-seat={seat.seatNo} data-visible={showWager && seat.streetBet > 0} aria-label={`${seat.isMe ? "你" : seat.displayName} 本轮下注 ${amount(seat.streetBet)}`}><Coins aria-hidden="true" /><span title={amount(seat.streetBet)}>{amount(seat.streetBet)}</span></span>
      </div>
    </div>
  )
}
export function EmptySeat({ seatNo, maxSeats, origin = 0 }: { seatNo: number; maxSeats: number; origin?: number }) {
  return (
    <div
      className="poker-seat poker-seat-empty"
      role="group"
      data-position={seatPosition(seatNo, maxSeats, origin)}
      aria-label={`座位 ${seatNo + 1} · 空位`}
    >
      <span className="poker-empty-marker" aria-hidden="true">
        {seatNo + 1}
      </span>
      <span>空位</span>
    </div>
  )
}
