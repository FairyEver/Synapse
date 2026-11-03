import "@/styles/globals.css"
import "../../../styles/web.css"
import { expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
import { Table } from "../components/Table"

const table: PokerTableView = {
  ...tableResponse, mode: "practice", street: "river", board: ["As", "Jd", "7s", "4c", "2h"],
  cards: { enabled: true, version: "cards-v2", used: [], statuses: [] },
  handLog: { handId: "hand", complete: true, entries: [
    { seq: 1, seatNo: 1, displayName: "阿岚", street: "flop", action: "raise", amount: 30, isAuto: false },
    { seq: 2, seatNo: 0, displayName: "选手", street: "river", action: "card", amount: 24, isAuto: false,
      card: { id: "07", artId: "v1/07", name: "五选其一", description: "随机锁定一张底牌，从五张候选中选一张。", status: "completed" } },
  ] },
}

it.each([[1280, 800], [390, 667]])("%s×%s 牌桌的窄轨只显示图标，详情跟随按钮并避让下注区", async (width, height) => {
  await page.viewport(width, height)
  const screen = await render(<div className="h-dvh"><Table table={table} perspective="public" onPerspective={() => {}} onBack={() => {}} /></div>)
  try {
    const region = page.getByRole("complementary", { name: "本手公开日志" })
    const card = region.getByRole("button", { name: "选手，五选其一" })
    const action = region.getByRole("button", { name: "阿岚，加注" })
    const tooltip = page.getByRole("tooltip")
    const boxes = () => ({
      tip: tooltip.element().getBoundingClientRect(),
      dock: document.querySelector(".poker-controls-anchor")!.getBoundingClientRect(),
      rail: region.element().getBoundingClientRect(),
    })
    expect(region.getByRole("button").elements().map(button => button.textContent)).toEqual(["", ""])
    expect(region.getByRole("button").elements().map(button => button.getAttribute("data-log-seq"))).toEqual(["2", "1"])
    await card.hover()
    await expect.element(tooltip).toHaveTextContent("实付 24 筹码入主池")
    await expect.element(tooltip).toHaveTextContent("从五张候选中选一张")
    const { tip, dock, rail } = boxes()
    expect(tip.left).toBeGreaterThanOrEqual(0)
    expect(tip.right).toBeLessThan(card.element().getBoundingClientRect().left)
    expect(tip.top).toBeGreaterThanOrEqual(rail.top)
    expect(tip.bottom).toBeLessThanOrEqual(dock.top)
    expect(rail.width).toBeLessThanOrEqual(56)

    await action.hover()
    await expect.element(tooltip).toHaveTextContent("30 筹码")
    expect(boxes().tip.top).toBeGreaterThan(tip.top)
    await userEvent.keyboard("{Escape}")
    await expect.element(tooltip).not.toBeInTheDocument()

    // Focus opens the same details, without moving keyboard focus into the tooltip.
    await userEvent.keyboard("{Tab}")
    ;(card.element() as HTMLButtonElement).focus()
    await expect.element(tooltip).toHaveTextContent("五选其一")
    expect(document.activeElement).toBe(card.element())
    await userEvent.keyboard("{Escape}")
    await expect.element(tooltip).not.toBeInTheDocument()

    // Simulate a primary touch press without relying on synthetic hover.
    const touchTarget = action.element()
    const target = touchTarget.getBoundingClientRect()
    for (const type of ["pointerdown", "pointerup"]) touchTarget.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerType: "touch", pointerId: 1, isPrimary: true, button: 0,
      clientX: target.x + target.width / 2, clientY: target.y + target.height / 2,
    }))
    await expect.element(tooltip).toHaveTextContent("阿岚 · 翻牌")
    await userEvent.keyboard("{Escape}")
    await expect.element(tooltip).not.toBeInTheDocument()
  } finally { await screen.unmount() }
})
