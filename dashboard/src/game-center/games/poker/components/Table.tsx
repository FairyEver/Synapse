import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowLeft, Bell, Eye, MoreHorizontal, UserRound, UsersRound, Volume2, VolumeX } from "lucide-react"
import { chipValue, type PokerTableView, type PokerTableEvent, type PokerResolutionFrameView } from "@synapse/shared/game-contracts"
import { Button } from "@heroui/react"
import { Card } from "./Card"
import { Seat, EmptySeat } from "./Seat"
import { PokerLogRail } from "./PokerLogRail"
import { usesPokerHandDock } from "../lib/card-mode"
import { hasPokerPlayControls } from "../lib/action-view"
import { PokerMatchOverviewDialog } from "./PokerMatchOverviewDialog"
import { HumanControls, type PokerControlPanel } from "./HumanControls"
import { PokerMembersPanel } from "./PokerMembersPanel"
import { ChipMotion } from "./ChipMotion"
import { PokerChipPile } from "./PokerChipPile"
import { RollingAmount } from "./RollingAmount"
import { Settlement } from "./Settlement"
import { SettlementPanel } from "./SettlementPanel"
import { HandRankDialog } from "./HandRankDialog"
import { PokerPlayerInfoDialog } from "./PokerPlayerInfoDialog"
import { PokerReserveDialog } from "./PokerReserveDialog"
import { PokerPotSourcesDialog } from "./PokerPotSourcesDialog"
import { PokerCardFeedback } from "./PokerCardFeedback"
import { projectTable, streetLabel } from "../lib/view"
import { TABLE_CONTROLS_BREAKPOINT } from "../lib/table-layout"
import { fitTableScene, tableSceneVariables } from "../lib/table-scene"
import { useTableMotion } from "../hooks/useTableMotion"
import { useDealAnimation } from "../hooks/useDealAnimation"
import { usePokerCardMotion } from "../hooks/usePokerCardMotion"
import { PokerCardMotion, PokerMotionDecks } from "./PokerCardMotion"
import { usePokerAudio } from "../hooks/usePokerAudio"
import { usePokerReady } from "../hooks/usePokerReady"
import { usePokerChips } from "../hooks/usePokerChips"
import "../styles/table-tokens.css"
import "../styles/responsive-controls.css"
import "../styles/adaptive-table.css"
import "../styles/chips.css"
const NO_EVENTS: PokerTableEvent[] = []
const NO_FRAMES: PokerResolutionFrameView[] = []
export function Table({ table, perspective, onPerspective, onNudge, onBack, onRefresh = () => {}, events = NO_EVENTS, animateFrames = NO_FRAMES, cardFrames = NO_FRAMES, members, identityKey }: {
  table: PokerTableView
  perspective: "owner" | "public"
  onPerspective: (v: "owner" | "public") => void
  onNudge?: (seatNo: number) => void
  onBack: () => void
  onRefresh?: () => void | Promise<void>
  events?: PokerTableEvent[]
  animate?: PokerTableEvent[]
  animateFrames?: PokerResolutionFrameView[]
  cardFrames?: PokerResolutionFrameView[]
  identityKey?: string
  members?: ReactNode
}) {
  const [panel, setPanel] = useState<PokerControlPanel | "history" | "overview" | "members" | "ranks" | "playerInfo" | "rollFees" | "potSources" | null>(null), [fit, setFit] = useState(fitTableScene(1440,900))
  const [inspected, setInspected] = useState<{ seatNo: number; key: string } | null>(null)
  const inspectedTrigger = useRef<HTMLButtonElement | null>(null)
  const [compact, setCompact] = useState(false)
  const surface = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null), cardDropArea = useRef<HTMLDivElement>(null), menuTrigger = useRef<HTMLButtonElement>(null)
  const membersTrigger = useRef<HTMLButtonElement>(null)
  const rollFeesTrigger = useRef<HTMLButtonElement>(null)
  const potSourcesTrigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const [soundEnabled, setSoundEnabled] = useState(true)
  const chipLanded = usePokerAudio(table, perspective, identityKey ?? "", soundEnabled)
  const controlVersion = table.controlVersion ?? table.seats.find(seat => seat.seatNo === table.mySeatNo)?.controlVersion
  useEffect(() => { setPanel(current => current === "bet" ? null : current) }, [table.handId, table.actionSeq, controlVersion, perspective, table.actionOnSeat, table.status])
  useEffect(() => { setPanel(current => current === "overview" || current === "history" ? current : null) }, [compact])
  useEffect(() => { setPanel(current => current === "playerInfo" ? null : current) }, [table.roomCode, identityKey, perspective])
  useEffect(() => { setPanel(current => current === "rollFees" || current === "potSources" ? null : current) }, [table.handId, table.roomCode, identityKey, perspective])
  useEffect(() => { setPanel(current => current === "overview" || current === "history" ? null : current) }, [table.handId, table.roomCode, identityKey, perspective, table.mySeatNo])
  useEffect(() => { if (table.status === "closed") setPanel(null) }, [table.status])
  const view = useMemo(()=>projectTable(table, perspective),[table,perspective])
  const nextHand = usePokerReady(view, perspective, identityKey, onRefresh)
  const motion = useTableMotion(table, `${identityKey}:${perspective}:${table.controlVersion}:${fit.scene.mode}:${fit.scale}`)
  const cash = usePokerChips(view, `${identityKey}:${perspective}:${table.controlVersion}:${fit.scene.mode}:${fit.scale}`)
  const cardDock = usesPokerHandDock(view)
  const showPlayControls = hasPokerPlayControls(view, perspective)
  const showRoll = !cardDock && (!!view.reserve || !!view.roll?.enabled || !!view.ruleOptions?.roll || chipValue(cash.funds.roll) > 0)
  const dealt = useDealAnimation(view.handId, view.seats.length + view.board.length, 0, view)
  const { batch: cardMotion, complete: completeCardMotion } = usePokerCardMotion(
    view, JSON.stringify([identityKey, view.roomCode, perspective, view.mySeatNo, controlVersion]),
  )
  const presentedReady = cash.blocked ? { ...nextHand, busy: true } : nextHand
  const paymentPending = !!cardMotion?.payments.some(id => cash.transfers.some(transfer => transfer.id === id))
  useLayoutEffect(() => {
    const element = viewport.current, container = surface.current, scroller = cardDropArea.current
    if (!element || !container || !scroller || typeof ResizeObserver === "undefined") return
    let frame: number | undefined, width: number | undefined, height = 0, containerWidth: number | undefined, containerHeight: number | undefined, centeredSize = ""
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
        if (entry.target === container) { containerWidth = entry.contentRect.width; containerHeight = entry.contentRect.height }
        if (entry.target === element) {
          width = entry.contentRect.width
          height = entry.contentRect.height
        }
      }
      const visibleHeight = scroller.clientHeight, scrollHeight = scroller.scrollHeight
      const size = `${containerWidth}:${containerHeight}:${width}:${height}:${visibleHeight}:${scrollHeight}`
      if (width !== undefined && centeredSize !== size) {
        scroller.scrollTop = Math.max(0, (scrollHeight - visibleHeight) / 2)
        centeredSize = size
      }
      if (frame === undefined) frame = requestAnimationFrame(apply)
    })
    observer.observe(container)
    observer.observe(element)
    // The toolbar can change the visible area while the canvas stays at its minimum height.
    observer.observe(scroller)
    return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame) }
  }, [])
  const slots = Array.from({ length: view.maxSeats }, (_, seatNo) => ({ seatNo, index: view.seats.findIndex(s => s.seatNo === seatNo), seat: view.seats.find(s => s.seatNo === seatNo) }))
  const active = view.status === "closed" ? undefined : view.seats.find(s => s.seatNo === view.actionOnSeat)
  const canNudge = onNudge && perspective === "owner" && view.mySeatNo !== null && active && active.seatNo !== view.mySeatNo && active.participantKind !== "bot"
  const stage = view.status === "closed" ? "房间已解散" : streetLabel[view.street ?? ""] ?? (view.status === "paused" ? "等待对手" : "等待开局")
  const inspectedSeat = view.seats.find(seat => seat.seatNo === inspected?.seatNo)
  const inspectedKey = view.rollStats?.seats.find(seat => seat.seatNo === inspected?.seatNo)?.key ?? inspectedSeat?.botId ?? inspectedSeat?.displayName
  useEffect(() => {
    if (panel === "playerInfo" && (!inspectedSeat || inspected?.key !== inspectedKey)) { setPanel(null); setInspected(null) }
  }, [panel, inspectedSeat, inspected?.key, inspectedKey])
  const closePlayerInfo = () => { const trigger = inspectedTrigger.current; setPanel(null); setInspected(null); requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus() }) }
  const closeRollFees = () => { setPanel(null); requestAnimationFrame(() => rollFeesTrigger.current?.focus()) }
  const closePotSources = () => { setPanel(null); requestAnimationFrame(() => potSourcesTrigger.current?.focus()) }
  return <section ref={surface} className="poker-table poker-immersive" data-control-layout="bottom" data-hand-dock={cardDock && showPlayControls} data-play-controls={showPlayControls} data-compact-controls={compact} aria-label={`牌桌 ${table.roomCode}`}>
    <div className="poker-table-layout">
        <div className="poker-edge-controls bg-surface font-sans text-foreground scheme-light">
          <Button type="button" variant="tertiary" isIconOnly={compact} aria-label="返回房间" onPress={onBack}><ArrowLeft aria-hidden="true" />{!compact && "返回房间"}</Button>
          <div className="poker-room-details">
          <span className="poker-room-summary text-sm"><strong>#{table.roomCode}</strong><span className="text-muted">第 {table.handNo} 手{table.mode === "practice" && " · 陪练"}</span></span>
          <div className="poker-room-rules text-sm tabular-nums"><span>{view.variant === "short32" ? "短牌 32 张" : "标准 52 张"}</span><span>盲注 {view.smallBlind ?? 1} / {view.bigBlind ?? 2}</span></div>
          </div>
          <div className="poker-perspective flex items-center gap-2">
            {members && view.status !== "closed" && <Button ref={membersTrigger} type="button" variant="tertiary" isIconOnly={compact} aria-label="成员管理" aria-expanded={panel === "members"} onPress={() => setPanel(panel === "members" ? null : "members")}><UsersRound aria-hidden="true" />{!compact && "成员"}</Button>}
            <SettlementPanel table={view} perspective={perspective} identityKey={identityKey} onRefresh={onRefresh} onOpen={() => setPanel(null)} compact={compact} ready={presentedReady} blocked={cash.blocked} />
            <PokerMatchOverviewDialog table={view} events={events} perspective={perspective} compact={compact}
              open={panel === "overview"} onOpenChange={open => setPanel(current => open ? "overview" : current === "overview" ? null : current)} />
            <HandRankDialog variant={view.variant} open={panel === "ranks"} onOpenChange={open => setPanel(open ? "ranks" : null)} compact={compact} />
            {view.status !== "closed" && <Button ref={menuTrigger} type="button" variant="tertiary" isIconOnly aria-label="更多牌桌操作" aria-expanded={panel === "menu"} aria-controls={menuId} onPress={() => setPanel(panel === "menu" ? null : "menu")}><MoreHorizontal aria-hidden="true" /></Button>}
          </div>
        </div>
      <div className="poker-table-main" ref={cardDropArea}>
        {view.settlement && !cash.blocked && <div className="poker-results-anchor"><Settlement settlement={view.settlement} /></div>}
        <div className="poker-canvas-viewport" ref={viewport}>
          <div className="poker-canvas" data-table-shape={fit.scene.mode} data-compact={fit.scale<0.65} style={{ ...tableSceneVariables(fit.scene), "--poker-scale":fit.scale || 1, width:fit.scene.width, height:fit.scene.height, transform:`translate(-50%, -50%) scale(${fit.scale})` } as CSSProperties}>
            <div className="poker-rail" aria-hidden="true"><div className="poker-felt" /></div>
            <div className="poker-table-content">
              <div className="poker-center">
                <div className="poker-pot-row">
                  <button ref={potSourcesTrigger} type="button" className="poker-pot-value poker-pot-sources-trigger" aria-label="查看底池来源" aria-haspopup="dialog" aria-expanded={panel === "potSources"} onClick={() => setPanel("potSources")}><span className="poker-pot-label">底池</span><RollingAmount className="poker-pot" value={chipValue(cash.funds.pot)} scope={cash.scope} onAnimating={active=>cash.numberMotion("pot",active)} /><PokerChipPile chips={cash.funds.pot} label="底池" fund="pot" /></button>
                  {showRoll && <button ref={rollFeesTrigger} type="button" className="poker-pot-value poker-roll-fee-trigger" aria-label="查看暂存明细" aria-haspopup="dialog" aria-expanded={panel === "rollFees"} onClick={() => setPanel("rollFees")}><span className="poker-pot-label">暂存</span><RollingAmount className="poker-roll-pot" value={chipValue(cash.funds.roll)} scope={cash.scope} onAnimating={active=>cash.numberMotion("roll",active)} /><PokerChipPile chips={cash.funds.roll} label="暂存" fund="roll" /></button>}
                </div>
                <div className="poker-board" data-card-size="md">
                  {Array.from({length:5},(_,i) => {
                    const visible = !view.board[i] || dealt >= view.seats.length + i + 1
                    return <span key={i} className="poker-deal-slot" data-dealt={visible}><Card card={view.board[i]} faceUp={visible} /></span>
                  })}
                  {cardDock && view.handId && <PokerMotionDecks />}
                </div>
                {cardDock && <span className="poker-motion-cast-zone" data-card-motion-anchor="cast-zone" aria-hidden="true" />}
                <div className="poker-board-caption"><span className="poker-street">{stage}</span><PokerCardFeedback frames={animateFrames} handId={table.handId} scope={`${table.roomCode}:${identityKey}:${perspective}:${controlVersion}`} /></div>
                {view.status === "paused" && view.pauseReason && <p className="poker-pause-reason">{({user:"牌局已暂停",all_humans_away:"真人均已暂离",no_human:"等待本人或 AI 入座",insufficient_players:"等待对手",insufficient_chips:"等待有筹码的玩家"} as Record<string,string>)[view.pauseReason] ?? "等待可参与的玩家"}</p>}
              </div>
              {slots.map(({seatNo,seat,index}) => seat ? <Seat key={seatNo} seat={seat} flatHoleCards={cardDock && seat.isMe} amountScope={`${cash.scope}:${view.rollStats?.seats.find(entry => entry.seatNo === seatNo)?.key ?? ""}`} onStackAnimating={active => cash.numberMotion(`seat:${seatNo}`, active)} displayStack={cash.banks[seatNo] ?? seat.stack} onInspect={trigger => { inspectedTrigger.current = trigger; setInspected({ seatNo, key: view.rollStats?.seats.find(entry => entry.seatNo === seatNo)?.key ?? seat.botId ?? seat.displayName }); setPanel("playerInfo") }} showWager={view.street !== "settled"} departed={seat.isMe && view.mySeatNo === null} result={view.settlement} feedback={motion.actions.filter(a=>a.seatNo===seatNo).at(-1)} feedbackKey={motion.id} turnPulse={motion.turn === seatNo} celebrate={motion.celebrate.includes(seatNo)} maxSeats={view.maxSeats} origin={view.mySeatNo ?? 0} acting={view.status === "running" && seat.inCurrentHand !== false && seat.seatNo === view.actionOnSeat} deadlineMs={view.deadlineMs} dealer={seatNo === view.dealerSeat} dealt={dealt > index} hasStarted={!!view.handId} /> : <EmptySeat key={seatNo} seatNo={seatNo} maxSeats={view.maxSeats} origin={view.mySeatNo ?? 0} />)}
              <ChipMotion transfers={cash.active} layout={`${fit.scene.mode}:${fit.scale}`} scope={cash.scope} onStart={cash.start} onComplete={cash.complete} onLand={chipLanded} />
            </div>
          </div>
        </div>
      </div>
      <PokerCardMotion surface={surface} batch={cardMotion} mySeat={perspective === "owner" ? view.mySeatNo : null}
        paymentPending={paymentPending} onComplete={completeCardMotion} />
      {cardDock && <PokerLogRail key={JSON.stringify([table.roomCode, identityKey, perspective, table.mySeatNo])}
        table={view} historyOpen={panel === "history"}
        onHistoryOpenChange={open => setPanel(current => open ? "history" : current === "history" ? null : current)} />}
      <div className="poker-interaction-rail">
        <PokerMembersPanel open={panel === "members"} onOpenChange={open => setPanel(open ? "members" : null)} compact={compact} trigger={membersTrigger} container={surface.current}>{members}</PokerMembersPanel>
        {panel === "playerInfo" && inspectedSeat && inspected?.key === inspectedKey && <PokerPlayerInfoDialog table={view} seat={inspectedSeat} onClose={closePlayerInfo} />}
        {panel === "rollFees" && <PokerReserveDialog table={view} onClose={closeRollFees} />}
        {panel === "potSources" && <PokerPotSourcesDialog table={view} onClose={closePotSources} />}
        <div className="poker-controls-anchor"><HumanControls cardDropArea={cardDropArea} cardFrames={cardFrames} nextHand={presentedReady} identityKey={identityKey} table={view} perspective={perspective} onPerspective={onPerspective} onRefresh={onRefresh} compact={compact} activePanel={panel === "history" || panel === "overview" || panel === "members" || panel === "ranks" || panel === "playerInfo" || panel === "rollFees" || panel === "potSources" ? null : panel} onPanelChange={setPanel} menuTrigger={menuTrigger} menuId={menuId} popoverContainer={surface.current} menuContent={<>
            <Button fullWidth type="button" variant="tertiary" aria-label={soundEnabled ? "关闭音效" : "开启音效"} aria-pressed={soundEnabled} onPress={() => setSoundEnabled(v => !v)}>{soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}音效</Button>
            {canNudge && <Button fullWidth variant="tertiary" isDisabled={(view.deadlineMs ?? 600000) > 540000} onPress={() => { onNudge(active.seatNo); setPanel(null) }}><Bell aria-hidden="true" />提醒玩家</Button>}
            {table.seats.some(s => s.isMe) && <Button fullWidth variant="tertiary" isDisabled={nextHand.busy} aria-label={perspective === "owner" ? "切换旁观视角" : "切换玩家视角"} onPress={() => { onPerspective(perspective === "owner" ? "public" : "owner"); setPanel(null) }}>{perspective === "owner" ? <UserRound aria-hidden="true" /> : <Eye aria-hidden="true" />}{perspective === "owner" ? "旁观视角" : "玩家视角"}</Button>}
          </>} /></div>
      </div>
    </div>
  </section>
}
