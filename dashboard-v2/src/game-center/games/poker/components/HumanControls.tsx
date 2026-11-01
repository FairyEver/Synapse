import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react"
import { AlertDialog, Button, Description, FieldError, Input, Label, Slider, TextField } from "@heroui/react"
import { Bot, Clock3, MoreHorizontal, UserRound } from "lucide-react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { PokerButton } from "./PokerButton"
import { PokerControlPopover } from "./PokerControlPopover"
import { PokerJoinSummary } from "./PokerJoinSummary"
import { PokerAIConnectDialog } from "./PokerAIConnectDialog"
import { copyPokerInvitation } from "../lib/room-entry"
import { BetDecisionContext } from "./BetDecisionContext"
import { useHumanControls, type PokerIntent } from "../hooks/useHumanControls"
import { actionState, betPresets } from "../lib/action-view"
import { amount, remaining } from "../lib/view"

export type PokerControlPanel = "bet" | "menu"
export function HumanControls({ table, perspective, onPerspective, onRefresh, identityKey, compact = false, activePanel, onPanelChange, menuTrigger, menuId, popoverContainer, menuContent }: {
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
}) {
  const { busy, error, to, setTo, uncertain, mine, controller, version, handoff,
    act, retry, control, join, sit, leave } = useHumanControls(table, onRefresh, identityKey)
  const [aiOpen, setAIOpen] = useState(false)
  const openAI = () => { setPanel(null); setAIOpen(true) }
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
  const betAnchor = useRef<HTMLSpanElement>(null)
  const managementTrigger = menuTrigger ?? localMenuTrigger
  const confirmAllIn = allInAction !== null
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
  const legal = table.legalActions ?? [], numeric = Number(to)
  const validAmount = to.trim() !== "" && Number.isSafeInteger(numeric) && numeric >= (table.minRaiseTo ?? Infinity) && numeric <= (table.maxRaiseTo ?? -1)
  const acting = perspective === "owner" && controller === "human" && table.actionOnSeat === table.mySeatNo && table.status === "running" && !!table.handId && version != null
  const disabled = busy || uncertain
  const canBet = legal.includes("bet") || legal.includes("raise")
  const raise = legal.includes("raise")
  const contribution = Math.max(0, Math.min(mine?.stack ?? 0, numeric - (mine?.streetBet ?? 0)))
  const pendingState = mine?.leavePending ? "本手后离桌" : table.pauseReason === "user" && mine?.status !== "sitting_out" ? "本手后暂离" : null
  const baseState = perspective === "public" && controller === "human" && table.actionOnSeat === table.mySeatNo && table.status === "running" ? "旁观视角 · 切回玩家视角出牌" : actionState(table, acting, handoff)
  const controlState = handoff && mine ? acting ? "轮到你 · 等待 AI 接入" : mine.status === "sitting_out" ? "已暂离 · 等待 AI 接入" : "等待 AI 接入 · 本人仍可操作" : baseState
  const state = busy ? "正在提交…" : pendingState && table.status === "running" ? `${controlState} · ${pendingState}` : controlState
  const presets = betPresets(table)
  const amountError = !to.trim() ? "请输入金额" : !Number.isSafeInteger(numeric) ? "请输入整数金额" : numeric < (table.minRaiseTo ?? Infinity) ? `至少${raise ? "加注" : "下注"}到 ${amount(table.minRaiseTo ?? 0)}` : numeric > (table.maxRaiseTo ?? -1) ? `最多${raise ? "加注" : "下注"}到 ${amount(table.maxRaiseTo ?? 0)}` : null
  const manage = async (work: () => Promise<boolean>) => {
    const generation = panelEpoch.current.generation
    if (await work() && panelEpoch.current.generation === generation) setPanel(null)
  }
  const submit = (action: PokerIntent["action"]) => {
    const contribution = action === "allin" ? mine?.stack ?? 0 : action === "call" ? table.toCall ?? 0 : action === "bet" || action === "raise" ? numeric - (mine?.streetBet ?? 0) : 0
    if (mine && mine.stack > 0 && contribution >= mine.stack) openConfirmation(action)
    else { setPanel(null); act(action) }
  }
  const confirmation = <AlertDialog.Backdrop isOpen={confirmAllIn} onOpenChange={open => { if (!open) cancelConfirmation() }} isKeyboardDismissDisabled={false} UNSTABLE_portalContainer={popoverContainer ?? controlsRef.current ?? undefined} className="font-sans text-foreground scheme-light">
    <AlertDialog.Container size="sm"><AlertDialog.Dialog aria-label="确认全下">
      <AlertDialog.Header><AlertDialog.Heading>确认全下</AlertDialog.Heading></AlertDialog.Header>
      <AlertDialog.Body><p>投入全部剩余筹码 {amount(mine?.stack ?? 0)}</p></AlertDialog.Body>
      <AlertDialog.Footer>
        <Button autoFocus variant="tertiary" isDisabled={disabled} onPress={cancelConfirmation}>取消</Button>
        <Button variant="danger" isDisabled={disabled} onPress={() => { if (allInAction) { act(allInAction); setAllInAction(null); setPanel(null) } }}>确认全下 {amount(mine?.stack ?? 0)}</Button>
      </AlertDialog.Footer>
    </AlertDialog.Dialog></AlertDialog.Container>
  </AlertDialog.Backdrop>
  const betEditor = <div className="space-y-4 font-sans text-foreground scheme-light">
    <BetDecisionContext table={table} />
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
    <div className="flex flex-wrap gap-2">{presets.map(preset => <Button key={preset.label} size="sm" variant="secondary" aria-pressed={numeric === preset.to} isDisabled={disabled || confirmAllIn} onPress={() => setTo(String(preset.to))}>{preset.label}</Button>)}{legal.includes("allin") && <Button ref={allInTrigger} size="sm" variant="danger-soft" isDisabled={disabled || confirmAllIn} onPress={() => openConfirmation("allin")} aria-expanded={confirmAllIn}>全下</Button>}</div>
    {canBet && <Button fullWidth isDisabled={disabled || confirmAllIn || !validAmount} onPress={() => submit(raise ? "raise" : "bet")} aria-label={`确认${raise ? "加注" : "下注"} ${amount(numeric)}`}>{raise ? "加注到" : "下注到"} {amount(Number.isFinite(numeric) ? numeric : 0)}</Button>}
  </div>
  const sessionControls = <div className="flex flex-col items-stretch gap-3">
      {!mine && table.status !== "closed" && <>{handoff ? <><Button fullWidth isDisabled={busy} onPress={openAI}>查看接入 / 取消</Button><Button fullWidth variant="tertiary" isDisabled={busy} onPress={() => void manage(() => control("cancel_ai"))}>取消 AI 接入</Button></> : <><Button isDisabled={busy} fullWidth onPress={() => void manage(join)}><UserRound aria-hidden="true" />{joinLabel}</Button><Button fullWidth variant="secondary" isDisabled={busy || version == null} onPress={openAI}><Bot aria-hidden="true" />接入 AI</Button></>}</>}
      {mine && table.status !== "closed" && <>
        {controller !== "human" ? <Button fullWidth isDisabled={disabled || version == null} onPress={() => void manage(() => control("takeover"))}>本人接管</Button> : handoff ? <Button fullWidth variant="tertiary" isDisabled={disabled} onPress={() => void manage(() => control("cancel_ai"))}>取消 AI 接管</Button> : <Button fullWidth variant="secondary" isDisabled={disabled || version == null} onPress={openAI}>交给 AI</Button>}
        {handoff && <Button fullWidth variant="secondary" onPress={openAI}>查看接入 / 取消</Button>}
        <Button fullWidth variant="secondary" isDisabled={disabled || version == null || controller !== "human"} onPress={() => void manage(sit)}>{mine.status === "sitting_out" ? "回到牌桌" : table.pauseReason === "user" ? "本手后暂离" : "暂离"}</Button>
        <Button fullWidth variant="danger-soft" isDisabled={disabled || version == null || controller !== "human"} onPress={() => void manage(leave)}>离桌</Button>
      </>}
    </div>
  const closeBet = (open: boolean) => { if (!open) { setAllInAction(null); setPanel(null) } }
  const recovery = mine && table.status !== "closed" && !acting ? <div className="flex flex-wrap gap-2 font-sans text-foreground scheme-light" aria-label="恢复牌桌操作">
    {controller !== "human" && <Button isDisabled={disabled || version == null} onPress={() => void control("takeover")}>本人接管</Button>}
    {controller === "human" && mine.status === "sitting_out" && <Button isDisabled={disabled || version == null} onPress={() => void sit()}>回到牌桌</Button>}
    {controller === "human" && perspective === "public" && onPerspective && <Button isDisabled={disabled} onPress={() => onPerspective("owner")}>切回玩家视角</Button>}
    {handoff && <><Button variant="secondary" isDisabled={busy} onPress={openAI}>查看接入 / 取消</Button><Button variant="tertiary" isDisabled={disabled || version == null} onPress={() => void control("cancel_ai")}>取消 AI 接管</Button></>}
  </div> : null
  return <div ref={controlsRef} className="poker-human-controls" data-acting={acting} data-compact-controls={compact} aria-label="本人牌桌操作" onKeyDown={event => { if (event.key === "Escape" && confirmAllIn) { event.stopPropagation(); cancelConfirmation() } }}>
    <span ref={betAnchor} className="poker-bet-popover-anchor" aria-hidden="true" />
    <div className="poker-control-state"><span className="poker-action-indicator" aria-hidden="true" /><span role="status">{state}</span>{acting && handoff && <Button size="sm" variant="tertiary" isDisabled={busy} onPress={openAI}>查看 AI 接入</Button>}{acting && table.deadlineMs != null && <span className="poker-action-clock" role="timer" aria-live="off" aria-label="行动剩余时间"><Clock3 aria-hidden="true" />{remaining(table.deadlineMs)}</span>}</div>
    {(error || uncertain) && <div className="space-y-3 rounded-xl bg-surface p-4 font-sans text-foreground scheme-light"><p role="alert" className="text-sm text-danger">{error}{uncertain && "，请重试确认结果"}</p>{uncertain && <Button isDisabled={busy} onPress={retry}>重试出牌</Button>}</div>}
    {!mine && table.status !== "closed" && <div className="space-y-2 font-sans text-foreground scheme-light"><PokerJoinSummary table={table} /><div className="poker-join-controls">{sessionControls}</div></div>}
    {canInvite && <div className="mt-2 flex flex-wrap items-center gap-2 font-sans text-foreground scheme-light"><Button variant="secondary" onPress={() => void copyPokerInvitation(table.roomCode)}>邀请玩家</Button></div>}
    {recovery}
    {acting && <div className="poker-action-dock">
      <div className="poker-action-buttons">
        {legal.includes("fold") && <PokerButton className="poker-fold-action" disabled={disabled || confirmAllIn} onClick={() => act("fold")}>弃牌</PokerButton>}
        {legal.includes("check") && <PokerButton tone="primary" disabled={disabled || confirmAllIn} onClick={() => act("check")}>过牌{!compact && <span>无需跟注</span>}</PokerButton>}
        {legal.includes("call") && <PokerButton ref={!canBet && !legal.includes("allin") ? betTrigger : undefined} tone="primary" disabled={disabled || confirmAllIn} onClick={() => submit("call")}>跟注 {amount(table.toCall ?? 0)}</PokerButton>}
        {canBet && <PokerButton ref={betTrigger} className="poker-raise-action" disabled={disabled || confirmAllIn} aria-expanded={panel === "bet"} aria-controls={`${betId}-panel`} onClick={() => setPanel("bet")}>{raise ? "加注" : "下注"}</PokerButton>}
        {!canBet && legal.includes("allin") && <PokerButton ref={betTrigger} tone="danger" disabled={disabled || confirmAllIn} onClick={() => openConfirmation("allin")} aria-expanded={confirmAllIn}>全下</PokerButton>}
      </div>

    </div>}
    {<PokerControlPopover open={acting && panel === "bet" && canBet} onOpenChange={closeBet} trigger={betTrigger} anchor={!compact && popoverContainer ? betAnchor : undefined} container={popoverContainer ?? controlsRef.current} title={raise ? "加注" : "下注"} id={`${betId}-panel`} restoreFocus={panel === null && !confirmAllIn}>
      {betEditor}
    </PokerControlPopover>}
    {!menuTrigger && mine && table.status !== "closed" && <div className="poker-local-menu font-sans text-foreground scheme-light"><Button ref={localMenuTrigger} variant="tertiary" aria-label="更多牌桌操作" aria-expanded={panel === "menu"} aria-controls={menuId} onPress={() => setPanel(panel === "menu" ? null : "menu")}><MoreHorizontal aria-hidden="true" />座位管理</Button></div>}
    <PokerControlPopover open={panel === "menu"} onOpenChange={open => { if (!open) setPanel(null) }} trigger={managementTrigger} container={popoverContainer ?? controlsRef.current} title="更多操作" id={menuId} side={menuTrigger ? "bottom" : "top"} restoreFocus={panel === null && !confirmAllIn}>{mine && sessionControls}{menuContent && <div className="mt-4 space-y-3 border-t border-separator pt-4">{menuContent}</div>}</PokerControlPopover>
    {confirmation}
    {aiOpen && <PokerAIConnectDialog key={`${identityKey}:${table.roomCode}`} open onOpenChange={setAIOpen} roomCode={table.roomCode} table={table} onChanged={onRefresh} />}
  </div>
}
