import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Clock3, X } from "lucide-react"
import type { PokerCardDefinitionView, PokerCardHandView, PokerResolutionFrameView, PokerTableView } from "@synapse/shared/game-contracts"
import type { usePokerCards } from "../hooks/usePokerCards"
import { cardChoiceBaseline, cardPlayBaseline, cardPlayFeedback, cardPlayInput, cardUnavailableReason, validCardSelections } from "../lib/card-view"
import { reconcileCardSelections, type CardSelectionValues } from "../lib/card-selection"
import { amount, remaining, streetLabel } from "../lib/view"
import { Card } from "./Card"
import { PokerCardIntel } from "./PokerCardIntel"
import { PokerCardCandidates, PokerCardSelection } from "./PokerCardSelection"
import { PokerHandDock } from "./PokerHandDock"
import "../styles/cards.css"

type CardResult = NonNullable<PokerCardDefinitionView["play"]>["result"]
type Submission = { baseline: ReturnType<typeof cardPlayBaseline>; result: CardResult; paid?: number }
type Props = {
  table: PokerTableView
  controls: ReturnType<typeof usePokerCards>
  disabled: boolean
  frames?: readonly PokerResolutionFrameView[]
  dropArea?: RefObject<HTMLDivElement | null>
  onActivate: () => void
  onRefresh: () => void | Promise<void>
  intelOpen?: boolean
  onIntelClose?: () => void
}

