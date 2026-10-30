import { useEffect, useId, useRef, useState } from "react"
import { Bot, Clock3, UserRound } from "lucide-react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { PokerButton } from "./PokerButton"
import { useHumanControls, type PokerIntent } from "../hooks/useHumanControls"
import { actionState, betPresets } from "../lib/action-view"
import { amount, remaining } from "../lib/view"

export function HumanControls({ table, perspective, onRefresh, identityKey }: { table: PokerTableView; perspective: "owner" | "public"; onRefresh: () => void | Promise<void>; identityKey?: string }) {
  const { busy, error, to, setTo, uncertain, mine, controller, version, handoff,
    act, retry, control, join, sit, leave, copy, requestAIJoin } = useHumanControls(table, onRefresh, identityKey)
  const [allInAction, setAllInAction] = useState<PokerIntent["action"] | null>(null)
  const confirmAllIn = allInAction !== null
  const betId = useId()
  const allInTrigger = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  useEffect(() => {
    if (wasConfirming.current && !confirmAllIn) allInTrigger.current?.focus()
    wasConfirming.current = confirmAllIn
  }, [confirmAllIn])
  useEffect(() => setAllInAction(null), [table.handId, table.actionSeq, version, perspective])
  const legal = table.legalActions ?? [], numeric = Number(to)
  const validAmount = Number.isSafeInteger(numeric) && numeric >= (table.minRaiseTo ?? Infinity) && numeric <= (table.maxRaiseTo ?? -1)
  const acting = perspective === "owner" && controller === "human" && table.actionOnSeat === table.mySeatNo && table.status === "running" && !!table.handId && version != null
  const disabled = busy || uncertain
  const canBet = legal.includes("bet") || legal.includes("raise")
  const raise = legal.includes("raise")
  const state = perspective === "public" && controller === "human" && table.actionOnSeat === table.mySeatNo && table.status === "running" ? "旁观视角 · 切回玩家视角出牌" : actionState(table, acting, handoff)
  const presets = betPresets(table)
  const submit = (action: PokerIntent["action"]) => {
    const contribution = action === "allin" ? mine?.stack ?? 0 : action === "call" ? table.toCall ?? 0 : action === "bet" || action === "raise" ? numeric - (mine?.streetBet ?? 0) : 0
    if (mine && mine.stack > 0 && contribution >= mine.stack) setAllInAction(action)
    else act(action)
  }
  const confirmation = <div className="poker-allin-confirm"><PokerButton autoFocus disabled={disabled} onClick={() => setAllInAction(null)}>取消</PokerButton><PokerButton tone="danger" disabled={disabled} onClick={() => { if (allInAction) act(allInAction) }}>确认全下 {amount(mine?.stack ?? 0)}</PokerButton></div>
  return <div className="poker-human-controls" data-acting={acting} aria-label="本人牌桌操作" onKeyDown={event => { if (event.key === "Escape" && confirmAllIn) { event.stopPropagation(); setAllInAction(null) } }}>
    <div className="poker-control-state"><span className="poker-action-indicator" aria-hidden="true" /><span role="status">{state}</span>{acting && table.deadlineMs != null && <span className="poker-action-clock" role="timer" aria-live="off" aria-label="行动剩余时间"><Clock3 aria-hidden="true" />{remaining(table.deadlineMs)}</span>}</div>
    {error && <p role="alert">{error}{uncertain && "，请重试确认结果"}</p>}
    {uncertain && <PokerButton disabled={busy} onClick={retry}>重试出牌</PokerButton>}
    {acting && <div className="poker-action-dock">
      <div className="poker-action-buttons">
        {legal.includes("fold") && <PokerButton className="poker-fold-action" disabled={disabled} onClick={() => act("fold")}>弃牌</PokerButton>}
        {legal.includes("check") && <PokerButton tone="primary" disabled={disabled} onClick={() => act("check")}>过牌<span>无需跟注</span></PokerButton>}
        {legal.includes("call") && <PokerButton tone="primary" disabled={disabled} onClick={() => submit("call")}>跟注 {amount(table.toCall ?? 0)}</PokerButton>}
        {canBet && <PokerButton className="poker-raise-action" disabled={disabled || !validAmount} onClick={() => submit(raise ? "raise" : "bet")} aria-label={`${raise ? "加注" : "下注"} ${amount(numeric)}`}>{raise ? "加注" : "下注"}<span>到 {amount(Number.isFinite(numeric) ? numeric : 0)}</span></PokerButton>}
      </div>
      {canBet && <div className="poker-bet-editor">{confirmAllIn ? confirmation : <>
        <div className="poker-bet-input"><label htmlFor={betId}>{raise ? "加注到" : "下注到"}</label><input id={betId} type="number" inputMode="numeric" min={table.minRaiseTo} max={table.maxRaiseTo} step={1} value={to} disabled={disabled} aria-invalid={!validAmount} onChange={e => setTo(e.target.value)} /><input type="range" aria-label="下注金额" min={table.minRaiseTo ?? 0} max={table.maxRaiseTo ?? 0} step={1} value={Number.isFinite(numeric) ? Math.min(table.maxRaiseTo ?? 0, Math.max(table.minRaiseTo ?? 0,numeric)) : table.minRaiseTo ?? 0} disabled={disabled} onChange={e => setTo(e.target.value)} /></div>
        <div className="poker-bet-presets">{presets.map(preset => <PokerButton key={preset.label} disabled={disabled} onClick={() => setTo(String(preset.to))}>{preset.label}</PokerButton>)}{legal.includes("allin") && <PokerButton ref={allInTrigger} tone="danger" disabled={disabled} onClick={() => setAllInAction("allin")} aria-expanded={confirmAllIn}>全下</PokerButton>}</div>
      </>}</div>}
      {!canBet && legal.includes("allin") && (confirmAllIn ? confirmation : <PokerButton ref={allInTrigger} tone="danger" disabled={disabled} onClick={() => setAllInAction("allin")} aria-expanded={confirmAllIn}>全下</PokerButton>)}
    </div>}
    <div className="poker-seat-controls">
      {!mine && table.status !== "closed" && <><PokerButton tone="primary" disabled={busy || table.seats.length >= table.maxSeats} onClick={join}><UserRound aria-hidden="true" />本人入座</PokerButton>{handoff ? <><PokerButton onClick={() => void copy()}>复制 AI 接入指令</PokerButton><PokerButton disabled={busy} onClick={() => control("cancel_ai")}>取消 AI 接入</PokerButton></> : <PokerButton disabled={busy || version == null} onClick={requestAIJoin}><Bot aria-hidden="true" />接入 AI</PokerButton>}</>}
      {mine && table.status !== "closed" && <>
        {controller !== "human" ? <PokerButton tone="primary" disabled={disabled || version == null} onClick={() => control("takeover")}>本人接管</PokerButton> : handoff ? <PokerButton disabled={disabled} onClick={() => control("cancel_ai")}>取消 AI 接管</PokerButton> : <PokerButton disabled={disabled || version == null} onClick={() => control("request_ai")}>交给 AI</PokerButton>}
        {handoff && <PokerButton onClick={() => void copy()}>复制 AI 接入指令</PokerButton>}
        <PokerButton disabled={disabled || version == null || controller !== "human"} onClick={sit}>{mine.status === "sitting_out" ? "回到牌桌" : table.pauseReason === "user" ? "本手后暂离" : "暂离"}</PokerButton>
        <PokerButton disabled={disabled || version == null || controller !== "human"} onClick={leave}>离桌</PokerButton>
      </>}
    </div>
    {handoff && <p className="poker-connect-help">复制接入指令，发给你的 AI；连接后接手当前座位。</p>}
  </div>
}
