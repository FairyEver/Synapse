import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, ChevronLeft, ChevronRight, Clock3, Layers3, Shield, Eye, Sparkles, X } from "lucide-react"
import type { PokerResolutionFrameView, PokerTableView } from "@synapse/shared/game-contracts"
import type { usePokerCards } from "../hooks/usePokerCards"
import { cardChoiceBaseline, cardConfirmLabel, cardPlayBaseline, cardPlayFeedback, cardPlayInput, cardUnavailableReason, validCardSelections } from "../lib/card-view"
import { reconcileCardSelections, type CardSelectionValues } from "../lib/card-selection"
import { amount, playingCardLabel, remaining, streetLabel } from "../lib/view"
import { Card } from "./Card"
import { PokerAbilityCard, cardFanStyle } from "./PokerAbilityCard"
import { PokerCardStageStatuses } from "./PokerCardStageStatuses"
import { PokerCardIntel } from "./PokerCardIntel"
import { PokerCardCandidates, PokerCardSelection } from "./PokerCardSelection"
import "../styles/cards.css"

type Props = { table: PokerTableView; open: boolean; onOpenChange: (open: boolean) => void; controls: ReturnType<typeof usePokerCards>; disabled: boolean; epoch: string; frames?: readonly PokerResolutionFrameView[] }
type View = "hand" | "inspect" | "intel" | "statuses"

