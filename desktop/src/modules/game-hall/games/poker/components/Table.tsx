import { useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { Seat } from "./Seat"
import { SidePanel } from "./SidePanel"
import { StatusBar } from "./StatusBar"
import { amount, projectTable } from "../lib/view"
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
  const [replay, setReplay] = useState(0)
  const view = projectTable(table, perspective),
    dealt = useDealAnimation(table.handId, table.seats.length + table.board.length, replay)
  return (
    <section className="poker-table" aria-label={`牌桌 ${table.roomCode}`}>
      <div className="poker-table-toolbar">
        <button type="button" className="poker-control" onClick={onBack}>
          返回房间
        </button>
        <span>
          #{table.roomCode} · 第 {table.handNo} 手
        </span>
        <div className="poker-perspective">
          {table.seats.some((s) => s.isMe) && (
            <button
              type="button"
              className="poker-control"
              aria-pressed={perspective === "owner"}
              onClick={() => onPerspective("owner")}
            >
              玩家视角
            </button>
          )}
          <button
            type="button"
            className="poker-control"
            aria-pressed={perspective === "public"}
            onClick={() => onPerspective("public")}
          >
            旁观视角
          </button>
          <button type="button" className="poker-control" onClick={() => setReplay((n) => n + 1)}>
            重放发牌
          </button>
        </div>
      </div>
      <div className="poker-table-layout">
        <div className="poker-table-main">
          <div className="poker-rail">
            <div className="poker-felt">
              <div className="poker-deck" aria-label={`剩余 ${view.deckRemaining} 张`}>
                <span className="poker-mini-back">♠</span>
                <span>{view.deckRemaining} 张</span>
              </div>
              <div className="poker-center">
                <span className="poker-pot-label">底池</span>
                <strong className="poker-pot">{amount(view.pot)}</strong>
                <div className="poker-board" data-card-size="md">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span
                      key={i}
                      className="poker-deal-slot"
                      data-dealt={dealt >= view.seats.length + i + 1 || !view.board[i]}
                    >
                      <Card card={view.board[i]} />
                    </span>
                  ))}
                </div>
                <span className="poker-street">{view.street ?? "等待开局"} · 盲注 1 / 2</span>
              </div>
              {view.seats.map((seat, i) => (
                <Seat
                  key={seat.seatNo}
                  seat={seat}
                  maxSeats={view.maxSeats}
                  acting={perspective === "owner" && seat.seatNo === view.actionOnSeat}
                  deadlineMs={view.deadlineMs}
                  dealer={seat.seatNo === view.dealerSeat}
                  dealt={dealt > i}
                />
              ))}
            </div>
          </div>
          <StatusBar table={view} perspective={perspective} onNudge={onNudge} />
        </div>
        <SidePanel table={view} perspective={perspective} />
      </div>
    </section>
  )
}
