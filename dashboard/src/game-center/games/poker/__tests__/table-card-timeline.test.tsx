/** @vitest-environment jsdom */
import { act, createRef } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { Card } from "../components/Card"
import { PokerCardMotion, PokerMotionDeck } from "../components/PokerCardMotion"
import type { PokerCardMotionBatch } from "../lib/table-card-motion"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it("实付动画落定前保留抽牌，随后显示已到账的手牌并清理临时牌影", async () => {
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.dataset.cardMotionAnchor === "ability:new") return new DOMRect(240, 220, 60, 84)
    if (this.dataset.cardMotionAnchor) return new DOMRect(90, 80, 60, 84)
    return new DOMRect(0, 0, 500, 360)
  })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host), surface = createRef<HTMLDivElement>(), complete = vi.fn()
  const batch: PokerCardMotionBatch = {
    changes: [], payments: ["paid"], draws: ["new"],
    casts: [{ id: "cast", name: "灵感迸发", artId: "22", seatNo: 0, blocked: false }],
  }
  const render = (show: boolean, pending: boolean) => act(async () => {
    root.render(<div ref={surface}>
      <span data-card-motion-anchor="poker-deck" />
      <span data-card-motion-anchor="cast-zone" />
      <div className="poker-table-main"><div data-scroll-area /></div>
      <button data-card-motion-anchor="ability:new"><span className="poker-ability-face">新牌</span></button>
      <PokerCardMotion surface={surface} batch={show ? batch : null} mySeat={0}
        paymentPending={pending} onComplete={complete} />
    </div>)
  })
  try {
    await render(false, false)
    await render(true, true)
    const face = host.querySelector<HTMLElement>("button .poker-ability-face")!
    expect(face.style.opacity).toBe("0")
    const cast = document.querySelector<HTMLElement>(".poker-motion-piece")!
    await vi.waitFor(() => expect(Number(cast.style.opacity)).toBeGreaterThan(0))
    await act(async () => {
      host.querySelector("[data-scroll-area]")!.dispatchEvent(new Event("scroll"))
      host.querySelector(".poker-table-main")!.dispatchEvent(new Event("scroll"))
    })
    expect(complete).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(cast.style.opacity).toBe("0"))
    expect(face.style.opacity).toBe("0")
    await render(true, false)
    await vi.waitFor(() => expect(document.querySelector(".poker-motion-piece")).toBeNull())
    expect(face.style.opacity).toBe("")
    expect(complete).toHaveBeenCalledExactlyOnceWith(batch)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    geometry.mockRestore()
  }
})

it.each([1, 2])("换 %i 张牌只显示一处牌堆，全部旧牌归堆后才发新牌", async count => {
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return this.hasAttribute("data-card-motion-anchor") ? new DOMRect(320, 80, 38, 54) : new DOMRect(70, 240, 64, 90)
  })
  const host = document.createElement("div"), surface = createRef<HTMLDivElement>(), root = createRoot(host)
  document.body.append(host)
  const batch: PokerCardMotionBatch = {
    casts: [], payments: [], draws: [],
    changes: [{ kind: "replaced", seats: [0], count, slots: { 0: count === 1 ? [1] : [0, 1] }, oldCards: { 0: { 0: "Qc", 1: "Kd" } } }],
  }
  const complete = vi.fn()
  const render = (active: PokerCardMotionBatch | null) => act(async () => root.render(<div ref={surface}>
    <PokerMotionDeck />
    <div data-seat="0"><div className="poker-seat-cards"><Card card="As" /><Card card="7h" /></div></div>
    <PokerCardMotion surface={surface} batch={active} mySeat={0} paymentPending={false} onComplete={complete} />
  </div>))
  try {
    await render(null)
    expect(host.querySelectorAll('[data-card-motion-anchor] .poker-card[data-face="down"]')).toHaveLength(1)
    await render(batch)
    const departing = [...document.querySelectorAll<HTMLElement>('[data-motion-phase="return"]')]
    const incoming = [...document.querySelectorAll<HTMLElement>('[data-motion-phase="draw"]')]
    expect(departing).toHaveLength(count)
    expect(incoming).toHaveLength(count)
    await vi.waitFor(() => expect(departing.every(piece => piece.style.opacity === "1")).toBe(true))
    expect(departing.some(piece => piece.querySelector('[data-card="Kd"]'))).toBe(true)
    expect(incoming.every(piece => piece.style.opacity === "0")).toBe(true)
    await vi.waitFor(() => expect(incoming.every(piece => piece.style.opacity === "1")).toBe(true))
    expect(departing.every(piece => piece.style.opacity === "0")).toBe(true)
    expect(incoming.every(piece => (piece.firstElementChild as HTMLElement).style.opacity === "")).toBe(true)
    await vi.waitFor(() => expect(complete).toHaveBeenCalledExactlyOnceWith(batch))
  } finally {
    await act(async () => root.unmount())
    host.remove()
    geometry.mockRestore()
  }
})
