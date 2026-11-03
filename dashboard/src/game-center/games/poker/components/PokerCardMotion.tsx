import { useLayoutEffect, useRef, type RefObject } from "react"
import { createPortal } from "react-dom"
import gsap from "gsap"
import type { PokerCardMotionBatch } from "../lib/table-card-motion"
import { Card } from "./Card"
import { PokerAbilityFace } from "./PokerAbilityDetails"
import "../styles/card-motion.css"

type Props = {
  surface: RefObject<HTMLElement | null>
  batch: PokerCardMotionBatch | null
  mySeat: number | null
  paymentPending: boolean
  insideSurface?: boolean
  onComplete: (batch: PokerCardMotionBatch) => void
}

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

export function PokerCardMotion({ surface, batch, mySeat, paymentPending, insideSurface = false, onComplete }: Props) {
  const layer = useRef<HTMLDivElement>(null)
  const templates = useRef<HTMLDivElement>(null)
  const active = useRef<gsap.core.Timeline | null>(null)
  const waitingForChips = useRef(false)
  const pendingChips = useRef(paymentPending)
  pendingChips.current = paymentPending
  const oldCards = new Set(batch?.changes.flatMap(change => Object.values(change.oldCards ?? {}).flatMap(cards => Object.values(cards))))

  useLayoutEffect(() => {
    const root = surface.current, host = layer.current, sources = templates.current
    if (!batch || !root || !host || !sources) return
    const anchor = (name: string) => root.querySelector<HTMLElement>(`[data-card-motion-anchor="${CSS.escape(name)}"]`)
    const hole = (seat: number, index: number) => root.querySelector<HTMLElement>(`[data-seat="${seat}"] :is(.poker-seat-cards, .poker-result-hole-cards) > :nth-child(${index + 1})`)
    const usable = (element?: HTMLElement | null) => {
      const rect = element?.getBoundingClientRect()
      return rect?.width && rect.height ? rect : null
    }
    const sprite = (visual: HTMLElement, start: DOMRect, end: DOMRect) => {
      const piece = document.createElement("span")
      piece.className = "poker-motion-piece"
      const face = visual.cloneNode(true) as HTMLElement
      // The live slot is concealed during transit. Its copy must stay visible.
      face.style.removeProperty("opacity")
      piece.append(face)
      host.append(piece)
      const from = center(start)
      gsap.set(piece, { x: from.x, y: from.y, xPercent: -50, yPercent: -50, width: end.width, height: end.height, "--cw": `${end.width}px`, opacity: 0 })
      return piece
    }

    const context = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } })
      active.current = tl
      const deck = anchor("poker-deck"), castZone = anchor("cast-zone")
      const deckRect = usable(deck), castRect = usable(castZone)
      const back = sources.querySelector<HTMLElement>(".poker-card")!
      const hidden = new Set<HTMLElement>()
      const conceal = (element: HTMLElement) => {
        if (!hidden.has(element)) gsap.set(element, { opacity: 0 })
        hidden.add(element)
      }
      const fly = (visual: HTMLElement, from: DOMRect, to: DOMRect, at: number, duration: number,
        options: { flip?: "up" | "down"; phase?: "return" | "draw"; hold?: boolean } = {}) => {
        const piece = sprite(visual, from, to)
        const target = center(to)
        const startScale = from.width / to.width
        if (options.phase) piece.dataset.motionPhase = options.phase
        if (options.hold) gsap.set(piece, { opacity: 1, scale: startScale })
        const face = options.flip ? piece.querySelector(".poker-card-turn") : null
        if (face) {
          const revealing = options.flip === "up"
          gsap.set(face, { rotationY: revealing ? 180 : 0 })
          tl.to(face, { rotationY: revealing ? 0 : 180, duration: .16, ease: "power1.inOut" }, revealing ? at + duration - .16 : at)
        }
        tl.set(piece, { opacity: 1, rotation: options.hold ? 0 : -8, scale: startScale }, at)
        tl.to(piece, { ...target, rotation: 0, scale: 1, duration }, at)
        tl.set(piece, { opacity: 0 }, at + duration)
      }

      batch.casts.forEach((cast, index) => {
        const visual = sources.querySelector<HTMLElement>(`[data-motion-cast="${index}"] .poker-ability-face`)
        if (!visual || !castRect) return
        const from = cast.seatNo === mySeat ? castRect : usable(hole(cast.seatNo, 0)) ?? castRect
        const at = tl.duration()
        const piece = sprite(visual, from, castRect)
        tl.set(piece, { opacity: 1, scale: .72, rotation: -7 }, at)
        tl.to(piece, { ...center(castRect), scale: 1, rotation: 0, duration: .21 }, at)
        tl.to(piece, { scale: cast.blocked ? .86 : 1.06, duration: .1 }, at + .21)
        tl.to(piece, { opacity: 0, duration: .12 }, at + .31)
      })

      if (batch.payments.length) tl.addPause(tl.duration() + .001, () => {
        waitingForChips.current = true
        if (!pendingChips.current) queueMicrotask(() => {
          if (active.current !== tl) return
          waitingForChips.current = false
          tl.resume()
        })
      })

      const resultInDialog = !insideSurface && document.querySelector(".poker-card-dock-stage[open] .poker-result-hole-cards")
      for (const change of batch.changes) {
        if (resultInDialog && change.kind === "replaced" && change.seats[0] === mySeat) continue
        const at = tl.duration()
        if (change.kind === "effect") {
          for (const seat of change.seats) {
            const target = root.querySelector(`[data-seat="${seat}"] .poker-seat-plate`)
            if (target) tl.fromTo(target, { scale: 1 }, { scale: 1.045, duration: .13, repeat: 1, yoyo: true, immediateRender: false }, at)
          }
          continue
        }
        const groups = change.seats.map(seat => {
          const slots = change.count === 2 ? [0, 1] : change.slots?.[seat]
          if (!slots) {
            const rect = usable(root.querySelector<HTMLElement>(`[data-seat="${seat}"] .poker-seat-cards`))
            if (!rect) return []
            const width = Math.min(rect.width, rect.height / 1.4)
            return [{ card: null, index: -1, rect: new DOMRect(rect.left + (rect.width - width) / 2, rect.top, width, rect.height) }]
          }
          return slots.flatMap(index => {
            const card = hole(seat, index), rect = usable(card)
            return card && rect ? [{ card, index, rect }] : []
          })
        })
        const exchange = change.kind === "reordered" || change.kind === "exchanged"
        const returnDuration = .28, step = .055, shuffleDuration = .2, drawDuration = .32
        const shuffleAt = at + returnDuration + Math.max(0, ...groups.map(group => group.length - 1)) * step
        if (!exchange && deck && deckRect) tl.to(deck, {
          keyframes: [{ rotation: -9, y: -3 }, { rotation: 8, y: -2 }, { rotation: 0, y: 0 }],
          duration: shuffleDuration, ease: "power1.inOut",
        }, shuffleAt)

        for (const [groupIndex, group] of groups.entries()) {
          group.forEach(({ card, index: slot, rect }, index) => {
            const start = at + index * step
            if (exchange) {
              const other = change.kind === "reordered" ? group[1 - index]?.rect : groups[1 - groupIndex]?.[index]?.rect
              if (!other) return
              if (card) { conceal(card); tl.set(card, { opacity: 0 }, start) }
              fly(back, other, rect, start, drawDuration)
              if (card) tl.set(card, { opacity: 1 }, start + drawDuration)
            } else if (deckRect) {
              const old = change.oldCards?.[change.seats[groupIndex]]?.[slot]
              const previousFace = old ? sources.querySelector<HTMLElement>(`[data-motion-old="${CSS.escape(old)}"] .poker-card`) : null
              if (card) { conceal(card); tl.set(card, { opacity: 0 }, start) }
              fly(previousFace ?? back, rect, deckRect, start, returnDuration, { phase: "return", flip: previousFace ? "down" : undefined, hold: !!previousFace })
              const redraw = shuffleAt + shuffleDuration + index * step
              fly(card ?? back, deckRect, rect, redraw, drawDuration, { phase: "draw", flip: card?.dataset.face === "up" ? "up" : undefined })
              if (card) tl.set(card, { opacity: 1 }, redraw + drawDuration)
            }
          })
        }
      }

      const drawStart = tl.duration()
      if (deckRect) batch.draws.forEach((id, index) => {
        const slot = anchor(`ability:${id}`), face = slot?.querySelector<HTMLElement>(".poker-ability-face"), target = usable(slot)
        if (!slot || !face || !target) return
        const row = slot.parentElement?.getBoundingClientRect()
        if (row && (target.right <= row.left || target.left >= row.right)) return
        const at = drawStart + index * .065
        conceal(face)
        fly(face, deckRect, target, at, .32)
        tl.set(face, { opacity: 1 }, at + .32)
      })
      const done = () => queueMicrotask(() => {
        if (active.current === tl) finish()
      })
      if (tl.duration()) {
        tl.eventCallback("onComplete", done)
        tl.play()
      } else done()
    }, host)
    function finish() {
      if (!active.current) return
      context.revert()
      active.current = null
      waitingForChips.current = false
      host!.replaceChildren()
      onComplete(batch!)
    }
    const viewport = root.querySelector(".poker-table-main")
    const top = viewport?.scrollTop, left = viewport?.scrollLeft
    const onViewportScroll = () => {
      if (viewport?.scrollTop !== top || viewport?.scrollLeft !== left) finish()
    }
    window.addEventListener("resize", finish)
    viewport?.addEventListener("scroll", onViewportScroll)
    return () => {
      window.removeEventListener("resize", finish)
      viewport?.removeEventListener("scroll", onViewportScroll)
      context.revert()
      active.current = null
      waitingForChips.current = false
      host.replaceChildren()
    }
  }, [batch, insideSurface, mySeat, onComplete, surface])

  useLayoutEffect(() => {
    if (paymentPending || !waitingForChips.current) return
    waitingForChips.current = false
    active.current?.resume()
  }, [paymentPending])

  const portal = insideSurface ? surface.current : document.body
  if (!batch || !portal) return null
  return createPortal(<div className="poker-motion-overlay" aria-hidden="true">
    <div ref={templates} hidden>
      <Card faceUp={false} />
      {[...oldCards].map(card => <span key={card} data-motion-old={card}><Card card={card} /></span>)}
      {batch.casts.map((cast, index) => <span data-motion-cast={index} key={cast.id}><PokerAbilityFace name={cast.name} artId={cast.artId} size="sm" /></span>)}
    </div>
    <div ref={layer} />
  </div>, portal)
}

export function PokerMotionDeck() {
  return <span className="poker-motion-deck" data-card-motion-anchor="poker-deck" aria-hidden="true"><Card faceUp={false} /></span>
}
