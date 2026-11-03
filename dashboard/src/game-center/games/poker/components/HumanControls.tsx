import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react"
import { AlertDialog, Button, Description, FieldError, Input, Label, Slider, TextField } from "@heroui/react"
import { Bot, ChevronUp, Clock3, Eye, MoreHorizontal, UserRound } from "lucide-react"
import type { PokerResolutionFrameView, PokerTableView } from "@synapse/shared/game-contracts"
import { track } from "@/game-center/runtime/tracking"
import { usePokerRoll } from "../hooks/usePokerRoll"
import { PokerRollDialog } from "./PokerRollDialog"
import { usePokerCards } from "../hooks/usePokerCards"
import { PokerCardsDialog } from "./PokerCardsDialog"
import { PokerCardDockFlow } from "./PokerCardDockFlow"
import { PokerDiamondAmount } from "./PokerDiamondText"
import { PokerButton } from "./PokerButton"
import { PokerControlPopover } from "./PokerControlPopover"
import { PokerJoinSummary } from "./PokerJoinSummary"
import { PokerAIConnectDialog } from "./PokerAIConnectDialog"
import { copyPokerInvitation } from "../lib/room-entry"
import { useHumanControls, type PokerIntent } from "../hooks/useHumanControls"
import { usePokerReady, type PokerReadyControls } from "../hooks/usePokerReady"
import { hasPokerCardFlow, isPokerCardMode, usesPokerHandDock } from "../lib/card-mode"
import { actionState, betPresets, betPaymentPreview, hasPokerPlayControls } from "../lib/action-view"
import { amount, remaining } from "../lib/view"

