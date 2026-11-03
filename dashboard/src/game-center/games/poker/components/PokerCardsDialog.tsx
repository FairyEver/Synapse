import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, ChevronLeft, ChevronRight, Clock3, Layers3, Shield, Eye, X } from "lucide-react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import type { usePokerCards } from "../hooks/usePokerCards"
import { cardPlayInput, cardUnavailableReason, validCardSelections } from "../lib/card-view"
import { reconcileCardSelections, type CardSelectionValues } from "../lib/card-selection"
import { amount, remaining, streetLabel } from "../lib/view"
import { Card } from "./Card"
import { PokerAbilityCard, cardFanStyle } from "./PokerAbilityCard"
import { PokerCardStageStatuses } from "./PokerCardStageStatuses"
import { PokerCardIntel } from "./PokerCardIntel"
import { PokerCardCandidates, PokerCardSelection } from "./PokerCardSelection"
import "../styles/cards.css"

type Props = { table: PokerTableView; open: boolean; onOpenChange: (open: boolean) => void; controls: ReturnType<typeof usePokerCards>; disabled: boolean; epoch: string }
type View = "hand" | "inspect" | "intel" | "statuses"

/** A game surface, mounted beside the existing table layout rather than inside the scaled canvas. */
export function PokerCardsDialog(props: Props) {
  const anchor = useRef<HTMLSpanElement>(null), [container, setContainer] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setContainer(anchor.current?.closest<HTMLElement>(".poker-table") ?? document.body) }, [])
  const key = `${props.epoch}:${props.table.controller}:${props.table.mySeatNo}:${props.table.status}:${props.table.cards?.pending?.choiceId ?? ""}`
  return <><span hidden ref={anchor} />{container && createPortal(<CardStageSession key={key} {...props} container={container} />, container)}</>
}
function CardStageSession({ table, open, onOpenChange, controls, disabled, container }: Props & { container: HTMLElement }) {
  const [selected, setSelected] = useState(""), [rawValues, setValues] = useState<CardSelectionValues>({}), [candidate, setCandidate] = useState("")
  const [view, setView] = useState<View>("hand"), [page, setPage] = useState(0)
  const stage = useRef<HTMLDivElement>(null), heading = useId()
  const cards = table.cards, pending = cards?.pending, hand = cards?.ownHand ?? [], card = hand.find(item => item.instanceId === selected)
  const visible = open && !!cards
  const definition = card && cards?.definitions?.[card.cardId], selections = reconcileCardSelections(card?.choices ?? [], rawValues)
  const blocked = disabled || controls.blocked || controls.storageError || !controls.canControl
  const inspect = !pending && view === "inspect" && !!card && !!definition
  const effectiveView = inspect ? "inspect" : view === "inspect" ? "hand" : view
  const pageCount = Math.max(1, Math.ceil(hand.length / 5)), currentPage = Math.min(page, pageCount - 1), displayed = hand.slice(currentPage * 5, currentPage * 5 + 5)
  const validCandidate = pending && candidate !== "" && Number.isInteger(Number(candidate)) && Number(candidate) >= 0 && Number(candidate) < pending.candidates.length
  const candidateInfo = pending?.kind === "ability" && validCandidate ? pending.candidateCards?.[Number(candidate)] : undefined
  const information = effectiveView === "intel" || effectiveView === "statuses"
  const recovery = controls.storageError || controls.uncertain
  const hasPrimary = recovery || !information && (!!pending || inspect)
  const returnLabel = information && pending ? "返回选牌" : information || inspect ? "返回手牌" : "收起卡牌"
  const title = information ? effectiveView === "intel" ? "本人情报" : "牌局状态" : pending ? "选择一张" : inspect ? definition.name : "你的手牌"
  const select = (value: string) => { setSelected(value); setValues({}); setView("inspect") }
  const confirm = () => { if (card && !blocked && card.available && validCardSelections(card, selections)) void controls.play(cardPlayInput(table, card, selections)) }
  const close = () => onOpenChange(false)
  useEffect(() => {
    if (JSON.stringify(rawValues) !== JSON.stringify(selections)) setValues(selections)
  }, [card?.choices, rawValues])
  useEffect(() => { if (candidate && !validCandidate) setCandidate("") }, [candidate, validCandidate])
  useEffect(() => {
    if (!visible) return
    // Focus can stay outside the stage when it opens.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      onOpenChange(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [visible, onOpenChange])
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
        <div className="inspect-emblem" aria-hidden="true" data-card-stage-content="">{effectiveView === "intel" ? <Eye /> : <Shield />}</div>
        <div className="inspect-details" data-card-stage-content=""><div className="inspect-body">{effectiveView === "intel" ? <PokerCardIntel cards={cards} /> : <PokerCardStageStatuses cards={cards} seats={table.seats} />}</div></div>
      </div></main> : pending ? candidateInfo ? <main className="view inspect-view"><div className="inspect-layout">
        <div className="inspect-card" data-card-stage-content=""><PokerAbilityCard definition={candidateInfo} interactive={false} /></div>
        <div className="inspect-details" data-card-stage-content=""><div className="inspect-body"><p className="full-description">{candidateInfo.description}</p><PokerCardCandidates pending={pending} table={table} value={candidate} onChange={setCandidate} disabled={!!blocked || pending.origin !== "card"} compact /></div></div>
      </div></main> : <div className="view"><PokerCardCandidates pending={pending} table={table} value={validCandidate ? candidate : ""} onChange={setCandidate} disabled={!!blocked || pending.origin !== "card"} /></div>
        : inspect ? <main className="view inspect-view"><div className="inspect-layout">
          <div className="inspect-card" data-card-stage-content=""><PokerAbilityCard definition={definition} cost={card.payment.paidAmount ? `${amount(card.payment.paidAmount)} 筹码` : "无需筹码"} interactive={false} /></div>
          <div className="inspect-details" data-card-stage-content=""><div className="inspect-body">
            <p className="full-description">{definition.description}</p>
            {!card.available && <p className="card-unavailable" role="status">{cardUnavailableReason(card.reason)}</p>}
            <PokerCardSelection table={table} definition={definition} choices={card.choices} values={selections} onChange={setValues} disabled={!!blocked || !card.available} />
          </div></div>
        </div></main>
          : <main className="view"><div className="hand-stage">
              {!hand.length ? <p className="choice-empty" data-card-stage-content="">暂无卡牌</p> : <div className="hand-row" key={currentPage} aria-label="持有卡牌">{displayed.map((item, index) => {
                const info = cards.definitions?.[item.cardId]
                return <div className="card-slot is-entering" data-unavailable={!item.available} key={item.instanceId} style={cardFanStyle(index, displayed.length)}>
                  <PokerAbilityCard definition={info} data-held-card={item.instanceId} aria-label={info?.name ?? "卡牌"} onClick={() => select(item.instanceId)} disabled={controls.busy} cost={item.payment.paidAmount ? `${amount(item.payment.paidAmount)} 筹码` : "无需筹码"} />
                  {!item.available && <span className="held-unavailable">{cardUnavailableReason(item.reason)}</span>}
                </div>
              })}</div>}
              {pageCount > 1 && <><button type="button" className="page-arrow previous" aria-label="上一组卡牌" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></button><button type="button" className="page-arrow next" aria-label="下一组卡牌" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight /></button></>}
            </div></main>}
      <footer className="stage-footer" data-card-stage-content="" data-mode={inspect ? "inspect" : information ? "information" : pending ? "candidate" : "hand"} data-has-primary={hasPrimary}>
        <div className="footer-meta">
          {controls.error && <p role="alert" className="stage-error" title={controls.error}>{controls.error}</p>}
          {controls.uncertain && <p role="status" className="stage-error">结果待核对，保留原请求。</p>}
          {pending && pending.origin !== "card" && <p className="stage-error">请在换牌中完成选择</p>}
          {inspect ? <p className="payment">{card.payment.nominalAmount ? <><span>代价 {amount(card.payment.nominalAmount)} 筹码</span>{card.payment.waivedAmount > 0 && <span>豁免 {amount(card.payment.waivedAmount)}</span>}<strong>实付 {amount(card.payment.paidAmount)} 筹码</strong></> : "无需筹码"}</p>
            : !information && <div className="footer-summary"><span className="held-count"><Layers3 aria-hidden="true" /><span>{pending ? validCandidate ? `已选第 ${Number(candidate) + 1} 张` : "请选择一张" : `${hand.length} 张${pageCount > 1 ? ` · ${currentPage + 1}/${pageCount}` : ""}`}</span></span>
              <nav className="stage-links" aria-label="卡牌信息"><button type="button" className="text-action" aria-label="本人情报" onClick={() => setView("intel")}><Eye aria-hidden="true" />情报{cards.privateResults?.filter(result => result.valid).length ? <b>{cards.privateResults.filter(result => result.valid).length}</b> : null}</button><button type="button" className="text-action" aria-label="牌局状态" onClick={() => setView("statuses")}><Shield aria-hidden="true" />状态</button></nav>
            </div>}
        </div>
        <div className="footer-actions">
          <button type="button" className="text-action" aria-label={returnLabel} onClick={information || inspect ? () => setView("hand") : close}>{information || inspect ? <><ArrowLeft aria-hidden="true" />返回</> : "收起"}</button>
          {recovery ? <button type="button" className="game-button" disabled={controls.busy} onClick={() => void controls.retry()}>{controls.busy ? "正在核对…" : controls.storageError ? "重试恢复记录" : "核对原用牌请求"}</button>
            : pending && !information ? <button type="button" className="game-button" disabled={!!blocked || !validCandidate || pending.origin !== "card"} onClick={() => void controls.choose(Number(candidate))}>{controls.busy ? "正在确认…" : "选择这张牌"}</button>
              : inspect && <button type="button" className="game-button" disabled={!!blocked || !card.available || !validCardSelections(card, selections)} onClick={confirm}>{controls.busy ? "正在施放…" : "使用卡牌"}</button>}
        </div>
      </footer>
    </div>
  </div>
}
