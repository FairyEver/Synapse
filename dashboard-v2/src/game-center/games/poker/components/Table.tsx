import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowLeft, Bell, Eye, ListOrdered, MoreHorizontal, UserRound, UsersRound, Volume2, VolumeX, X } from "lucide-react"
import type { PokerTableView, PokerTableEvent } from "@synapse/shared/game-contracts"
import { Button } from "@heroui/react"
import { Card } from "./Card"
import { Seat, EmptySeat } from "./Seat"
import { SidePanel } from "./SidePanel"
import { HumanControls, type PokerControlPanel } from "./HumanControls"
import { PokerMembersPanel } from "./PokerMembersPanel"
import { ChipMotion } from "./ChipMotion"
import { Settlement } from "./Settlement"
import { SettlementPanel } from "./SettlementPanel"
import { amount, projectTable, streetLabel } from "../lib/view"
import { TABLE_CONTROLS_BREAKPOINT } from "../lib/table-layout"
import { fitTableScene, tableSceneVariables } from "../lib/table-scene"
import { useTableMotion } from "../hooks/useTableMotion"
import { useDealAnimation } from "../hooks/useDealAnimation"
import { usePokerAudio } from "../hooks/usePokerAudio"
import "../styles/table-tokens.css"
import "../styles/responsive-controls.css"
import "../styles/adaptive-table.css"
const NO_EVENTS: PokerTableEvent[] = []
export function Table({ table, perspective, onPerspective, onNudge, onBack, onRefresh = () => {}, events = NO_EVENTS, members, identityKey }: {
  table: PokerTableView
  perspective: "owner" | "public"
  onPerspective: (v: "owner" | "public") => void
  onNudge?: (seatNo: number) => void
  onBack: () => void
  onRefresh?: () => void | Promise<void>
  events?: PokerTableEvent[]
  animate?: PokerTableEvent[]
  identityKey?: string
  members?: ReactNode
}) {
  const [panel, setPanel] = useState<PokerControlPanel | "log" | "members" | null>(null), [fit, setFit] = useState(fitTableScene(1440,900))
  const [compact, setCompact] = useState(false)
  const panelOpen = panel === "log"
  const surface = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null), menuTrigger = useRef<HTMLButtonElement>(null), logTrigger = useRef<HTMLButtonElement>(null)
  const membersTrigger = useRef<HTMLButtonElement>(null)
  const panelId = useId(), menuId = useId()
  const [soundEnabled, setSoundEnabled] = useState(true)
  usePokerAudio(table, perspective, identityKey ?? "", soundEnabled)
  const controlVersion = table.controlVersion ?? table.seats.find(seat => seat.seatNo === table.mySeatNo)?.controlVersion
  useEffect(() => { setPanel(current => current === "bet" ? null : current) }, [table.handId, table.actionSeq, controlVersion, perspective, table.actionOnSeat, table.status])
  useEffect(() => { setPanel(null) }, [compact])
  useEffect(() => { if (table.status === "closed") setPanel(null) }, [table.status])
  const view = projectTable(table, perspective)
  const motion = useTableMotion(table, `${identityKey}:${perspective}:${table.controlVersion}:${fit.scene.mode}:${fit.scale}`)
  const dealt = useDealAnimation(table.handId, table.seats.length + table.board.length, 0, table)
  useLayoutEffect(() => {
    const element = viewport.current, container = surface.current
    if (!element || !container || typeof ResizeObserver === "undefined") return
    let frame: number | undefined, width: number | undefined, height = 0, containerWidth: number | undefined
    const apply = () => {
      frame = undefined
      if (containerWidth !== undefined) setCompact(containerWidth <= TABLE_CONTROLS_BREAKPOINT)
      if (width !== undefined) {
        const next = fitTableScene(width, height)
        setFit(previous => previous.scale === next.scale && previous.scene.mode === next.scene.mode ? previous : next)
      }
    }
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === container) containerWidth = entry.contentRect.width
        if (entry.target === element) {
          width = entry.contentRect.width
          height = entry.contentRect.height
        }
      }
      if (frame === undefined) frame = requestAnimationFrame(apply)
    })
    observer.observe(container)
    observer.observe(element)
    return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame) }
  }, [])
  const slots = Array.from({ length: view.maxSeats }, (_, seatNo) => ({ seatNo, index: view.seats.findIndex(s => s.seatNo === seatNo), seat: view.seats.find(s => s.seatNo === seatNo) }))
  const active = view.status === "closed" ? undefined : view.seats.find(s => s.seatNo === view.actionOnSeat)
  const canNudge = onNudge && perspective === "owner" && view.mySeatNo !== null && active && active.seatNo !== view.mySeatNo && active.participantKind !== "bot"
  const stage = view.status === "closed" ? "房间已解散" : streetLabel[view.street ?? ""] ?? (view.status === "paused" ? "等待对手" : "等待开局")
  return <section ref={surface} onKeyDown={e => { if (e.key === "Escape" && panel === "log") { setPanel(null); logTrigger.current?.focus() } }} className="poker-table poker-immersive" data-control-layout="bottom" data-entry-controls={view.mySeatNo === null || view.status !== "running"} data-compact-controls={compact} data-panel-open={panelOpen} aria-label={`牌桌 ${table.roomCode}`}>
    <div className="poker-table-layout">
        <div className="poker-edge-controls bg-surface font-sans text-foreground scheme-light">
          <Button type="button" variant="tertiary" isIconOnly={compact} aria-label="返回房间" onPress={onBack}><ArrowLeft aria-hidden="true" />{!compact && "返回房间"}</Button>
          <span className="poker-room-summary text-sm"><strong>#{table.roomCode}</strong><span className="text-muted">第 {table.handNo} 手{table.mode === "practice" && " · 陪练"}</span></span>
          <div className="poker-perspective flex items-center gap-2">
            {members && view.status !== "closed" && <Button ref={membersTrigger} type="button" variant="tertiary" isIconOnly={compact} aria-label="成员管理" aria-expanded={panel === "members"} onPress={() => setPanel(panel === "members" ? null : "members")}><UsersRound aria-hidden="true" />{!compact && "成员"}</Button>}
            <SettlementPanel table={view} perspective={perspective} identityKey={identityKey} onRefresh={onRefresh} onOpen={() => setPanel(null)} compact={compact} />
            <Button ref={logTrigger} type="button" variant="tertiary" isIconOnly={compact} aria-label={panelOpen ? "收起日志" : "日志"} aria-expanded={panelOpen} aria-controls={panelId} onPress={() => setPanel(panelOpen ? null : "log")}><ListOrdered aria-hidden="true" />{!compact && (panelOpen ? "收起日志" : "日志")}</Button>
            {view.status !== "closed" && <Button ref={menuTrigger} type="button" variant="tertiary" isIconOnly aria-label="更多牌桌操作" aria-expanded={panel === "menu"} aria-controls={menuId} onPress={() => setPanel(panel === "menu" ? null : "menu")}><MoreHorizontal aria-hidden="true" /></Button>}
          </div>
        </div>
      <div className="poker-table-main">
        {view.settlement && <div className="poker-results-anchor"><Settlement settlement={view.settlement} /></div>}
        <div className="poker-canvas-viewport" ref={viewport}>
          <div className="poker-canvas" data-table-shape={fit.scene.mode} data-compact={fit.scale<0.65} style={{ ...tableSceneVariables(fit.scene), "--poker-scale":fit.scale || 1, width:fit.scene.width, height:fit.scene.height, transform:`translate(-50%, -50%) scale(${fit.scale})` } as CSSProperties}>
            <div className="poker-rail" aria-hidden="true"><div className="poker-felt" /></div>
            <div className="poker-table-content">
              <div className="poker-center">
                <div className="poker-pot-row"><div className="poker-deck" aria-label={`剩余 ${view.deckRemaining} 张`}><span className="poker-deck-stack" data-card-size="xs"><Card faceUp={false} /></span><span>{view.deckRemaining}<small>张</small></span></div><div className="poker-pot-value"><span className="poker-pot-label">底池</span><strong className="poker-pot">{amount(view.pot)}</strong></div></div>
                <div className="poker-board" data-card-size="md">{Array.from({length:5},(_,i) => <span key={i} className="poker-deal-slot" data-dealt={dealt >= view.seats.length+i+1 || !view.board[i]}><Card card={view.board[i]} faceUp={!view.board[i] || dealt >= view.seats.length+i+1} /></span>)}</div>
                <div className="poker-board-caption"><span className="poker-street">{stage}</span><span className="poker-rules-caption"><span>{view.variant === "short32" ? "短牌 32 张" : "标准 52 张"}</span><span>盲注 <b>{view.smallBlind ?? 1} / {view.bigBlind ?? 2}</b></span></span></div>
                {view.status === "paused" && view.pauseReason && <p className="poker-pause-reason">{({user:"牌局已暂停",all_humans_away:"真人均已暂离",no_human:"等待本人或 AI 入座",insufficient_players:"等待对手",insufficient_chips:"等待有筹码的玩家"} as Record<string,string>)[view.pauseReason] ?? "等待可参与的玩家"}</p>}
              </div>
              {slots.map(({seatNo,seat,index}) => seat ? <Seat key={seatNo} seat={seat} showWager={view.street !== "settled"} departed={seat.isMe && view.mySeatNo === null} result={view.settlement} feedback={motion.actions.filter(a=>a.seatNo===seatNo).at(-1)} feedbackKey={motion.id} turnPulse={motion.turn === seatNo} celebrate={motion.celebrate.includes(seatNo)} maxSeats={view.maxSeats} origin={view.mySeatNo ?? 0} acting={view.status === "running" && seat.inCurrentHand !== false && seat.seatNo === view.actionOnSeat} deadlineMs={view.deadlineMs} dealer={seatNo === view.dealerSeat} dealt={dealt > index} hasStarted={!!view.handId} /> : <EmptySeat key={seatNo} seatNo={seatNo} maxSeats={view.maxSeats} origin={view.mySeatNo ?? 0} />)}
              <ChipMotion transfers={motion.transfers} layout={`${fit.scene.mode}:${fit.scale}`} />
            </div>
          </div>
        </div>
      </div>
      <div className="poker-interaction-rail">
        <div className="poker-information-slot">
          <div className="poker-information-drawer bg-surface font-sans text-foreground scheme-light" hidden={!panelOpen} inert={!panelOpen}>
            <Button type="button" isIconOnly size="sm" variant="tertiary" className="poker-close-log" aria-label="关闭日志" onPress={() => { setPanel(null); logTrigger.current?.focus() }}><X aria-hidden="true" /></Button>
            <SidePanel id={panelId} table={view} perspective={perspective} events={events} />
          </div>
        </div>
        <PokerMembersPanel open={panel === "members"} onOpenChange={open => setPanel(open ? "members" : null)} compact={compact} trigger={membersTrigger} container={surface.current}>{members}</PokerMembersPanel>
        <div className="poker-controls-anchor"><HumanControls identityKey={identityKey} table={view} perspective={perspective} onPerspective={onPerspective} onRefresh={onRefresh} compact={compact} activePanel={panel === "log" || panel === "members" ? null : panel} onPanelChange={setPanel} menuTrigger={menuTrigger} menuId={menuId} popoverContainer={surface.current} menuContent={<>
            <Button fullWidth type="button" variant="tertiary" aria-label={soundEnabled ? "关闭音效" : "开启音效"} aria-pressed={soundEnabled} onPress={() => setSoundEnabled(v => !v)}>{soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}音效</Button>
            {canNudge && <Button fullWidth variant="tertiary" isDisabled={(view.deadlineMs ?? 600000) > 540000} onPress={() => { onNudge(active.seatNo); setPanel(null) }}><Bell aria-hidden="true" />提醒玩家</Button>}
            {table.seats.some(s => s.isMe) && <Button fullWidth variant="tertiary" aria-label={perspective === "owner" ? "切换旁观视角" : "切换玩家视角"} onPress={() => { onPerspective(perspective === "owner" ? "public" : "owner"); setPanel(null) }}>{perspective === "owner" ? <UserRound aria-hidden="true" /> : <Eye aria-hidden="true" />}{perspective === "owner" ? "旁观视角" : "玩家视角"}</Button>}
          </>} /></div>
      </div>
    </div>
  </section>
}