export function PokerCardDockFlow({ table, controls, disabled, frames = [], dropArea, onActivate, onRefresh, intelOpen = false, onIntelClose }: Props) {
  const cards = table.cards
  const pending = cards?.pending?.origin === "card" ? cards.pending : null
  const [selected, setSelected] = useState<{ instanceId: string; quote: number } | null>(null)
  const [values, setValues] = useState<CardSelectionValues>({})
  const [candidate, setCandidate] = useState<{ choiceId: string; index: string } | null>(null)
  const [submitted, setSubmitted] = useState<Submission | null>(null)
  const [refreshError, setRefreshError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const card = cards?.ownHand?.find(item => item.instanceId === selected?.instanceId)
  const definition = card && cards?.definitions?.[card.cardId]
  const selections = reconcileCardSelections(card?.choices ?? [], values)
  const quotedPriceChanged = selected && card && selected.quote !== card.payment.paidAmount
  const feedback = cardPlayFeedback(table, submitted?.baseline ?? null, frames)
  const used = submitted && cards?.used.find(item => item.seq === submitted.baseline.seq + 1 && item.seatNo === table.mySeatNo && item.cardId === submitted.baseline.cardId)
  const resultKind = submitted?.result
  const pendingUse = pending && cards?.used.filter(item => item.cardId === pending.sourceCardId && item.seatNo === table.mySeatNo && item.status === "choice_required").at(-1)
  const activeUse = pendingUse || used
  const projectedPayment = activeUse && (table.recentActions.find(action => action.seq === activeUse.seq && action.action === "card_play")?.amount
    ?? frames.find(frame => frame.handId === table.handId && frame.seq === activeUse.seq)?.events.find(event => event.type === "chips.paid")?.amount)
  const paid = projectedPayment ?? submitted?.paid
  const usedResult = !!used && used.status !== "choice_required" && resultKind !== "table" && !!resultKind
  const recovery = controls.storageError || controls.uncertain
  const targetStage = !!card && !!definition && controls.canControl && !pending
  const waitingStage = !!submitted && !targetStage && !pending && !used && !!resultKind && resultKind !== "table"
  const locked = disabled || controls.blocked || controls.storageError || !controls.canControl
  const intel = cards?.privateResults?.filter(result => result.label !== "候选")
  const review = intelOpen && !!intel?.length && !pending && !targetStage && !usedResult && !waitingStage && !recovery
  const open = !!pending || targetStage || usedResult || waitingStage || recovery || review
  const candidateIndex = candidate?.choiceId === pending?.choiceId ? candidate?.index ?? "" : ""
  const cancelTarget = targetStage && !controls.blocked && !recovery && definition.play?.cancelUntil === "target-confirm"
  const dismissible = !pending && !recovery && (cancelTarget || usedResult || review || waitingStage && !!controls.error && !controls.blocked)
  const title = pending ? "选择一张" : usedResult ? resultKind === "holes" ? "换牌完成" : "私密情报"
    : targetStage ? card.choices.some(choice => choice.kind === "player") ? "选择玩家" : "选择要替换的底牌"
    : recovery ? "核对用牌结果" : review ? "私密情报" : "正在使用卡牌…"
  const dialog = useRef<HTMLDialogElement>(null), headingRef = useRef<HTMLHeadingElement>(null), heading = useId()
  const stage = pending ? pending.choiceId : usedResult ? "result" : targetStage ? card.instanceId : recovery ? "recovery" : review ? "intel" : "waiting"

  useLayoutEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [open])
  useEffect(() => { if (open) headingRef.current?.focus() }, [open, stage])

  const reset = () => {
    dialog.current?.close()
    if (intelOpen) onIntelClose?.()
    setSelected(null); setValues({}); setSubmitted(null); setRefreshError(false)
  }
  const send = (next: PokerCardHandView, selectedValues: CardSelectionValues) => {
    if (!validCardSelections(next, selectedValues)) return
    const target = table.seats.find(seat => seat.seatNo === Number(selectedValues.player))?.displayName
    const request = controls.play(cardPlayInput(table, next, selectedValues))
    if (request) setSubmitted({ baseline: cardPlayBaseline(table, next, target), result: cards?.definitions?.[next.cardId]?.play?.result ?? "table", paid: next.payment.paidAmount })
  }
  const activate = (next: PokerCardHandView) => {
    if (locked || open || !next.available) return
    reset()
    onActivate()
    if (next.choices.length) setSelected({ instanceId: next.instanceId, quote: next.payment.paidAmount })
    else send(next, {})
  }
  const confirmTarget = () => {
    if (!card || locked || !card.available || !validCardSelections(card, selections)) return
    if (quotedPriceChanged) { setSelected({ instanceId: card.instanceId, quote: card.payment.paidAmount }); return }
    send(card, selections)
  }
  const choose = () => {
    if (!pending || locked || candidateIndex === "") return
    const request = controls.choose(Number(candidateIndex))
    if (request && !submitted) {
      const baseline = cardChoiceBaseline(table, pending)
      if (baseline) setSubmitted({ baseline, result: (pending.sourceCardId ? cards?.definitions?.[pending.sourceCardId]?.play?.result : undefined) ?? "holes", paid: paid ?? undefined })
    }
  }
  const refresh = async () => {
    setRefreshing(true); setRefreshError(false)
    try { await onRefresh() }
    catch { setRefreshError(true) }
    finally { setRefreshing(false) }
  }

  return <>
    <PokerHandDock table={table} canPlay={!open && !locked} dropArea={dropArea} onPlay={activate} />
    {!open && controls.error && <p className="poker-card-dock-error" role="alert">{controls.error}</p>}
    {open && cards && createPortal(<dialog ref={dialog} className="poker-card-stage card-overlay poker-card-dock-stage" aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (dismissible) reset() }}>
      <div className="poker-card-dock-stage-layout">
        <header className="stage-hud">
          <div className="round-context"><span>第 {table.handNo} 手</span><strong>{streetLabel[table.street ?? ""]}</strong></div>
          <div className="hud-board" aria-label="公共牌">{Array.from({ length: 5 }, (_, index) => <Card key={index} card={table.board[index]} />)}</div>
          <div className="hud-right">{table.deadlineMs != null && <span className="time" role="timer" aria-label="行动剩余时间"><Clock3 aria-hidden="true" />{remaining(table.deadlineMs)}</span>}{dismissible && <button type="button" className="close-overlay" aria-label={review ? "关闭私密情报" : usedResult ? "关闭用牌结果" : "放弃使用"} onClick={reset}><X aria-hidden="true" /></button>}</div>
        </header>
        <div className="poker-card-dock-task-scroll">
          <main className="poker-card-dock-task">
            <div className="stage-heading"><h2 ref={headingRef} tabIndex={-1} id={heading}>{title}</h2></div>
            {pending ? <>
              <p className="poker-card-dock-stage-description" role="status">{pending.cardIndex !== undefined ? `替换第 ${pending.cardIndex + 1} 张底牌 · ` : ""}亮出候选后不可取消</p>
              <PokerCardCandidates pending={pending} table={table} value={candidateIndex} onChange={index => setCandidate({ choiceId: pending.choiceId, index })} disabled={locked} />
            </> : usedResult ? <>
              {resultKind === "holes" && used?.status !== "blocked" && <section className="intel-result"><h3>你的底牌</h3><div className="intel-values">{table.hole?.map((value, index) => <Card key={index} card={value} />)}</div></section>}
              {resultKind === "intel" && feedback?.results.length ? <PokerCardIntel cards={cards} results={feedback.results} target={feedback.target} /> : null}
              {used?.status === "blocked" && <p className="poker-card-dock-stage-description">{feedback?.title ?? "被防护抵挡"}</p>}
            </> : targetStage ? <>
              <p className="poker-card-dock-stage-description">{definition.name} · {definition.description}</p>
              {!card.available && <p className="stage-error" role="status">{cardUnavailableReason(card.reason)}</p>}
              <PokerCardSelection table={table} definition={definition} choices={card.choices} values={selections} onChange={setValues} disabled={locked || !card.available} />
            </> : review ? <PokerCardIntel cards={cards} results={intel} /> : null}
            {controls.error && <p className="stage-error" role="alert">{controls.error}</p>}
            {refreshError && <p className="stage-error" role="alert">刷新牌桌失败</p>}
            <div className="poker-card-dock-stage-actions">
              {!!paid && (pending || usedResult) && <span className="payment">已支付 {amount(paid)} 筹码</span>}
              {recovery ? <button type="button" className="game-button" disabled={controls.busy} onClick={() => void controls.retry()}>{controls.storageError ? "重试恢复记录" : "核对原用牌请求"}</button>
                : pending ? <button type="button" className="game-button" disabled={locked || candidateIndex === ""} onClick={choose}>{controls.busy ? "正在换牌…" : "确认换牌"}</button>
                : usedResult || review ? <button type="button" className="game-button" onClick={reset}>完成</button>
                : targetStage ? <>
                  <span className="payment" role="status">{card.payment.paidAmount ? `${quotedPriceChanged ? "报价已更新 · " : ""}实付 ${amount(card.payment.paidAmount)} 筹码` : "无需筹码"}{definition.play?.candidates ? " · 亮出后不可取消" : ""}</span>
                  <button type="button" className="game-button" disabled={locked || !card.available || !validCardSelections(card, selections)} onClick={confirmTarget}>{controls.busy ? "正在使用…" : quotedPriceChanged ? "采用新报价" : definition.play?.candidates ? "确认并看候选" : "确认目标"}</button>
                  {cancelTarget && <button type="button" className="text-action" onClick={reset}>放弃使用</button>}
                </> : waitingStage && controls.error ? <button type="button" className="game-button" disabled={refreshing} onClick={() => void refresh()}>刷新牌桌</button> : null}
              {pending && controls.error && !recovery && <button type="button" className="text-action" disabled={refreshing} onClick={() => void refresh()}>刷新牌桌</button>}
            </div>
          </main>
        </div>
      </div>
    </dialog>, document.body)}
  </>
}
