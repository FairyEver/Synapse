import { Bell, Eye, Timer } from "lucide-react"
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
  const active = table.seats.find((s) => s.seatNo === table.actionOnSeat),
    mine = active?.seatNo === table.mySeatNo
  const watching = perspective === "public" || table.mySeatNo === null
  const text = watching
    ? "旁观中"
    : !active
      ? "等待对手"
      : mine
        ? active.aiState === "offline"
          ? "你的 AI 已掉线"
          : "你的 AI 正在行动"
        : `等待 ${active.displayName} 的 AI`
  const offline = mine && active?.aiState === "offline"
  const countdown = !active || watching ? null : remaining(table.deadlineMs)
  return (
    <div className="poker-status" role="status">
      <span className="poker-status-message">
        <span className="poker-status-symbol" data-watching={watching} aria-hidden="true">
          <Eye />
          <span
            className="poker-status-dot"
            data-offline={!active || active.aiState === "offline"}
          />
        </span>
        <span>{text}</span>
      </span>
      <div className="poker-status-actions">
        {countdown && (
          <span className="poker-countdown" data-offline={offline}>
            <Timer aria-hidden="true" />
            {offline ? (
              <>
                <strong>{countdown}</strong>
                <span>后弃牌离桌</span>
              </>
            ) : (
              <>
                <span>还剩</span>
                <strong>{countdown}</strong>
              </>
            )}
          </span>
        )}
        {active && !mine && !watching && (
          <button
            type="button"
            className="poker-control"
            onClick={() => onNudge(active.seatNo)}
            disabled={(table.deadlineMs ?? 600000) > 540000}
          >
            <Bell aria-hidden="true" />
            提醒他
          </button>
        )}
      </div>
    </div>
  )
}
