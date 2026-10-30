import { useId, useState } from "react"
import { ArrowLeft, Eye, ListOrdered, RotateCcw, UserRound } from "lucide-react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { Seat, EmptySeat } from "./Seat"
import { SidePanel } from "./SidePanel"
import { StatusBar } from "./StatusBar"
import { amount, projectTable, streetLabel } from "../lib/view"
import { useDealAnimation } from "../hooks/useDealAnimation"
import "../styles/table-tokens.css"
export function Table({
  table,
  perspective,
  onPerspective,
  onNudge,
  onBack,
}: {
  table: PokerTableView
  perspective: "owner" | "public"
  onPerspective: (v: "owner" | "public") => void
  onNudge: (seatNo: number) => void
  onBack: () => void
}) {
  const [replay, setReplay] = useState(0),
    [panelOpen, setPanelOpen] = useState(false)
  const panelId = useId()
  const view = projectTable(table, perspective),
    dealt = useDealAnimation(table.handId, table.seats.length + table.board.length, replay)
  const slots = Array.from({ length: view.maxSeats }, (_, seatNo) => ({
    seatNo,
    index: view.seats.findIndex((s) => s.seatNo === seatNo),
    seat: view.seats.find((s) => s.seatNo === seatNo),
  }))
  const stage =
    streetLabel[view.street ?? ""] ?? (view.status === "paused" ? "等待对手" : "等待开局")
  return (
    <section
      className="poker-table"
      data-panel-open={panelOpen}
      aria-label={`牌桌 ${table.roomCode}`}
    >
      <div className="poker-table-toolbar">
        <button type="button" className="poker-control poker-back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          返回房间
        </button>
        <div className="poker-room-heading">
          <strong>#{table.roomCode}</strong>
          <span>第 {table.handNo} 手</span>
        </div>
        <div className="poker-perspective">
          <button
            type="button"
            className="poker-control poker-log-toggle"
            aria-expanded={panelOpen}
            aria-controls={panelId}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <ListOrdered aria-hidden="true" />
            {panelOpen ? "收起日志" : "日志"}
          </button>
          <div className="poker-view-switch" role="group" aria-label="观看视角">
            {table.seats.some((s) => s.isMe) && (
              <button
                type="button"
                className="poker-control"
                aria-pressed={perspective === "owner"}
                onClick={() => onPerspective("owner")}
              >
                <UserRound aria-hidden="true" />
                玩家视角
              </button>
            )}
            <button
              type="button"
              className="poker-control"
              aria-pressed={perspective === "public"}
              onClick={() => onPerspective("public")}
            >
              <Eye aria-hidden="true" />
              旁观视角
            </button>
          </div>
          <button
            type="button"
            className="poker-control poker-replay"
            aria-label="重放发牌"
            onClick={() => setReplay((n) => n + 1)}
          >
            <RotateCcw aria-hidden="true" />
            <span>重放发牌</span>
          </button>
        </div>
      </div>
      <div className="poker-table-layout">
        <div className="poker-table-main">
          <div className="poker-arena">
            <div className="poker-rail">
              <div className="poker-felt">
                <div className="poker-center">
                  <div className="poker-pot-row">
                    <div className="poker-deck" aria-label={`剩余 ${view.deckRemaining} 张`}>
                      <span className="poker-deck-stack" data-card-size="xs">
                        <Card faceUp={false} />
                      </span>
                      <span>
                        {view.deckRemaining}
                        <small>张</small>
                      </span>
                    </div>
                    <div className="poker-pot-value">
                      <span className="poker-pot-label">底池</span>
                      <strong className="poker-pot">{amount(view.pot)}</strong>
                    </div>
                  </div>
                  <div className="poker-board" data-card-size="md">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className="poker-deal-slot"
                        data-dealt={dealt >= view.seats.length + i + 1 || !view.board[i]}
                      >
                        <Card
                          card={view.board[i]}
                          faceUp={!view.board[i] || dealt >= view.seats.length + i + 1}
                        />
                      </span>
                    ))}
                  </div>
                  <div className="poker-board-caption">
                    <span className="poker-street">{stage}</span>
                    <span>
                      盲注 <b>1 / 2</b>
                    </span>
                  </div>
                </div>
                {slots.map(({ seatNo, seat, index }) =>
                  seat ? (
                    <Seat
                      key={seatNo}
                      seat={seat}
                      maxSeats={view.maxSeats}
                      acting={perspective === "owner" && seat.seatNo === view.actionOnSeat}
                      deadlineMs={view.deadlineMs}
                      dealer={seat.seatNo === view.dealerSeat}
                      dealt={dealt > index}
                    />
                  ) : (
                    <EmptySeat key={seatNo} seatNo={seatNo} maxSeats={view.maxSeats} />
                  ),
                )}
              </div>
            </div>
          </div>
          <StatusBar table={view} perspective={perspective} onNudge={onNudge} />
        </div>
        <SidePanel id={panelId} table={view} perspective={perspective} />
      </div>
    </section>
  )
}
