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
  paymentReleased: boolean
  paymentPending: boolean
  onPaymentReady: (batch: PokerCardMotionBatch) => void
  onComplete: (batch: PokerCardMotionBatch) => void
}

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

export function PokerCardMotion({ surface, batch, mySeat, paymentReleased, paymentPending, onPaymentReady, onComplete }: Props) {
  const layer = useRef<HTMLDivElement>(null)
  const templates = useRef<HTMLDivElement>(null)
  const active = useRef<gsap.core.Timeline | null>(null)

  useLayoutEffect(() => {
    const root = surface.current, host = layer.current, sources = templates.current
    if (!batch || !root || !host || !sources) return
    const anchor = (name: string) => root.querySelector<HTMLElement>(`[data-card-motion-anchor="${CSS.escape(name)}"]`)
    const hole = (seat: number, index: number) => root.querySelector<HTMLElement>(`[data-seat="${seat}"] .poker-seat-cards > :nth-child(${index + 1})`)
    const cardAt = (name: string) => {
      const [, seat, index] = name.split(":")
      return name.startsWith("hole:") ? hole(Number(seat), Number(index)) : anchor(name)?.querySelector<HTMLElement>(".poker-card")
    }
    const usable = (element?: HTMLElement | null) => {
      const rect = element?.getBoundingClientRect()
      return rect?.width && rect.height ? rect : null
    }
    const sprite = (visual: HTMLElement, start: DOMRect, end: DOMRect) => {
      const piece = document.createElement("span")
      piece.className = "poker-motion-piece"
      piece.append(visual.cloneNode(true))
      host.append(piece)
      const from = center(start)
      gsap.set(piece, { x: from.x, y: from.y, xPercent: -50, yPercent: -50, width: end.width, height: end.height, "--cw": `${end.width}px`, opacity: 0 })
      return piece
    }

    const context = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } })
      active.current = tl
      const deck = anchor("poker-deck"), pool = anchor("ability-pool"), castZone = anchor("cast-zone")
      const deckRect = usable(deck), poolRect = usable(pool), castRect = usable(castZone)
      const back = sources.querySelector<HTMLElement>(".poker-card")!
      const hidden = new Set<HTMLElement>()
      const conceal = (element: HTMLElement) => {
        if (!hidden.has(element)) gsap.set(element, { opacity: 0 })
        hidden.add(element)
      }
      const fly = (visual: HTMLElement, from: DOMRect, to: DOMRect, at: number, duration: number, flip = false) => {
        const piece = sprite(visual, from, to)
        const target = center(to)
        const face = flip ? piece.querySelector(".poker-card-turn") : null
        if (face) {
          gsap.set(face, { rotationY: 180 })
          tl.to(face, { rotationY: 0, duration: .16, ease: "power1.inOut" }, at + duration - .16)
        }
        tl.set(piece, { opacity: 1, rotation: -8, scale: .82 }, at)
        tl.to(piece, { ...target, rotation: 0, scale: 1, duration }, at)
        tl.set(piece, { opacity: 0 }, at + duration)
      }

      if (deckRect) batch.deals.forEach((name, index) => {
        const card = cardAt(name), target = usable(card)
        if (!card || !target) return
        const at = index * .045
        conceal(card)
        fly(card, deckRect, target, at, .29, card.dataset.face === "up")
        tl.set(card, { opacity: 1 }, at + .29)
      })

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

      if (batch.payments.length) tl.addPause(tl.duration() + .001, () => onPaymentReady(batch))

      const discard = usable(anchor("discard"))
      if (discard) batch.folds.forEach(seat => {
        const at = tl.duration()
        for (const index of [0, 1]) {
          const from = usable(hole(seat, index))
          if (from) fly(back, from, discard, at + index * .035, .24)
        }
      })

      for (const change of batch.changes) {
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
            return [{ card: null, rect: new DOMRect(rect.left + (rect.width - width) / 2, rect.top, width, rect.height) }]
          }
          return slots.flatMap(index => {
            const card = hole(seat, index), rect = usable(card)
            return card && rect ? [{ card, rect }] : []
          })
        })
        for (const [groupIndex, group] of groups.entries()) {
          group.slice(0, change.count).forEach(({ card, rect }, index) => {
            const start = at + index * .04
            const other = change.kind === "reordered" ? group[1 - index]?.rect
              : change.kind === "exchanged" ? groups[1 - groupIndex]?.[index]?.rect : null
            if (card) {
              conceal(card)
              tl.set(card, { opacity: 0 }, start)
            }
            if (other) {
              fly(back, other, rect, start, .32)
              if (card) tl.set(card, { opacity: 1 }, start + .32)
            } else if (deckRect) {
              if (change.kind === "replaced") {
                // Draw first, then send the old card back. The new face appears at its seat.
                fly(card ?? back, deckRect, rect, start, .28, card?.dataset.face === "up")
                fly(back, rect, deckRect, start + .13, .23)
                if (card) tl.set(card, { opacity: 1 }, start + .28)
              } else {
                fly(back, rect, deckRect, start, .23)
                fly(card ?? back, deckRect, rect, start + .4, .28, card?.dataset.face === "up")
                if (card) tl.set(card, { opacity: 1 }, start + .68)
              }
            } else if (card) tl.set(card, { opacity: 1 }, start)

          })
        }
        if (deck && deckRect && (change.kind === "shuffled" || change.kind === "replaced"))
          tl.fromTo(deck, { rotation: -9 }, { rotation: 9, duration: .08, repeat: 1, yoyo: true, immediateRender: false }, at + (change.kind === "replaced" ? .36 : .24))
      }

      const drawStart = tl.duration()
      if (poolRect) batch.draws.forEach((id, index) => {
        const slot = anchor(`ability:${id}`), face = slot?.querySelector<HTMLElement>(".poker-ability-face"), target = usable(slot)
        if (!slot || !face || !target) return
        const row = slot.parentElement?.getBoundingClientRect()
        if (row && (target.right <= row.left || target.left >= row.right)) return
        const at = drawStart + index * .065
        conceal(face)
        fly(face, poolRect, target, at, .32)
        tl.set(face, { opacity: 1 }, at + .32)
      })
      const revealStart = tl.duration()
      batch.reveals.forEach((name, index) => {
        const card = cardAt(name), target = usable(card)
        if (!card || !target) return
        const at = revealStart + index * .045
        conceal(card)
        fly(card, target, target, at, .22, true)
        tl.set(card, { opacity: 1 }, at + .22)
      })
      const highlightStart = tl.duration()
      for (const name of batch.winningCards) {
        const card = cardAt(name)
        if (card && usable(card)) tl.to(card, { y: -5, scale: 1.08, duration: .18, repeat: 1, yoyo: true }, highlightStart)
      }
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
      host!.replaceChildren()
      onComplete(batch!)
    }
    window.addEventListener("resize", finish)
    root.addEventListener("scroll", finish, true)
    return () => {
      window.removeEventListener("resize", finish)
      root.removeEventListener("scroll", finish, true)
      context.revert()
      active.current = null
      host.replaceChildren()
    }
  }, [batch, mySeat, onComplete, onPaymentReady, surface])

  useLayoutEffect(() => {
    if (paymentReleased && !paymentPending) active.current?.resume()
  }, [paymentReleased, paymentPending])

  if (!batch) return null
  return createPortal(<div className="poker-motion-overlay" aria-hidden="true">
    <div ref={templates} hidden>
      <Card faceUp={false} />
      {batch.casts.map((cast, index) => <span data-motion-cast={index} key={cast.id}><PokerAbilityFace name={cast.name} artId={cast.artId} size="sm" /></span>)}
    </div>
    <div ref={layer} />
  </div>, document.body)
}

export function PokerMotionDecks({ abilities }: { abilities: boolean }) {
  return <>
    <span className="poker-motion-deck" data-card-motion-anchor="poker-deck" aria-hidden="true"><Card faceUp={false} /></span>
    <span className="poker-motion-discard" data-card-motion-anchor="discard" aria-hidden="true" />
    {abilities && <span className="poker-motion-pool" data-card-motion-anchor="ability-pool" aria-hidden="true"><Card faceUp={false} /></span>}
  </>
}
