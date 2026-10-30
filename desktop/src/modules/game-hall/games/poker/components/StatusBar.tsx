import type { PokerTableView } from "@synapse/shared/game-contracts"
import { remaining } from "../lib/view"
export function StatusBar({
  table,
  perspective,
  onNudge,
}: {
  table: PokerTableView
  perspective: "owner" | "public"
  onNudge: (seatNo: number) => void
}) {
  const active = table.seats.find((s) => s.seatNo === table.actionOnSeat)
  const mine = active?.seatNo === table.mySeatNo
  const text =
    perspective === "public" || table.mySeatNo === null
      ? "旁观中"
      : !active
        ? "等待对手"
        : mine
          ? active.aiState === "offline"
            ? "你的 AI 已掉线"
            : "你的 AI 正在行动"
          : `等待 ${active.displayName} 的 AI`
  const countdown =
    !active || perspective === "public"
      ? ""
      : mine && active.aiState === "offline"
        ? ` · ${remaining(table.deadlineMs)} 后弃牌离桌`
        : ` · 还剩 ${remaining(table.deadlineMs)}`
  return (
    <div className="poker-status" role="status">
      <span>
        {text}
        {countdown}
      </span>
      {active && !mine && perspective === "owner" && table.mySeatNo !== null && (
        <button
          type="button"
          className="poker-control"
          onClick={() => onNudge(active.seatNo)}
          disabled={(table.deadlineMs ?? 600000) > 540000}
        >
          提醒他
        </button>
      )}
    </div>
  )
}
