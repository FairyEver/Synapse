import type { PokerTableView } from "@synapse/shared/game-contracts"
import { waitingForPlayers } from "./room-entry"

export function betPaymentPreview(table: PokerTableView, nominalAmount: number) {
  const nominal = Number.isSafeInteger(nominalAmount) && nominalAmount > 0 ? nominalAmount : 0
  const waivedAmount = Math.min(nominal, Math.max(0, table.betWaiverCap ?? 0))
  return { nominalAmount: nominal, waivedAmount, paidAmount: nominal - waivedAmount }
}

export function actionState(table: PokerTableView, acting: boolean, handoff: boolean | undefined) {
  const mine = table.seats.find(seat => seat.seatNo === table.mySeatNo)
  const active = table.seats.find(seat => seat.seatNo === table.actionOnSeat)
  if (table.status === "closed") return "房间已解散"
  if (!mine) return handoff ? "等待 AI 入座" : "选择你的入座方式"
  if (mine.status === "sitting_out") return "已暂离"
  if (table.awaitingReady) return mine.readyForNextHand ? "已准备 · 等待其他玩家" : "本手结束 · 请确认准备下一手"
  if (table.street === "settled") return "本手结束"
  const waiting = waitingForPlayers(table)
  if (waiting) return waiting
  if (mine.status === "waiting") return "已入座 · 下一手加入"
  if (acting) return "轮到你"
  if (mine.status === "folded") return "已弃牌 · 等待下一手"
  if (mine.status === "allin") return "已全下 · 等待摊牌"
  if (handoff) return "等待 AI 接入 · 本人仍可出牌"
  if ((table.controller ?? mine.controller) !== "human") return "AI 操作"
  return active ? `等待 ${active.displayName} 行动` : "等待开局"
}

export function betPresets(table: PokerTableView) {
  const mine = table.seats.find(seat => seat.seatNo === table.mySeatNo)
  const callTo = (mine?.streetBet ?? 0) + (table.toCall ?? 0)
  const clamp = (value: number) => Math.min(table.maxRaiseTo ?? 0, Math.max(table.minRaiseTo ?? 0, Math.round(value)))
  return [
    { label: "最小", to: table.minRaiseTo ?? 0 },
    { label: "半池", to: clamp(callTo + (table.pot + (table.toCall ?? 0)) / 2) },
    { label: "一池", to: clamp(callTo + table.pot + (table.toCall ?? 0)) },
  ]
}
