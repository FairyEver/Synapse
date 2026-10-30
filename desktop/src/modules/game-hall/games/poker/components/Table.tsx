import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, Bell, Eye, ListOrdered, UserRound, X } from "lucide-react"
import type { PokerTableView, PokerTableEvent } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { Seat, EmptySeat } from "./Seat"
import { SidePanel } from "./SidePanel"
import { HumanControls } from "./HumanControls"
import { ChipMotion } from "./ChipMotion"
import { Settlement } from "./Settlement"
import { amount, projectTable, streetLabel } from "../lib/view"
import { canvasFit, TABLE_WIDTH, TABLE_HEIGHT } from "../lib/table-layout"
import { useDealAnimation } from "../hooks/useDealAnimation"
import "../styles/table-tokens.css"
const NO_EVENTS: PokerTableEvent[] = []
export function Table({ table, perspective, onPerspective, onNudge, onBack, onRefresh = () => {}, events = NO_EVENTS, animate = NO_EVENTS, extras, identityKey }: {
  table: PokerTableView
  perspective: "owner" | "public"
  onPerspective: (v: "owner" | "public") => void
  onNudge?: (seatNo: number) => void
  onBack: () => void
  onRefresh?: () => void | Promise<void>
  events?: PokerTableEvent[]
  animate?: PokerTableEvent[]
  identityKey?: string
  extras?: ReactNode
}) {
  const [panelOpen, setPanelOpen] = useState(false), [fit, setFit] = useState(canvasFit(1440,900))
  const [pulses, setPulses] = useState<PokerTableEvent[]>([])
  const viewport = useRef<HTMLDivElement>(null), panelId = useId()
  const view = projectTable(table, perspective)
  const dealt = useDealAnimation(table.handId, table.seats.length + table.board.length, 0)
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => setFit(canvasFit(entry.contentRect.width, entry.contentRect.height)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setPulses(animate.filter(e => e.handId === table.handId))
    const timer = setTimeout(() => setPulses([]), 1600)
    return () => clearTimeout(timer)
  }, [animate, table.handId])
  const slots = Array.from({ length: view.maxSeats }, (_, seatNo) => ({ seatNo, index: view.seats.findIndex(s => s.seatNo === seatNo), seat: view.seats.find(s => s.seatNo === seatNo) }))
  const active = view.status === "closed" ? undefined : view.seats.find(s => s.seatNo === view.actionOnSeat)
  const canNudge = onNudge && perspective === "owner" && view.mySeatNo !== null && active && active.seatNo !== view.mySeatNo && active.participantKind !== "bot"
  const stage = view.status === "closed" ? "房间已解散" : streetLabel[view.street ?? ""] ?? (view.status === "paused" ? "等待对手" : "等待开局")
  return <section onKeyDown={e => { if (e.key === "Escape") setPanelOpen(false) }} className="poker-table poker-immersive" data-panel-open={panelOpen} aria-label={`牌桌 ${table.roomCode}`}>
    <div className="poker-table-layout">
      <div className="poker-table-main">
        <div className="poker-edge-controls">
          <button type="button" className="poker-control poker-back" onClick={onBack}><ArrowLeft aria-hidden="true" />返回房间</button>
          <span className="poker-room-heading"><strong>#{table.roomCode}</strong><span>第 {table.handNo} 手</span>{table.mode === "practice" && <span>陪练</span>}</span>
          <div className="poker-perspective">
            {canNudge && <button type="button" className="poker-control" disabled={(view.deadlineMs ?? 600000) > 540000} onClick={() => onNudge(active.seatNo)}><Bell aria-hidden="true" />提醒玩家</button>}
            {table.seats.some(s => s.isMe) && <button type="button" className="poker-control" aria-label={perspective === "owner" ? "切换旁观视角" : "切换玩家视角"} onClick={() => onPerspective(perspective === "owner" ? "public" : "owner")}>{perspective === "owner" ? <UserRound aria-hidden="true" /> : <Eye aria-hidden="true" />}{perspective === "owner" ? "玩家视角" : "旁观视角"}</button>}
            <button type="button" className="poker-control poker-log-toggle" aria-expanded={panelOpen} aria-controls={panelId} onClick={() => setPanelOpen(v => !v)}><ListOrdered aria-hidden="true" />{panelOpen ? "收起日志" : "日志"}</button>
          </div>
        </div>
        <div className="poker-canvas-viewport" ref={viewport}>
          <div className="poker-canvas" style={{ width:TABLE_WIDTH, height:TABLE_HEIGHT, transform:`translate(-50%, -50%) scale(${fit.scale})` }}>
            <div className="poker-rail"><div className="poker-felt">
              <div className="poker-center">
                <div className="poker-pot-row"><div className="poker-deck" aria-label={`剩余 ${view.deckRemaining} 张`}><span className="poker-deck-stack" data-card-size="xs"><Card faceUp={false} /></span><span>{view.deckRemaining}<small>张</small></span></div><div className="poker-pot-value"><span className="poker-pot-label">底池</span><strong className="poker-pot">{amount(view.pot)}</strong></div></div>
                <div className="poker-board" data-card-size="md">{Array.from({length:5},(_,i) => <span key={i} className="poker-deal-slot" data-dealt={dealt >= view.seats.length+i+1 || !view.board[i]}><Card card={view.board[i]} faceUp={!view.board[i] || dealt >= view.seats.length+i+1} /></span>)}</div>
                <div className="poker-board-caption"><span className="poker-street">{stage}</span><span>{view.variant === "short32" ? "短牌 32 张" : "标准 52 张"} · 盲注 <b>{view.smallBlind ?? 1} / {view.bigBlind ?? 2}</b></span></div>
                {view.status === "paused" && view.pauseReason && <p className="poker-pause-reason">{({user:"牌局已暂停",all_humans_away:"真人均已暂离",no_human:"等待本人或 AI 入座",insufficient_players:"等待对手",insufficient_chips:"等待有筹码的玩家"} as Record<string,string>)[view.pauseReason] ?? "等待可参与的玩家"}</p>}
              </div>
              {slots.map(({seatNo,seat,index}) => seat ? <Seat key={seatNo} seat={seat} maxSeats={view.maxSeats} origin={view.mySeatNo ?? 0} acting={view.status !== "closed" && seat.seatNo === view.actionOnSeat} deadlineMs={view.deadlineMs} dealer={seatNo === view.dealerSeat} dealt={dealt > index} /> : <EmptySeat key={seatNo} seatNo={seatNo} maxSeats={view.maxSeats} origin={view.mySeatNo ?? 0} />)}
              <ChipMotion history={events} events={pulses} table={view} />
            </div></div>
            {view.settlement && <Settlement settlement={view.settlement} />}
          </div>
        </div>
        <div className="poker-controls-anchor"><HumanControls identityKey={identityKey} table={view} perspective={perspective} onRefresh={onRefresh} /></div>
      </div>
      <div className="poker-log-drawer">
        <button type="button" className="poker-control poker-close-log" aria-label="关闭日志" onClick={() => setPanelOpen(false)}><X aria-hidden="true" /></button>
        <SidePanel id={panelId} table={view} perspective={perspective} events={events} extras={extras} />
      </div>
    </div>
  </section>
}
