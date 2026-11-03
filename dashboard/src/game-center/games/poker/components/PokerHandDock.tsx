import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react"
import { createPortal } from "react-dom"
import type { PokerCardHandView, PokerTableView } from "@synapse/shared/game-contracts"
import { cardArtwork } from "../lib/card-artwork"
import { cardUnavailableReason } from "../lib/card-view"
import { amount } from "../lib/view"
import { Card } from "./Card"
import "../styles/hand-dock.css"

type Preview = { id: string; anchor: HTMLButtonElement; input: "mouse" | "keyboard" | "touch" }
type Drag = { id: string; pointer: number; x: number; y: number; started: boolean }
type Props = { table: PokerTableView; canPlay: boolean; dropArea?: RefObject<HTMLDivElement | null>; onPlay: (card: PokerCardHandView) => void }

export function PokerHandDock({ table, canPlay, dropArea, onPlay }: Props) {
  const hand = table.cards?.ownHand ?? []
  const definitions = table.cards?.definitions
  const [preview, setPreview] = useState<Preview | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const previewBox = useRef<HTMLDivElement>(null)
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number; onTable: boolean } | null>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const pointerType = useRef("")
  const previewId = useId()
  const previewed = preview && hand.find(card => card.instanceId === preview.id)
  const definition = previewed && definitions?.[previewed.cardId]
  const useHint = preview?.input === "touch" ? "再次点按或向上拖动使用"
    : preview?.input === "keyboard" ? "按 Enter 或空格使用" : "拖到牌桌使用"
  const dragged = ghost && hand.find(card => card.instanceId === ghost.id)
  const draggedDefinition = dragged && definitions?.[dragged.cardId]
  const isOnTable = (x: number, y: number) => {
    const bounds = dropArea?.current?.getBoundingClientRect()
    return !!bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
  }
  const isOverTable = !!ghost?.onTable
  useLayoutEffect(() => {
    const element = dropArea?.current
    if (!element || !isOverTable) return
    element.setAttribute("data-card-drop", "")
    return () => element.removeAttribute("data-card-drop")
  }, [dropArea, isOverTable])

  useLayoutEffect(() => {
    if (!preview) return
    const place = () => {
      if (!previewBox.current) return
      const rect = preview.anchor.getBoundingClientRect()
      const dockTop = preview.anchor.closest(".poker-hand-dock")?.getBoundingClientRect().top ?? rect.top
      const { offsetWidth: width, offsetHeight: height } = previewBox.current
      setPosition({ left: Math.max(8, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8)), top: Math.max(8, Math.min(dockTop, rect.top) - height - 10) })
    }
    const outside = (event: Event) => {
      if (preview.input === "touch" && event.target instanceof Node && !preview.anchor.contains(event.target)) setPreview(null)
    }
    place()
    window.addEventListener("pointerdown", outside, true)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("pointerdown", outside, true)
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [preview, definition, previewed?.reason])

  const begin = (event: PointerEvent<HTMLButtonElement>, card: PokerCardHandView) => {
    suppressClick.current = false
    pointerType.current = event.pointerType
    if (!event.isPrimary || event.button !== 0 || !canPlay || !card.available) return
    drag.current = { id: card.instanceId, pointer: event.pointerId, x: event.clientX, y: event.clientY, started: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    if (!current.started) {
      const dy = current.y - event.clientY
      if (event.pointerType === "touch" ? dy < 10 || dy < Math.abs(event.clientX - current.x) : Math.hypot(event.clientX - current.x, dy) < 6) return
      current.started = true
      suppressClick.current = true
      setPreview(null)
    }
    setGhost({ id: current.id, x: event.clientX, y: event.clientY, onTable: isOnTable(event.clientX, event.clientY) })
  }
  const end = (event: PointerEvent<HTMLButtonElement>, card: PokerCardHandView, drop: boolean) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    drag.current = null
    setGhost(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drop || !current.started || !canPlay || !card.available) return
    if (isOnTable(event.clientX, event.clientY)) onPlay(card)
  }

  return <div className="poker-hand-dock" aria-label="手牌区">
    <div className="poker-hand-dock-holes" aria-label="你的底牌" data-card-size="sm">{table.hole?.map((value, index) => <Card key={index} card={value} />)}</div>
    <div className="poker-hand-dock-fan"><div className="poker-hand-dock-cards" role="group" aria-label="能力牌"
      onScroll={() => { if (preview?.input === "touch") setPreview(null) }}>
      {hand.map((card, index) => {
        const info = definitions?.[card.cardId]
        const offset = Math.max(-4, Math.min(4, index - (hand.length - 1) / 2))
        return <button key={card.instanceId} type="button" className="poker-hand-dock-card" aria-label={`${info?.name ?? "能力牌"}，${amount(card.payment.paidAmount)} 筹码`} aria-describedby={previewed === card && definition && !ghost ? previewId : undefined}
          aria-keyshortcuts="Enter Space" aria-haspopup={info?.play && (card.choices.length > 0 || info.play.result !== "table") ? "dialog" : undefined}
          aria-disabled={!canPlay || !card.available} data-dragging={ghost?.id === card.instanceId} style={{ "--hand-tilt": `${offset * 1.2}deg`, "--hand-rise": `${Math.abs(offset) * 1.2}px` } as CSSProperties}
          onPointerEnter={event => { if (event.pointerType === "mouse" && !drag.current) setPreview({ id: card.instanceId, anchor: event.currentTarget, input: "mouse" }) }}
          onPointerLeave={event => { if (event.pointerType === "mouse" && !event.currentTarget.matches(":focus-visible")) setPreview(current => current?.id === card.instanceId ? null : current) }}
          onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setPreview({ id: card.instanceId, anchor: event.currentTarget, input: "keyboard" }) }}
          onBlur={() => setPreview(current => current?.id === card.instanceId ? null : current)}
          onPointerDown={event => begin(event, card)} onPointerMove={move} onPointerUp={event => end(event, card, true)} onPointerCancel={event => end(event, card, false)} onLostPointerCapture={event => end(event, card, false)}
          onKeyDown={event => { if (event.key === "Escape") setPreview(null) }}
          onClick={event => {
            if (event.detail === 0) {
              if (canPlay && card.available) { setPreview(null); onPlay(card) }
              return
            }
            if (suppressClick.current) return
            // A touch tap can preview without preventing the fan's horizontal scroll.
            if (pointerType.current === "touch" || pointerType.current === "pen") {
              if (preview?.id === card.instanceId && preview.input === "touch" && canPlay && card.available) { setPreview(null); onPlay(card) }
              else setPreview({ id: card.instanceId, anchor: event.currentTarget, input: "touch" })
            }
          }}>
          <img src={cardArtwork(card.cardId)} alt="" draggable={false} />
          <span>{info?.name ?? "能力牌"}</span>
          <b className="poker-hand-dock-cost">{amount(card.payment.paidAmount)}</b>
        </button>
      })}
    </div></div>
    {previewed && definition && !ghost && createPortal(<div ref={previewBox} id={previewId} className="poker-hand-dock-preview" role="tooltip" style={position}>
      <div className="poker-hand-dock-face"><img src={cardArtwork(definition.id)} alt="" /><strong>{definition.name}</strong></div>
      <div className="poker-hand-dock-description"><strong>{definition.name}</strong><p>{definition.description}</p>
        <b>{previewed.payment.paidAmount ? `实付 ${amount(previewed.payment.paidAmount)} 筹码` : "无需筹码"}</b>
        <small>{cardUnavailableReason(previewed.reason) ?? (!canPlay ? "等待你的回合" : definition.play?.candidates ? `${useHint} · 亮出候选后不可取消` : useHint)}</small>
      </div>
    </div>, document.body)}
    {ghost && draggedDefinition && createPortal(<div className="poker-hand-dock-ghost" aria-hidden="true" style={{ left: ghost.x, top: ghost.y }}>
      <div className="poker-hand-dock-face"><img src={cardArtwork(draggedDefinition.id)} alt="" /><strong>{draggedDefinition.name}</strong></div>
    </div>, document.body)}
  </div>
}
