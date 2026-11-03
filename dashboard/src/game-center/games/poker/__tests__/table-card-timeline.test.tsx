/** @vitest-environment jsdom */
import { act, createRef } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { PokerCardMotion } from "../components/PokerCardMotion"
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
  const root = createRoot(host), surface = createRef<HTMLDivElement>(), release = vi.fn(), complete = vi.fn()
  const batch: PokerCardMotionBatch = {
    deals: [], folds: [], reveals: [], winningCards: [], changes: [], payments: ["paid"], draws: ["new"],
    casts: [{ id: "cast", name: "灵感迸发", artId: "22", seatNo: 0, blocked: false }],
  }
  const render = (show: boolean, released: boolean, pending: boolean) => act(async () => {
    root.render(<div ref={surface}>
      <span data-card-motion-anchor="ability-pool" />
      <span data-card-motion-anchor="cast-zone" />
      <button data-card-motion-anchor="ability:new"><span className="poker-ability-face">新牌</span></button>
      <PokerCardMotion surface={surface} batch={show ? batch : null} mySeat={0}
        paymentReleased={released} paymentPending={pending} onPaymentReady={release} onComplete={complete} />
    </div>)
  })
  try {
    await render(false, false, false)
    await render(true, false, true)
    const face = host.querySelector<HTMLElement>("button .poker-ability-face")!
    expect(face.style.opacity).toBe("0")
    expect(release).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(release).toHaveBeenCalledExactlyOnceWith(batch))
    await render(true, true, true)
    expect(face.style.opacity).toBe("0")
    await render(true, true, false)
    await vi.waitFor(() => expect(document.querySelector(".poker-motion-piece")).toBeNull())
    expect(face.style.opacity).toBe("")
    expect(complete).toHaveBeenCalledExactlyOnceWith(batch)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    geometry.mockRestore()
  }
})