export type PokerControlPanel = "bet" | "menu" | "roll" | "cards"
type Props = {
  table: PokerTableView
  perspective: "owner" | "public"
  onPerspective?: (value: "owner" | "public") => void
  onRefresh: () => void | Promise<void>
  identityKey?: string
  compact?: boolean
  activePanel?: PokerControlPanel | null
  onPanelChange?: (panel: PokerControlPanel | null) => void
  menuTrigger?: RefObject<HTMLButtonElement | null>
  menuId?: string
  menuContent?: ReactNode
  popoverContainer?: HTMLElement | null
  nextHand?: PokerReadyControls
  cardFrames?: readonly PokerResolutionFrameView[]
  cardDropArea?: RefObject<HTMLDivElement | null>
}
export function HumanControls(props: Props) {
  return props.nextHand ? <ScopedHumanControls {...props} nextHand={props.nextHand} /> : <LocalHumanControls {...props} />
}
function LocalHumanControls(props: Props) {
  const nextHand = usePokerReady(props.table, props.perspective, props.identityKey, props.onRefresh)
  return <ScopedHumanControls {...props} nextHand={nextHand} />
}
function ScopedHumanControls({ table, perspective, onPerspective, onRefresh, identityKey, compact = false, activePanel, onPanelChange, menuTrigger, menuId, popoverContainer, menuContent, nextHand, cardFrames, cardDropArea }: Props & { nextHand: PokerReadyControls }) {
  const { busy, error, to, setTo, uncertain, mine, controller, version, handoff,
    act, retry, control, join, sit, leave } = useHumanControls(table, onRefresh, identityKey)
  const roll = usePokerRoll(table, perspective, onRefresh, identityKey)
  const cards = usePokerCards(table, perspective, onRefresh, identityKey, busy || uncertain || roll.blocked)
  const cardDock = usesPokerHandDock(table)
  const hasCardFlow = hasPokerCardFlow(table, perspective)
  const showPlayControls = hasPokerPlayControls(table, perspective)
  const showCardDock = cardDock && showPlayControls
  const showCardControls = !cardDock && perspective === "owner" && !!table.cards?.enabled
  const canOpenCards = showCardControls && showPlayControls && cards.canControl
  const cardPending = !!table.cards?.pending
  const rollPending = !!table.roll?.pending || (table.mySeatNo !== null && table.roll?.pendingSeatNo === table.mySeatNo)
  const awaitingReady = table.status !== "closed" && !!table.awaitingReady
  const takeover = () => awaitingReady ? nextHand.takeover() : control("takeover")
  const cardMode = isPokerCardMode(table)
  const [aiOpen, setAIOpen] = useState(false)
  const openAI = () => { if (cardMode) return; setPanel(null); setAIOpen(true) }
  const canInvite = table.status !== "running" && table.status !== "closed" && table.seats.filter(seat => !seat.isHistorical && seat.status !== "left").length < table.maxSeats
  useEffect(() => { setAIOpen(false) }, [identityKey, table.roomCode])
  const joinLabel = table.mode === "points" ? `带入 ${amount(table.buyIn)} 点入座` : "本人入座"
  const [allInAction, setAllInAction] = useState<PokerIntent["action"] | null>(null)
  const [localPanel, setLocalPanel] = useState<PokerControlPanel | null>(null)
  const panel = activePanel === undefined ? localPanel : activePanel
  const panelEpoch = useRef({ panel, generation: 0 })
  if (panelEpoch.current.panel !== panel) panelEpoch.current = { panel, generation: panelEpoch.current.generation + 1 }
  const setPanel = useCallback((next: PokerControlPanel | null) => { if (onPanelChange) onPanelChange(next); else setLocalPanel(next) }, [onPanelChange])
  const controlsRef = useRef<HTMLDivElement>(null), betTrigger = useRef<HTMLButtonElement>(null), localMenuTrigger = useRef<HTMLButtonElement>(null)
  const managementTrigger = menuTrigger ?? localMenuTrigger
  const confirmAllIn = allInAction !== null && panel === "bet"
  const rollEpoch = `${identityKey}:${table.roomCode}:${table.handId}:${table.street}:${table.actionSeq}:${version}:${perspective}`
  const cardEpoch = `${identityKey}:${table.roomCode}:${table.handId}:${table.street}:${version}:${perspective}`
  const [intelEpoch, setIntelEpoch] = useState<string | null>(null)
  const canReviewIntel = hasCardFlow && !!table.cards?.privateResults?.some(result => result.label !== "候选")
  const closeIntel = () => { setIntelEpoch(null); requestAnimationFrame(() => managementTrigger.current?.focus()) }
  const autoOpened = useRef("")
  const betId = useId()
  const allInTrigger = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const confirmOrigin = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  const cancelConfirmation = () => { restoreFocus.current = true; setAllInAction(null); if (!canBet) setPanel(null) }
  const openConfirmation = (action: PokerIntent["action"]) => { confirmOrigin.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : allInTrigger.current; restoreFocus.current = false; setAllInAction(action); setPanel("bet") }
  useEffect(() => {
    if (wasConfirming.current && !confirmAllIn && restoreFocus.current) { if (confirmOrigin.current?.isConnected) confirmOrigin.current.focus(); else allInTrigger.current?.focus() }
    wasConfirming.current = confirmAllIn
  }, [confirmAllIn])
  useEffect(() => { setAllInAction(null); setLocalPanel(null) }, [table.handId, table.actionSeq, version, perspective, compact, table.actionOnSeat, table.status])
  useEffect(() => { if (panel === "cards" && !canOpenCards) setPanel(null) }, [panel, canOpenCards, setPanel])
  useEffect(() => {
    const rollId = table.roll?.pending?.rollId ?? roll.continuation?.actionId
    if (perspective !== "owner" || !rollId) return
    if (!table.roll?.pending && panel !== "roll") return
    const key = `${identityKey}:${table.roomCode}:${table.handId}:${rollId}:${controller}`
    if (key !== autoOpened.current) { autoOpened.current = key; setPanel("roll") }
  }, [identityKey,table.roomCode,table.handId,table.roll?.pending?.rollId,roll.continuation?.actionId,controller,perspective,setPanel])
  useEffect(() => { if (perspective !== "owner") setPanel(null) },[perspective,setPanel])
  useEffect(() => {
    const pending = table.cards?.pending
    if (!canOpenCards || !pending) return
    const key = `${identityKey}:${table.roomCode}:${table.handId}:card:${pending.choiceId}`
    if (key !== autoOpened.current) { autoOpened.current = key; setPanel("cards") }
  }, [identityKey, table.roomCode, table.handId, table.cards?.pending?.choiceId, canOpenCards, setPanel])
  const legal = table.legalActions ?? [], numeric = Number(to)
  const validAmount = to.trim() !== "" && Number.isSafeInteger(numeric) && numeric >= (table.minRaiseTo ?? Infinity) && numeric <= (table.maxRaiseTo ?? -1)
  const acting = showPlayControls && table.actionOnSeat === table.mySeatNo && version != null
  const disabled = busy || uncertain || nextHand.busy || roll.blocked || rollPending || cards.blocked || cardPending
  const actionDisabled = !acting || disabled || confirmAllIn
  const canBet = legal.includes("bet") || legal.includes("raise")
  const canFold = legal.includes("fold")
  const canCheck = legal.includes("check")
  const canCall = legal.includes("call")
  const canAllIn = !canBet && legal.includes("allin")
  const showCall = canCall || (showCardDock && !canCheck && (table.toCall ?? 0) > 0)
  const showBetChoices = showCardDock || canBet
  const betDisabled = actionDisabled || !canBet
  const raise = legal.includes("raise")
  const betOpen = acting && canBet && (!showCardDock || !disabled) && panel === "bet"
  const canKeepBetPanel = acting && !disabled && (allInAction ? legal.includes(allInAction) : canBet)
  useEffect(() => {
    if (hasCardFlow && panel === "bet" && !canKeepBetPanel) {
      setAllInAction(null)
      setPanel(null)
    }
  }, [hasCardFlow, panel, canKeepBetPanel, setPanel])
  const preview = betPaymentPreview(table, Math.max(0, numeric - (mine?.streetBet ?? 0)))
  const callPreview = betPaymentPreview(table, table.toCall ?? 0)
  const contribution = preview.paidAmount
  const pendingState = mine?.leavePending ? "本手后离桌" : table.pauseReason === "user" && mine?.status !== "sitting_out" ? "本手后暂离" : null
  const baseState = perspective === "public" && controller === "human" && table.actionOnSeat === table.mySeatNo && table.status === "running" ? "旁观视角 · 切回玩家视角出牌" : actionState(table, acting, handoff)
  const blockedState = cards.uncertain ? "用牌结果待核对" : cardPending ? "请先完成卡牌选择" : roll.storageError ? "换牌恢复记录不可用" : roll.uncertain ? "换牌结果待核对" : rollPending ? "请先完成换牌" : null
  const controlState = blockedState ?? (handoff && mine ? acting ? "轮到你 · 等待 AI 接入" : mine.status === "sitting_out" ? "已暂离 · 等待 AI 接入" : "等待 AI 接入 · 本人仍可操作" : baseState)
  const state = busy ? "正在提交…" : pendingState && table.status === "running" ? `${controlState} · ${pendingState}` : controlState
  const canAct = !actionDisabled && (canFold || canCheck || canCall || canAllIn || canBet && validAmount)
  const activeOpponent = table.status === "running" && table.actionOnSeat !== table.mySeatNo
    ? table.seats.find(seat => seat.seatNo === table.actionOnSeat) : undefined
  const waitingState = activeOpponent ? `等待 ${activeOpponent.displayName} 行动` : acting ? "等待牌桌更新" : baseState
  const dockStatus = canAct ? "" : busy || cards.busy || roll.busy ? "正在提交…"
    : uncertain ? "出牌结果待核对" : confirmAllIn ? "等待确认全下" : blockedState ?? waitingState
  const presets = betPresets(table)
  const amountError = !to.trim() ? "请输入金额" : !Number.isSafeInteger(numeric) ? "请输入整数金额" : numeric < (table.minRaiseTo ?? Infinity) ? `至少${raise ? "加注" : "下注"}到 ${amount(table.minRaiseTo ?? 0)}` : numeric > (table.maxRaiseTo ?? -1) ? `最多${raise ? "加注" : "下注"}到 ${amount(table.maxRaiseTo ?? 0)}` : null
  const manage = async (work: () => Promise<boolean>) => {
    const generation = panelEpoch.current.generation
    if (await work() && panelEpoch.current.generation === generation) setPanel(null)
  }
  const submit = (action: PokerIntent["action"]) => {
    const contribution = action === "allin" ? mine?.stack ?? 0 : action === "call" ? callPreview.paidAmount : action === "bet" || action === "raise" ? preview.paidAmount : 0
    if (mine && mine.stack > 0 && contribution >= mine.stack) openConfirmation(action)
    else { setPanel(null); act(action) }
  }
  const confirmation = <AlertDialog.Backdrop isOpen={confirmAllIn} onOpenChange={open => { if (!open) cancelConfirmation() }} isKeyboardDismissDisabled={false} UNSTABLE_portalContainer={popoverContainer ?? controlsRef.current ?? undefined} className="font-sans text-foreground scheme-light">
    <AlertDialog.Container size="sm"><AlertDialog.Dialog aria-label="确认全下">
      <AlertDialog.Header><AlertDialog.Heading>确认全下</AlertDialog.Heading></AlertDialog.Header>
      <AlertDialog.Body><p>投入全部剩余筹码 {amount(mine?.stack ?? 0)}</p>{!!table.betWaiverCap && <p className="text-sm text-muted">名义下注 {amount((mine?.stack ?? 0) + table.betWaiverCap)} · 豁免 {amount(table.betWaiverCap)}</p>}</AlertDialog.Body>
      <AlertDialog.Footer>
        <Button autoFocus variant="tertiary" isDisabled={disabled} onPress={cancelConfirmation}>取消</Button>
        <Button variant="danger" isDisabled={disabled} onPress={() => { if (allInAction) { act(allInAction); setAllInAction(null); setPanel(null) } }}>确认全下 {amount(mine?.stack ?? 0)}</Button>
      </AlertDialog.Footer>
    </AlertDialog.Dialog></AlertDialog.Container>
  </AlertDialog.Backdrop>
  const betEditor = <div className="space-y-4 font-sans text-foreground scheme-light">
    {table.paymentVersion && <p className="text-sm tabular-nums">名义追加 {amount(preview.nominalAmount)} · 豁免 {amount(preview.waivedAmount)} · 实付 {amount(preview.paidAmount)}</p>}
    <TextField isDisabled={disabled || confirmAllIn} isInvalid={!validAmount}>
      <Label htmlFor={betId}>{raise ? "加注到" : "下注到"}</Label>
      <Input variant="secondary" id={betId} type="number" inputMode="numeric" min={table.minRaiseTo} max={table.maxRaiseTo} step={1} value={to} onChange={e => setTo(e.target.value)} />
      <Description>范围 {amount(table.minRaiseTo ?? 0)}–{amount(table.maxRaiseTo ?? 0)}</Description>
      <FieldError>{amountError}</FieldError>
    </TextField>
    {!validAmount && <p className="text-xs text-muted">范围 {amount(table.minRaiseTo ?? 0)}–{amount(table.maxRaiseTo ?? 0)}</p>}
    <p className="text-sm text-muted">追加 <b className="font-medium text-foreground">{validAmount ? amount(contribution) : "—"}</b></p>
    <Slider aria-label="下注金额" minValue={table.minRaiseTo ?? 0} maxValue={table.maxRaiseTo ?? 0} step={1} value={Number.isFinite(numeric) ? Math.min(table.maxRaiseTo ?? 0, Math.max(table.minRaiseTo ?? 0, numeric)) : table.minRaiseTo ?? 0} isDisabled={disabled || confirmAllIn} onChange={value => setTo(String(value))}>
      <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
    </Slider>
    {legal.includes("allin") && <Button ref={allInTrigger} variant="danger-soft" isDisabled={disabled || confirmAllIn} onPress={() => openConfirmation("allin")} aria-expanded={confirmAllIn}>全下</Button>}
  </div>
  const sessionControls = <div className="flex flex-col items-stretch gap-3">
      {!mine && table.status !== "closed" && <>{!cardMode && handoff ? <><Button fullWidth isDisabled={busy} onPress={openAI}>查看接入 / 取消</Button><Button fullWidth variant="tertiary" isDisabled={busy} onPress={() => void manage(() => control("cancel_ai"))}>取消 AI 接入</Button></> : <><Button isDisabled={busy} fullWidth onPress={() => void manage(join)}><UserRound aria-hidden="true" />{joinLabel}</Button>{!cardMode && <Button fullWidth variant="secondary" isDisabled={busy || version == null} onPress={openAI}><Bot aria-hidden="true" />接入 AI</Button>}</>}</>}
      {mine && table.status !== "closed" && <>
        {controller !== "human" ? <Button fullWidth isDisabled={busy || uncertain || roll.blocked || version == null} onPress={() => void manage(takeover)}>本人接管</Button> : handoff ? <Button fullWidth variant="tertiary" isDisabled={disabled} onPress={() => void manage(() => control("cancel_ai"))}>取消 AI 接管</Button> : !cardMode && <Button fullWidth variant="secondary" isDisabled={disabled || version == null} onPress={openAI}>交给 AI</Button>}
        {!cardMode && handoff && <Button fullWidth variant="secondary" onPress={openAI}>查看接入 / 取消</Button>}
        <Button fullWidth variant="secondary" isDisabled={disabled || version == null || controller !== "human"} onPress={() => void manage(sit)}>{mine.status === "sitting_out" ? "回到牌桌" : table.pauseReason === "user" ? "本手后暂离" : "暂离"}</Button>
        <Button fullWidth variant="danger-soft" isDisabled={disabled || version == null || controller !== "human"} onPress={() => void manage(leave)}>离桌</Button>
      </>}
    </div>
  const closeBet = (open: boolean) => { if (!open) { setAllInAction(null); setPanel(null) } }
  const showTakeover = controller !== "human"
  const showReturn = controller === "human" && mine?.status === "sitting_out"
  const showPlayerView = controller === "human" && perspective === "public" && !!onPerspective
  const showHandoff = !cardMode && handoff
  const recovery = mine && table.status !== "closed" && !acting && (showTakeover || showReturn || showPlayerView || showHandoff) ? <>
    {showTakeover && <Button isDisabled={busy || uncertain || nextHand.busy || roll.blocked || version == null} onPress={() => void takeover()}>本人接管</Button>}
    {showReturn && <Button isDisabled={disabled || version == null} onPress={() => void sit()}>回到牌桌</Button>}
    {showPlayerView && <Button isDisabled={busy || uncertain || nextHand.busy} onPress={() => onPerspective?.("owner")}>切回玩家视角</Button>}
    {showHandoff && <><Button variant="secondary" isDisabled={busy} onPress={openAI}>查看接入 / 取消</Button><Button variant="tertiary" isDisabled={disabled || version == null} onPress={() => void control("cancel_ai")}>取消 AI 接管</Button></>}
  </> : null
  const invite = canInvite ? <Button variant="secondary" onPress={() => void copyPokerInvitation(table.roomCode)}>邀请玩家</Button> : null
  const rollEntry = !cardDock && (perspective === "owner" && mine && table.roll?.enabled && table.status === "running" && (acting || rollPending || roll.uncertain) && <Button size="sm" variant="tertiary" isDisabled={busy || uncertain || nextHand.busy || cards.blocked || cardPending} aria-label={!rollPending&&!roll.uncertain&&table.roll.coins?`Roll 换牌，钻石 ${table.roll.coins.balance}`:undefined} aria-expanded={panel === "roll"} onPress={() => {track({component:"button",name:"poker-roll",action:"click"});setAllInAction(null);setPanel("roll")}}>{rollPending ? "完成换牌" : roll.uncertain ? "核对换牌" : table.roll.coins ? <PokerDiamondAmount value={table.roll.coins.balance}/> : "Roll 换牌"}</Button> || (roll.uncertain || roll.storageError ? <Button size="sm" variant="secondary" isDisabled={roll.busy} onPress={()=>void roll.retry()}>{roll.storageError ? "重试恢复记录" : "核对原换牌请求"}</Button> : null))
  const cardEntry = canOpenCards
    ? <Button size="sm" variant="tertiary" isDisabled={busy || uncertain || nextHand.busy || roll.blocked || rollPending} aria-expanded={panel === "cards"} onPress={() => { track({component:"button",name:"poker-cards",action:"click"}); setAllInAction(null); setPanel("cards") }}>卡牌</Button>
    : showCardControls && mine && (cards.uncertain || cards.storageError)
      ? <Button size="sm" variant="secondary" isDisabled={cards.busy} onPress={() => void cards.retry()}>{cards.storageError ? "重试恢复记录" : "核对原用牌请求"}</Button>
      : null
  return <div ref={controlsRef} className="poker-human-controls" data-acting={acting} data-compact-controls={compact} aria-label="本人牌桌操作" onKeyDown={event => { if (event.key === "Escape" && confirmAllIn) { event.stopPropagation(); cancelConfirmation() } }}>
    {hasCardFlow && <PokerCardDockFlow key={`${cardEpoch}:${table.mySeatNo}:${controller}:${table.status}`} table={table} controls={cards} showHand={showCardDock}
      disabled={busy || uncertain || nextHand.busy || roll.blocked || rollPending} frames={cardFrames} dropArea={cardDropArea}
      onActivate={() => { setAllInAction(null); setPanel(null) }} onRefresh={onRefresh} intelOpen={intelEpoch === cardEpoch} onIntelClose={closeIntel} />}
    {awaitingReady ? <div className="poker-control-state poker-ready-row flex-wrap font-sans scheme-light" aria-label="下一手操作">
      <span role="status" className="min-w-0 wrap-anywhere">
        {!nextHand.eligible && mine?.status === "sitting_out" && <>已暂离 · </>}
        {nextHand.summary}
        {nextHand.notice ? <> · {nextHand.notice}</> : nextHand.prepared && controller === "human" && <> · 你已准备</>}
      </span>
      {nextHand.canReady && !nextHand.prepared && <Button isPending={nextHand.busy} isDisabled={disabled} onPress={() => void nextHand.ready()}>{table.handNo === 0 ? "准备" : "准备下一手"}</Button>}
      {nextHand.canStart && <Button isPending={nextHand.busy} isDisabled={disabled} onPress={() => void nextHand.start()}>开始</Button>}
      {recovery}{invite}
      {nextHand.error && <div className="w-full space-y-2"><p role="alert" className="text-sm text-danger">{nextHand.error}</p><Button variant="secondary" onPress={() => void nextHand.refresh()}>刷新牌桌</Button></div>}
    </div> : !showCardDock && <div className="poker-control-state"><span className="poker-action-indicator" aria-hidden="true" /><span role="status" className="min-w-0 wrap-anywhere">{state}</span>{!cardMode && acting && handoff && <Button size="sm" variant="tertiary" isDisabled={busy} onPress={openAI}>查看 AI 接入</Button>}{acting && table.deadlineMs != null && <span className="poker-action-clock" role="timer" aria-live="off" aria-label="行动剩余时间"><Clock3 aria-hidden="true" />{remaining(table.deadlineMs)}</span>}</div>}
    {(error || uncertain) && <div className="space-y-3 rounded-xl bg-surface p-4 font-sans text-foreground scheme-light"><p role="alert" className="text-sm text-danger">{error}{uncertain && "，请重试确认结果"}</p>{uncertain && <Button isDisabled={busy} onPress={retry}>重试出牌</Button>}</div>}
    {!mine && table.status !== "closed" && <div className="space-y-2 font-sans text-foreground scheme-light"><PokerJoinSummary table={table} /><div className="poker-join-controls">{sessionControls}</div></div>}
    {!awaitingReady && invite && <div className="mt-2 flex flex-wrap items-center gap-2 font-sans text-foreground scheme-light">{invite}</div>}
    {!awaitingReady && recovery && <div className="flex flex-wrap gap-2 font-sans text-foreground scheme-light" aria-label="恢复牌桌操作">{recovery}</div>}
    {!cardDock && perspective === "owner" && <PokerRollDialog table={table} open={panel === "roll"} onOpenChange={open=>setPanel(open?"roll":null)} controls={roll} onTakeover={()=>void takeover()} disabled={busy||uncertain||nextHand.busy||cards.blocked||cardPending} epoch={rollEpoch}/>}

    {canOpenCards && <PokerCardsDialog table={table} open={panel === "cards"} onOpenChange={open => setPanel(open ? "cards" : null)} controls={cards} disabled={busy || uncertain || nextHand.busy || roll.blocked || rollPending} epoch={cardEpoch} frames={cardFrames} />}
    {!acting && (rollEntry || cardEntry) && <div className="poker-bet-presets font-sans text-foreground scheme-light">{rollEntry}{cardEntry}</div>}
    {(acting || showCardDock) && <div className="poker-action-dock">
      {showCardDock && <p className="poker-action-dock-status" role="status" title={dockStatus || undefined}>
        {canAct ? <span className="sr-only">{state}</span> : dockStatus}
      </p>}
      {(showBetChoices || rollEntry || cardEntry) && <div className="poker-bet-presets font-sans text-foreground scheme-light" role="group" aria-label="下注金额选择">
        {rollEntry}{cardEntry}
        {showBetChoices && presets.map(preset => {
          const selected = acting && canBet && numeric === preset.to
          return <Button key={preset.label} size="sm" variant={selected ? "secondary" : "tertiary"} aria-pressed={selected} isDisabled={betDisabled} onPress={() => setTo(String(preset.to))}>{preset.label}</Button>
        })}
        {showBetChoices && <Button ref={betTrigger} size="sm" variant="tertiary" isDisabled={betDisabled} aria-expanded={betOpen} aria-controls={`${betId}-panel`} onPress={() => setPanel(betOpen ? null : "bet")}>自定义<ChevronUp aria-hidden="true" /></Button>}
      </div>}
      <div className="poker-action-buttons">
        {(showCardDock || canFold) && <PokerButton className="poker-fold-action" disabled={actionDisabled || !canFold} onClick={() => act("fold")}>弃牌</PokerButton>}
        {(canCheck || (showCardDock && !showCall)) && <PokerButton tone="primary" disabled={actionDisabled || !canCheck} onClick={() => act("check")}>过牌{canCheck && !compact && <span>无需跟注</span>}</PokerButton>}
        {showCall && <PokerButton ref={!showCardDock && !canBet && !canAllIn ? betTrigger : undefined} tone="primary" disabled={actionDisabled || !canCall} onClick={() => submit("call")}>跟注 {amount(table.toCall ?? 0)}{callPreview.waivedAmount > 0 && <span>实付 {amount(callPreview.paidAmount)}</span>}</PokerButton>}
        {(canBet || (showCardDock && !canAllIn)) && <PokerButton className="poker-raise-action" disabled={actionDisabled || !canBet || !validAmount} aria-label={canBet ? `确认${raise ? "加注" : "下注"} ${amount(numeric)}` : undefined} onClick={() => submit(raise ? "raise" : "bet")}>{raise ? "加注到" : "下注到"} {canBet && validAmount ? amount(numeric) : "—"}</PokerButton>}
        {canAllIn && <PokerButton ref={showCardDock ? undefined : betTrigger} tone="danger" disabled={actionDisabled} onClick={() => openConfirmation("allin")} aria-expanded={confirmAllIn}>全下</PokerButton>}
      </div>

    </div>}
    {<PokerControlPopover open={betOpen} onOpenChange={closeBet} trigger={betTrigger} container={popoverContainer ?? controlsRef.current} title={raise ? "加注" : "下注"} id={`${betId}-panel`} restoreFocus={panel === null && !confirmAllIn}>
      {betEditor}
    </PokerControlPopover>}
    {!menuTrigger && mine && table.status !== "closed" && <div className="poker-local-menu font-sans text-foreground scheme-light"><Button ref={localMenuTrigger} variant="tertiary" aria-label="更多牌桌操作" aria-expanded={panel === "menu"} aria-controls={menuId} onPress={() => setPanel(panel === "menu" ? null : "menu")}><MoreHorizontal aria-hidden="true" />座位管理</Button></div>}
    <PokerControlPopover open={panel === "menu"} onOpenChange={open => { if (!open) setPanel(null) }} trigger={managementTrigger} container={popoverContainer ?? controlsRef.current} title="更多操作" id={menuId} side={menuTrigger ? "bottom" : "top"} restoreFocus={panel === null && !confirmAllIn && intelEpoch !== cardEpoch}>
      {canReviewIntel && <Button fullWidth variant="tertiary" aria-haspopup="dialog" isDisabled={disabled} onPress={() => { setPanel(null); setIntelEpoch(cardEpoch) }}><Eye aria-hidden="true" />私密情报</Button>}
      {mine && sessionControls}{menuContent && <div className="mt-4 space-y-3 border-t border-separator pt-4">{menuContent}</div>}</PokerControlPopover>
    {confirmation}
    {!cardMode && aiOpen && <PokerAIConnectDialog key={`${identityKey}:${table.roomCode}`} open onOpenChange={setAIOpen} roomCode={table.roomCode} table={table} onChanged={onRefresh} />}
  </div>
}
