import { useId, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react"
import { createPortal } from "react-dom"
import gsap from "gsap"
import { useReducedMotion } from "../hooks/useReducedMotion"
import type { PokerCardHandView, PokerTableView } from "@synapse/shared/game-contracts"
import { PokerAbilityDetails, PokerAbilityFace } from "./PokerAbilityDetails"
import { cardUnavailableReason } from "../lib/card-view"
import { amount } from "../lib/view"
import "../styles/hand-dock.css"

type Preview = { id: string; anchor: HTMLButtonElement; input: "mouse" | "keyboard" | "touch" }
type PreviewPosition = { left: number; bottom: number; maxHeight: number }
type Drag = { id: string; pointer: number; x: number; y: number; started: boolean; anchor: HTMLButtonElement }
type Props = { table: PokerTableView; canPlay: boolean; dropArea?: RefObject<HTMLDivElement | null>; onPlay: (card: PokerCardHandView) => void }

export function PokerHandDock({ table, canPlay, dropArea, onPlay }: Props) {
  const hand = table.cards?.ownHand ?? []
  const definitions = table.cards?.definitions
  const [preview, setPreview] = useState<Preview | null>(null)
  const [position, setPosition] = useState<PreviewPosition | null>(null)
  const previewBox = useRef<HTMLDivElement>(null)
  const closePreview = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number; onTable: boolean } | null>(null)
  const drag = useRef<Drag | null>(null)
  const ghostFace = useRef<HTMLDivElement>(null)
  const tiltGhost = useRef<ReturnType<typeof gsap.quickTo> | null>(null)
  const lastGhostX = useRef(0)
  const reduced = useReducedMotion()
  const [landing, setLanding] = useState<{ x: number; y: number; scale: number; accepted: boolean } | null>(null)
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
  const isOverTable = !landing && !!ghost?.onTable
  const hasGhost = !!ghost
  useLayoutEffect(() => {
    const face = ghostFace.current
    if (!hasGhost || !face || reduced) return
    const sourceWidth = drag.current?.anchor.getBoundingClientRect().width
    const startScale = sourceWidth && face.offsetWidth ? Math.min(1, sourceWidth / face.offsetWidth) : .84
    const lift = gsap.fromTo(face, { scale: startScale }, { scale: 1, duration: .18, ease: "power2.out" })
    tiltGhost.current = gsap.quickTo(face, "rotation", { duration: .15, ease: "power2.out" })
    return () => {
      lift.kill()
      tiltGhost.current?.tween.kill()
      tiltGhost.current = null
      gsap.set(face, { clearProps: "transform,opacity" })
    }
  }, [hasGhost, reduced])
  useLayoutEffect(() => {
    const face = ghostFace.current
    if (!landing || !face || reduced) return
    tiltGhost.current?.tween.pause()
    const tween = gsap.to(face, {
      x: landing.x, y: landing.y, scale: landing.scale, rotation: 0,
      opacity: landing.accepted ? .25 : 1, duration: landing.accepted ? .17 : .24,
      ease: "power2.out", onComplete: () => { setLanding(null); setGhost(null) },
    })
    return () => { tween.kill() }
  }, [landing, reduced])
  useLayoutEffect(() => {
    if (!landing || hasGhost && draggedDefinition && !reduced) return
    setLanding(null); setGhost(null)
  }, [landing, hasGhost, draggedDefinition, reduced])
  useLayoutEffect(() => {
    const element = dropArea?.current
    if (!element || !isOverTable) return
    element.setAttribute("data-card-drop", "")
    return () => element.removeAttribute("data-card-drop")
  }, [dropArea, isOverTable])

  // Repositioning after a new table snapshot must not cancel a pending pointer leave.
  useLayoutEffect(() => () => clearTimeout(closePreview.current), [])
  useLayoutEffect(() => {
    if (!preview) return
    const place = () => {
      if (!previewBox.current) return
      const rect = preview.anchor.getBoundingClientRect()
      const dockTop = preview.anchor.closest(".poker-hand-dock")?.getBoundingClientRect().top ?? rect.top
      const { offsetWidth: width } = previewBox.current
      // Keep the tooltip above the lifted card and its fee badge, even when its content needs to scroll.
      const bottomEdge = Math.max(0, Math.min(dockTop, rect.top, window.innerHeight) - 16)
      setPosition({
        left: Math.max(8, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8)),
        bottom: window.innerHeight - bottomEdge,
        maxHeight: Math.max(0, bottomEdge - 8),
      })
    }
    const outside = (event: Event) => {
      if (preview.input === "touch" && event.target instanceof Node && !preview.anchor.contains(event.target) && !previewBox.current?.contains(event.target)) setPreview(null)
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

  const keepPreview = () => clearTimeout(closePreview.current)
  const leavePreview = () => {
    keepPreview()
    closePreview.current = setTimeout(() => setPreview(current => current?.input === "mouse" ? null : current), 160)
  }

  const begin = (event: PointerEvent<HTMLButtonElement>, card: PokerCardHandView) => {
    suppressClick.current = false
    pointerType.current = event.pointerType
    if (!event.isPrimary || event.button !== 0 || !canPlay || !card.available) return
    setLanding(null); setGhost(null)
    lastGhostX.current = event.clientX
    drag.current = { id: card.instanceId, pointer: event.pointerId, x: event.clientX, y: event.clientY, started: false, anchor: event.currentTarget }
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
    const delta = event.clientX - lastGhostX.current
    lastGhostX.current = event.clientX
    tiltGhost.current?.(Math.max(-11, Math.min(11, delta * .55)))
    setGhost({ id: current.id, x: event.clientX, y: event.clientY, onTable: isOnTable(event.clientX, event.clientY) })
  }
  const finishDrag = (current: Drag, accepted: boolean) => {
    drag.current = null
    if (current.anchor.hasPointerCapture(current.pointer)) current.anchor.releasePointerCapture(current.pointer)
    if (current.started && ghost && !reduced && ghostFace.current) {
      const target = current.anchor.getBoundingClientRect()
      const floating = ghostFace.current.getBoundingClientRect()
      setLanding({
        x: accepted ? 0 : target.left + target.width / 2 - (floating.left + floating.width / 2),
        y: accepted ? 12 : target.top + target.height / 2 - (floating.top + floating.height / 2),
        scale: accepted ? .9 : target.width / (ghostFace.current.offsetWidth || target.width || 1), accepted,
      })
    } else setGhost(null)
  }
  const end = (event: PointerEvent<HTMLButtonElement>, card: PokerCardHandView, drop: boolean) => {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    const accepted = drop && current.started && canPlay && card.available && isOnTable(event.clientX, event.clientY)
    finishDrag(current, accepted)
    if (accepted) onPlay(card)
  }

  if (!hand.length) return null

  return <div className="poker-hand-dock">
    <div className="poker-hand-dock-cards" role="group" aria-label="能力牌"
      onScroll={() => { if (preview?.input === "touch") setPreview(null) }}>
      {hand.map(card => {
        const info = definitions?.[card.cardId]
        return <button key={card.instanceId} type="button" className="poker-hand-dock-card" aria-label={`${info?.name ?? "能力牌"}，${amount(card.payment.paidAmount)} 筹码`} aria-describedby={previewed === card && definition && !ghost ? previewId : undefined}
          aria-keyshortcuts="Enter Space" aria-haspopup={info?.play && (card.choices.length > 0 || info.play.result !== "table") ? "dialog" : undefined}
          aria-disabled={!canPlay || !card.available} data-dragging={ghost?.id === card.instanceId} data-card-motion-anchor={`ability:${card.instanceId}`}
          onPointerEnter={event => { if (event.pointerType === "mouse" && !drag.current) { keepPreview(); setPreview({ id: card.instanceId, anchor: event.currentTarget, input: "mouse" }) } }}
          onPointerLeave={event => { if (event.pointerType === "mouse") leavePreview() }}
          onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setPreview({ id: card.instanceId, anchor: event.currentTarget, input: "keyboard" }) }}
          onBlur={() => setPreview(current => current?.id === card.instanceId ? null : current)}
          onPointerDown={event => begin(event, card)} onPointerMove={move} onPointerUp={event => end(event, card, true)} onPointerCancel={event => end(event, card, false)} onLostPointerCapture={event => end(event, card, false)}
          onKeyDown={event => {
            if (event.key !== "Escape") return
            setPreview(null)
            if (drag.current?.started) {
              event.stopPropagation()
              finishDrag(drag.current, false)
            }
          }}
          onClick={event => {
            if (event.detail === 0) {
              if (canPlay && card.available) { setPreview(null); onPlay(card) }
              return
            }
            if (suppressClick.current) return
            // A touch tap can preview without preventing horizontal scrolling.
            if (pointerType.current === "touch" || pointerType.current === "pen") {
              if (preview?.id === card.instanceId && preview.input === "touch" && canPlay && card.available) { setPreview(null); onPlay(card) }
              else setPreview({ id: card.instanceId, anchor: event.currentTarget, input: "touch" })
            }
          }}>
          <PokerAbilityFace name={info?.name ?? "能力牌"} artId={info?.artId ?? card.cardId} size="sm">
            <b className="poker-hand-dock-cost">{amount(card.payment.paidAmount)}</b>
          </PokerAbilityFace>
        </button>
      })}
    </div>
    {previewed && definition && !ghost && createPortal(<div ref={previewBox} id={previewId} className="poker-hand-dock-preview" role="tooltip"
      data-compact={!!position && position.maxHeight < 220} style={position ?? { visibility: "hidden" }}
      onPointerEnter={keepPreview} onPointerLeave={leavePreview}>
      <PokerAbilityDetails name={definition.name} artId={definition.artId} description={definition.description}>
        <b className="text-accent-soft-foreground">{previewed.payment.paidAmount ? `实付 ${amount(previewed.payment.paidAmount)} 筹码` : "无需筹码"}</b>
        <small className="text-muted">{cardUnavailableReason(previewed.reason) ?? (!canPlay ? "等待你的回合" : definition.play?.candidates ? `${useHint} · 亮出候选后不可取消` : useHint)}</small>
      </PokerAbilityDetails>
    </div>, document.body)}
    {ghost && draggedDefinition && createPortal(<div className="poker-hand-dock-ghost" aria-hidden="true" style={{ left: ghost.x, top: ghost.y }}>
      <div ref={ghostFace}><PokerAbilityFace name={draggedDefinition.name} artId={draggedDefinition.artId} size="lg" /></div>
    </div>, document.body)}
  </div>
}
