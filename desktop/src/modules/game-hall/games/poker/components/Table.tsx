import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, Bell, Eye, ListOrdered, MoreHorizontal, UserRound, Volume2, VolumeX, X } from "lucide-react"
import type { PokerTableView, PokerTableEvent } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { Seat, EmptySeat } from "./Seat"
import { SidePanel } from "./SidePanel"
import { HumanControls, type PokerControlPanel } from "./HumanControls"
import { ChipMotion } from "./ChipMotion"
import { Settlement } from "./Settlement"
import { amount, projectTable, streetLabel } from "../lib/view"
import { canvasFit, TABLE_CONTROLS_BREAKPOINT, TABLE_WIDTH, TABLE_HEIGHT } from "../lib/table-layout"
import { useDealAnimation } from "../hooks/useDealAnimation"
import { usePokerAudio } from "../hooks/usePokerAudio"
import "../styles/table-tokens.css"
import "../styles/responsive-controls.css"
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
  const [panel, setPanel] = useState<PokerControlPanel | "log" | null>(null), [fit, setFit] = useState(canvasFit(1440,900))
  const [compact, setCompact] = useState(false)
  const panelOpen = panel === "log"
  const surface = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null), menuTrigger = useRef<HTMLButtonElement>(null), logTrigger = useRef<HTMLButtonElement>(null)
  const panelId = useId(), menuId = useId()
  const [pulses, setPulses] = useState<PokerTableEvent[]>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  usePokerAudio(table, perspective, identityKey ?? "", soundEnabled)
  const controlVersion = table.controlVersion ?? table.seats.find(seat => seat.seatNo === table.mySeatNo)?.controlVersion
  useEffect(() => { setPanel(current => current === "bet" ? null : current) }, [table.handId, table.actionSeq, controlVersion, perspective, table.actionOnSeat, table.status])
  useEffect(() => { setPanel(null) }, [compact])
  const view = projectTable(table, perspective)
  const dealt = useDealAnimation(table.handId, table.seats.length + table.board.length, 0)
  useLayoutEffect(() => {
    const element = viewport.current, container = surface.current
    if (!element || !container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === container) setCompact(entry.contentRect.width <= TABLE_CONTROLS_BREAKPOINT)
        if (entry.target === element) {
          const next = canvasFit(entry.contentRect.width, entry.contentRect.height)
          setFit(previous => previous.scale === next.scale ? previous : next)
        }
      }
    })
    observer.observe(container)
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
  return <section ref={surface} onKeyDown={e => { if (e.key === "Escape" && panel === "log") { setPanel(null); logTrigger.current?.focus() } }} className="poker-table poker-immersive" data-control-layout={compact ? "bottom" : "right"} data-panel-open={panelOpen} aria-label={`牌桌 ${table.roomCode}`}>
    <div className="poker-table-layout">
        <div className="poker-edge-controls">
          <button type="button" className="poker-control poker-back" onClick={onBack}><ArrowLeft aria-hidden="true" />返回房间</button>
          <span className="poker-room-heading"><strong>#{table.roomCode}</strong><span>第 {table.handNo} 手</span>{table.mode === "practice" && <span>陪练</span>}</span>
          <div className="poker-perspective">
            <button type="button" className="poker-control" aria-label={soundEnabled ? "关闭音效" : "开启音效"} aria-pressed={soundEnabled} onClick={() => setSoundEnabled(v => !v)}>{soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}音效</button>
            {canNudge && <button type="button" className="poker-control" disabled={(view.deadlineMs ?? 600000) > 540000} onClick={() => onNudge(active.seatNo)}><Bell aria-hidden="true" />提醒玩家</button>}
            {table.seats.some(s => s.isMe) && <button type="button" className="poker-control" aria-label={perspective === "owner" ? "切换旁观视角" : "切换玩家视角"} onClick={() => onPerspective(perspective === "owner" ? "public" : "owner")}>{perspective === "owner" ? <UserRound aria-hidden="true" /> : <Eye aria-hidden="true" />}{perspective === "owner" ? "玩家视角" : "旁观视角"}</button>}
            <button ref={logTrigger} type="button" className="poker-control poker-log-toggle" aria-expanded={panelOpen} aria-controls={panelId} onClick={() => setPanel(panelOpen ? null : "log")}><ListOrdered aria-hidden="true" />{panelOpen ? "收起日志" : "日志"}</button>
            {compact && view.status !== "closed" && <button ref={menuTrigger} type="button" className="poker-control" aria-label="更多牌桌操作" aria-expanded={panel === "menu"} aria-controls={menuId} onClick={() => setPanel(panel === "menu" ? null : "menu")}><MoreHorizontal aria-hidden="true" /></button>}
          </div>
        </div>
      <div className="poker-table-main">
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
      </div>
      <div className="poker-interaction-rail">
        <div className="poker-information-slot">
          <div className="poker-information-drawer" hidden={!panelOpen} inert={!panelOpen}>
            <button type="button" className="poker-control poker-close-log" aria-label="关闭日志" onClick={() => { setPanel(null); logTrigger.current?.focus() }}><X aria-hidden="true" /></button>
            <SidePanel id={panelId} table={view} perspective={perspective} events={events} extras={extras} />
          </div>
        </div>
        <div className="poker-controls-anchor"><HumanControls identityKey={identityKey} table={view} perspective={perspective} onRefresh={onRefresh} compact={compact} activePanel={panel === "log" ? null : panel} onPanelChange={setPanel} menuTrigger={menuTrigger} menuId={menuId} popoverContainer={surface.current} /></div>
      </div>
    </div>
  </section>
}
