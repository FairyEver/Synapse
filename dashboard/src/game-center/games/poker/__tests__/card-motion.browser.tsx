import "@/styles/globals.css"
import "../../../styles/web.css"
import { useState } from "react"
import { expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { PokerCardDockFlow } from "../components/PokerCardDockFlow"
import { cardTable } from "./card-stage-fixture"

function ReplacementFixture() {
  const [table, setTable] = useState(() => {
    const view = structuredClone(cardTable)
    view.cards!.version = "cards-v2"
    view.cards!.definitions!["01"] = { ...view.cards!.definitions!["01"], name: "换牌术", play: { cancelUntil: "target-confirm", result: "holes" } }
    view.cards!.ownHand![0].choices = view.cards!.ownHand![0].choices.slice(0, 1)
    return view
  })
  return <PokerCardDockFlow table={table} disabled={false} onActivate={() => {}} onRefresh={() => {}}
    controls={{ busy: false, blocked: false, uncertain: false, canControl: true, storageError: false, error: null,
      choose: () => undefined, retry: () => undefined, play: () => {
        setTable(current => {
          const next = structuredClone(current)
          next.actionSeq = current.actionSeq! + 1
          next.hole = ["As", "7h"]
          next.cards!.ownHand = []
          next.cards!.used = [{ id: "done", cardId: "01", name: "换牌术", seatNo: 0, seq: next.actionSeq, status: "completed" }]
          return next
        })
        return Promise.resolve()
      } }} />
}

it.each([[1280, 800], [390, 667]])("换牌结果在 %i×%i 的可见面板中完成旧牌归堆、洗牌、新牌回槽", async (width, height) => {
  await page.viewport(width, height)
  const fixture = await render(<ReplacementFixture />)
  const trigger = document.querySelector<HTMLButtonElement>(".poker-hand-dock-card")!
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  await page.getByRole("button", { name: "第2张", exact: true }).click()

  const seen: string[] = []
  let frame = 0
  function sample() {
    const result = document.querySelector<HTMLDialogElement>("dialog[open]")
    const deck = result?.querySelector<HTMLElement>(".poker-motion-deck")
    const flight = [...(result?.querySelectorAll<HTMLElement>("[data-motion-phase]") ?? [])].find(piece =>
      Number(getComputedStyle(piece).opacity) > .5 && Number(getComputedStyle(piece.firstElementChild!).opacity) > .5)
    if (deck && flight) {
      const rect = flight.getBoundingClientRect()
      if (rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height && !seen.includes(flight.dataset.motionPhase!))
        seen.push(flight.dataset.motionPhase!)
    } else if (deck?.style.transform && seen.at(-1) === "return") seen.push("shuffle")
    frame = requestAnimationFrame(sample)
  }
  frame = requestAnimationFrame(sample)
  try {
    await page.getByRole("button", { name: /支付.+确认/ }).click()
    await expect.poll(() => seen).toEqual(["return", "shuffle", "draw"])
    await expect.element(page.getByRole("dialog", { name: "换牌完成" })).toBeVisible()
    await expect.poll(() => document.querySelector(".poker-motion-piece")).toBeNull()
    expect(document.querySelector('.poker-result-hole-cards [data-card="7h"]')).not.toBeNull()
  } finally {
    cancelAnimationFrame(frame)
    await fixture.unmount()
  }
})