/** A game surface, mounted beside the existing table layout rather than inside the scaled canvas. */
export function PokerCardsDialog(props: Props) {
  const anchor = useRef<HTMLSpanElement>(null), [container, setContainer] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setContainer(anchor.current?.closest<HTMLElement>(".poker-table") ?? document.body) }, [])
  const key = `${props.epoch}:${props.table.controller}:${props.table.mySeatNo}:${props.table.status}`
  return <><span hidden ref={anchor} />{container && createPortal(<CardStageSession key={key} {...props} container={container} />, container)}</>
}
function CardStageSession({ table, open, onOpenChange, controls, disabled, container, frames = [] }: Props & { container: HTMLElement }) {
  const [selected, setSelected] = useState(""), [rawValues, setValues] = useState<CardSelectionValues>({}), [picked, setPicked] = useState<{ choiceId: string; seq?: number; value: string } | null>(null)
  const [view, setView] = useState<View>("hand"), [page, setPage] = useState(0)
  const [selectedAt, setSelectedAt] = useState(table.actionSeq)
  const [submitted, setSubmitted] = useState<ReturnType<typeof cardPlayBaseline> | null>(null)
  const stage = useRef<HTMLDivElement>(null), heading = useId()
  const playButton = useRef<HTMLButtonElement>(null)
  const cards = table.cards, pending = cards?.pending, hand = cards?.ownHand ?? [], card = hand.find(item => item.instanceId === selected)
  const candidate = picked?.choiceId === pending?.choiceId && picked?.seq === table.actionSeq ? picked?.value ?? "" : ""
  const setCandidate = (value: string) => { if (pending) setPicked({ choiceId: pending.choiceId, seq: table.actionSeq, value }) }
  const visible = open && !!cards
  const definition = card && cards?.definitions?.[card.cardId], selections = reconcileCardSelections(card?.choices ?? [], rawValues)
  const blocked = disabled || controls.blocked || controls.storageError || !controls.canControl
  const inspect = !pending && view === "inspect" && selectedAt === table.actionSeq && !!card && !!definition
  const effectiveView = inspect ? "inspect" : view === "inspect" ? "hand" : view
  const feedback = cardPlayFeedback(table, submitted, frames)
  const showResult = !pending && view === "inspect" && !!(feedback?.results.length || feedback?.changedHole || feedback?.revealed.length)
  const pageCount = Math.max(1, Math.ceil(hand.length / 5)), currentPage = Math.min(page, pageCount - 1), displayed = hand.slice(currentPage * 5, currentPage * 5 + 5)
  const validCandidate = pending && candidate !== "" && Number.isInteger(Number(candidate)) && Number(candidate) >= 0 && Number(candidate) < pending.candidates.length
  const candidateInfo = pending?.kind === "ability" && validCandidate ? pending.candidateCards?.[Number(candidate)] : undefined
  const information = showResult || effectiveView === "intel" || effectiveView === "statuses"
  const recovery = controls.storageError || controls.uncertain
  const hasFooterPrimary = !inspect && (recovery || !information && !!pending)
  const returnLabel = information && pending ? "返回选牌" : information ? "返回手牌" : "收起卡牌"
  const title = showResult ? "用牌结果" : information ? effectiveView === "intel" ? "本人情报" : "牌局状态" : pending ? "选择一张" : inspect ? definition.name : "你的手牌"
  const select = (value: string) => { setSubmitted(null); setSelectedAt(table.actionSeq); setSelected(value); setValues({}); setView("inspect") }
  const confirm = () => {
    if (!card || blocked || !card.available || !validCardSelections(card, selections)) return
    const target = table.seats.find(seat => seat.seatNo === Number(selections.player))?.displayName
    setSubmitted(cardPlayBaseline(table, card, target))
    void controls.play(cardPlayInput(table, card, selections))
  }
  const choose = () => {
    if (!pending || !validCandidate || blocked) return
    if (!submitted) setSubmitted(cardChoiceBaseline(table, pending))
    setView("inspect")
    void controls.choose(Number(candidate))
  }
  const close = () => {
    if (submitted && !pending) { setSubmitted(null); setView("hand") }
    onOpenChange(false)
  }
  const recoveryButton = recovery ? <button type="button" className="game-button" disabled={controls.busy} onClick={() => void controls.retry()}>{controls.busy ? "正在核对…" : controls.storageError ? "重试恢复记录" : "核对原用牌请求"}</button> : null
  useEffect(() => {
    if (JSON.stringify(rawValues) !== JSON.stringify(selections)) setValues(selections)
  }, [card?.choices, rawValues])
  useEffect(() => { if (picked && (picked.choiceId !== pending?.choiceId || !validCandidate)) setPicked(null) }, [picked, pending?.choiceId, validCandidate])
  useEffect(() => {
    if (!visible) return
    // Focus can stay outside the stage when it opens.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (event.key === "Escape") {
        event.preventDefault()
        if (event.repeat) return
        if (inspect || showResult) setView("hand")
        else close()
        return
      }
      const button = playButton.current
      if (event.key !== "Enter" || !button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      // Keep native activation for other actions and targets that are still unselected.
      if (event.target instanceof HTMLButtonElement && event.target !== button && event.target.getAttribute("aria-pressed") !== "true") return
      event.preventDefault()
      if (!event.repeat) button.click()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [visible, inspect, showResult, submitted, onOpenChange])
  // Block the table behind the stage without moving or restoring pointer focus.
  useLayoutEffect(() => {
    if (!open || !stage.current) return
    const siblings = [...container.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== stage.current)
    const prior = siblings.map(element => [element, element.inert] as const)
    for (const element of siblings) element.inert = true
    return () => { for (const [element, inert] of prior) element.inert = inert }
  }, [open, container])
  if (!open || !cards) return null
  return <div className="poker-card-stage card-overlay" data-standalone={container === document.body} ref={stage} role="dialog" aria-modal="true" aria-labelledby={heading} onClick={event => {
    if (event.target instanceof Element && !event.target.closest("button, [data-card-stage-content]")) close()
  }}>
    <div className="overlay-layout">
      <header className="stage-top">
        <div className="stage-hud" data-card-stage-content="">
          <div className="round-context"><span>第 {table.handNo} 手</span><strong>{streetLabel[table.street ?? ""]}</strong></div>
          <div className="hud-board" aria-label="卡牌面板公共牌"><span className="hud-board-label">公共牌</span>{Array.from({ length: 5 }, (_, index) => <Card key={index} card={table.board[index]} />)}</div>
          <div className="hud-right">{table.deadlineMs != null && <span className="time" role="timer" aria-label="行动剩余时间"><Clock3 aria-hidden="true" />{remaining(table.deadlineMs)}</span>}<button type="button" className="close-overlay" aria-label="关闭卡牌" onClick={close}><X aria-hidden="true" /></button></div>
        </div>
        <div className="stage-heading" data-inspect={inspect}><h2 id={heading} data-card-stage-content="">{title}</h2></div>
      </header>
      {information ? <main className="view inspect-view"><div className="inspect-layout">
        <div className="inspect-emblem" aria-hidden="true" data-card-stage-content="">{showResult || effectiveView === "intel" ? <Eye /> : <Shield />}</div>
        <div className="inspect-details" data-card-stage-content=""><div className="inspect-body">
          {showResult && feedback ? <>
            {feedback.changedHole && <section className="intel-result"><h3>你的底牌</h3><div className="intel-values">{feedback.changedHole.map((value, index) => <Card key={index} card={value} />)}</div></section>}
            {feedback.revealed.map((reveal, index) => <section className="intel-result" key={index}><h3>{table.seats.find(seat => seat.seatNo === reveal.seatNo)?.displayName ?? "公开底牌"}</h3><div className="intel-values">{reveal.cards.map((value, slot) => <Card key={slot} card={value} />)}</div></section>)}
            {feedback.results.length > 0 && <PokerCardIntel cards={cards} results={feedback.results} target={feedback.target} />}
          </> : effectiveView === "intel" ? <PokerCardIntel cards={cards} /> : <PokerCardStageStatuses cards={cards} seats={table.seats} />}
        </div></div>
      </div></main> : pending ? candidateInfo ? <main className="view inspect-view"><div className="inspect-layout">
        <div className="inspect-card" data-card-stage-content=""><PokerAbilityCard definition={candidateInfo} interactive={false} /></div>
        <div className="inspect-details" data-card-stage-content=""><div className="inspect-body"><p className="full-description">{candidateInfo.description}</p><PokerCardCandidates pending={pending} table={table} value={candidate} onChange={setCandidate} disabled={!!blocked || pending.origin !== "card"} compact /></div></div>
      </div></main> : <div className="view"><PokerCardCandidates pending={pending} table={table} value={validCandidate ? candidate : ""} onChange={setCandidate} disabled={!!blocked || pending.origin !== "card"} /></div>
        : inspect ? <main className="view inspect-view"><div className="inspect-layout">
          <div className="inspect-card" data-card-stage-content=""><PokerAbilityCard definition={definition} interactive={false} /></div>
          <div className="inspect-details" data-card-stage-content=""><div className="inspect-body">
            <p className="full-description">{definition.description}</p>
            {!card.available && <p className="card-unavailable" role="status">{cardUnavailableReason(card.reason)}</p>}
            <PokerCardSelection table={table} definition={definition} choices={card.choices.filter(choice => choice.options.length > 0)} values={selections} onChange={setValues} disabled={!!blocked || !card.available} />
            <div className="inspect-actions">
              <button type="button" className="text-action" aria-label="返回手牌" aria-keyshortcuts="Escape" onClick={() => setView("hand")}><ArrowLeft aria-hidden="true" />返回</button>
              {recoveryButton ?? <button ref={playButton} type="button" className="game-button" aria-keyshortcuts="Enter" disabled={!!blocked || !card.available || !validCardSelections(card, selections)} onClick={confirm}>{controls.busy ? "正在使用…" : cardConfirmLabel(card.payment.paidAmount)}</button>}
            </div>
          </div></div>
        </div></main>
          : <main className="view"><div className="hand-stage">
              {!hand.length ? <p className="choice-empty" data-card-stage-content="">暂无卡牌</p> : <div className="hand-row" key={currentPage} aria-label="持有卡牌">{displayed.map((item, index) => {
                const info = cards.definitions?.[item.cardId]
                return <div className="card-slot is-entering" data-unavailable={!item.available} key={item.instanceId} style={cardFanStyle(index, displayed.length)}>
                  <PokerAbilityCard definition={info} data-held-card={item.instanceId} aria-label={info?.name ?? "卡牌"} onClick={() => select(item.instanceId)} disabled={controls.busy} cost={item.payment.paidAmount ? `${amount(item.payment.paidAmount)} 筹码` : undefined} />
                  {!item.available && <span className="held-unavailable">{cardUnavailableReason(item.reason)}</span>}
                </div>
              })}</div>}
              {pageCount > 1 && <><button type="button" className="page-arrow previous" aria-label="上一组卡牌" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></button><button type="button" className="page-arrow next" aria-label="下一组卡牌" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight /></button></>}
            </div></main>}
      <footer className="stage-footer" data-card-stage-content="" data-mode={inspect ? "inspect" : information ? "information" : pending ? "candidate" : "hand"} data-has-primary={hasFooterPrimary}>
        <div className="footer-meta">
          {!inspect && !pending && feedback && <p className={feedback.spark ? "poker-card-feedback" : "stage-error"} data-kind={feedback.spark ? "spark" : undefined} role="status">{feedback.spark && <Sparkles aria-hidden="true" />}{feedback.title}</p>}
          {controls.error && <p role="alert" className="stage-error" title={controls.error}>{controls.error}</p>}
          {controls.uncertain && <p role="status" className="stage-error">结果待核对，保留原请求。</p>}
          {pending && pending.origin !== "card" && <p className="stage-error">请在换牌中完成选择</p>}
          {!inspect && !information && <div className="footer-summary">{(!pending || pending.kind === "poker" && pending.cardIndex !== undefined) && <span className="held-count"><Layers3 aria-hidden="true" /><span>{pending && pending.cardIndex !== undefined
                ? `替换底牌 ${pending.cardIndex + 1} · ${playingCardLabel(table.hole?.[pending.cardIndex])}`
                : `${hand.length} 张${pageCount > 1 ? ` · ${currentPage + 1}/${pageCount}` : ""}`}</span></span>}
              <nav className="stage-links" aria-label="卡牌信息"><button type="button" className="text-action" aria-label="本人情报" onClick={() => setView("intel")}><Eye aria-hidden="true" />情报{cards.privateResults?.filter(result => result.valid).length ? <b>{cards.privateResults.filter(result => result.valid).length}</b> : null}</button><button type="button" className="text-action" aria-label="牌局状态" onClick={() => setView("statuses")}><Shield aria-hidden="true" />状态</button></nav>
            </div>}
        </div>
        {!inspect && <div className="footer-actions">
          <button type="button" className="text-action" aria-label={returnLabel} onClick={information ? () => setView("hand") : close}>{information ? <><ArrowLeft aria-hidden="true" />返回</> : "收起"}</button>
          {recoveryButton ?? (pending && !information && <button type="button" className="game-button" disabled={!!blocked || !validCandidate || pending.origin !== "card"} onClick={choose}>{controls.busy ? "正在确认…" : "确定"}</button>)}
        </div>}
      </footer>
    </div>
  </div>
}
