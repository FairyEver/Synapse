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
      card: { id: "07", artId: "v2/07", name: "五选其一", description: "随机锁定一张底牌，从五张候选中选一张。", status: "completed" } },
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
    const entries = region.getByRole("list").getByRole("button").elements()
    expect(entries.every(button => button.textContent === "")).toBe(true)
    expect(entries.map(button => button.getAttribute("aria-label"))).toEqual(["选手，五选其一", "河牌", "转牌", "阿岚，加注", "翻牌"])
    await card.hover()
    await expect.element(tooltip).toHaveTextContent("实付 24 筹码入主池")
    await expect.element(tooltip).toHaveTextContent("从五张候选中选一张")
    expect(tooltip.element().querySelector('[data-ability-size="lg"]')).not.toBeNull()
    const { tip, dock, rail } = boxes()
    const cardBounds = card.element().getBoundingClientRect()
    expect(tip.left).toBeGreaterThanOrEqual(0)
    expect(tip.right).toBeLessThan(cardBounds.left)
    expect(tip.top).toBeGreaterThanOrEqual(rail.top)
    expect(tip.top).toBeLessThan(cardBounds.bottom)
    expect(tip.bottom).toBeLessThanOrEqual(dock.top)
    expect(rail.width).toBeLessThanOrEqual(56)

    await action.hover()
    await expect.element(tooltip).toHaveTextContent("30 筹码")
    const actionTip = boxes().tip
    const actionBounds = action.element().getBoundingClientRect()
    expect(actionTip.top).toBeGreaterThan(tip.top)
    expect(actionTip.top).toBeLessThan(actionBounds.bottom)
    expect(actionTip.bottom).toBeGreaterThan(actionBounds.top)
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

it.each([[1280, 800], [390, 667]])("%s×%s 展开本手历史，按轮次预览和固定公开事件", async (width, height) => {
  await page.viewport(width, height)
  const view: PokerTableView = {
    ...table,
    handLog: { ...table.handLog!, entries: [
      { seq: 0, seatNo: 0, displayName: "选手", street: "preflop", action: "small_blind", amount: 5, isAuto: false },
      table.handLog!.entries[0],
      ...Array.from({ length: 42 }, (_, index) => ({
        seq: index + 2, seatNo: index % 2, displayName: index % 2 ? "阿岚" : "选手",
        street: "turn" as const, action: "raise" as const, amount: 60 + index * 10, isAuto: false,
      })),
      { ...table.handLog!.entries[1], seq: 44 },
    ] },
  }
  const screen = await render(<div className="h-dvh"><Table table={view} perspective="public" onPerspective={() => {}} onBack={() => {}} /></div>)
  try {
    const rail = page.getByRole("complementary", { name: "本手公开日志" })
    const railList = rail.getByRole("list").element()
    await rail.getByRole("button", { name: "跳到开局记录" }).click()
    expect(railList.scrollHeight).toBeGreaterThan(railList.clientHeight)
    expect(railList.scrollTop).toBe(railList.scrollHeight - railList.clientHeight)
    await rail.getByRole("button", { name: "跳到最新记录" }).click()
    expect(railList.scrollTop).toBe(0)

    const trigger = rail.getByRole("button", { name: "查看全部" })
    await trigger.click()
    const dialog = page.getByRole("dialog", { name: "对局历史" })
    const detail = dialog.getByRole("region", { name: "事件详情" })
    expect(dialog.getByRole("heading", { level: 3 }).elements().map(node => node.textContent)).toEqual(["盲注", "翻牌", "转牌", "河牌"])
    await expect.element(detail).toHaveTextContent("5 筹码")

    const flop = dialog.getByRole("button", { name: "翻牌", exact: true })
    const river = dialog.getByRole("button", { name: "选手，五选其一" })
    await flop.hover()
    expect(detail.element().querySelectorAll("[data-card]")).toHaveLength(3)
    await flop.click()
    await dialog.getByRole("button", { name: "河牌", exact: true }).hover()
    await expect.element(detail).toHaveTextContent("翻牌")
    await river.click()
    await expect.element(detail).toHaveTextContent("实付 24 筹码入主池")
    await expect.element(dialog.getByRole("button", { name: "取消固定" })).toBeVisible()

    const box = dialog.element().getBoundingClientRect()
    const detailBox = detail.element().getBoundingClientRect()
    const headingBox = dialog.getByRole("heading", { name: "对局历史" }).element().getBoundingClientRect()
    expect(headingBox.left - box.left).toBeGreaterThanOrEqual(22)
    expect(headingBox.top - box.top).toBeGreaterThanOrEqual(22)
    expect(detailBox.right).toBeLessThan(box.right)
    expect(detailBox.bottom).toBeLessThanOrEqual(box.bottom)
    expect(box.width).toBeLessThan(width)
    const scroller = dialog.element().querySelector(".poker-history-body")!
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    const timelineBox = scroller.getBoundingClientRect()
    const navigationBox = dialog.getByRole("navigation", { name: "历史定位" }).element().getBoundingClientRect()
    expect(navigationBox.bottom).toBeLessThan(timelineBox.top)
    if (width > 640) {
      expect(box.width).toBeGreaterThan(640)
      expect(timelineBox.right).toBeLessThan(detailBox.left)
    } else {
      expect(timelineBox.bottom).toBeLessThan(detailBox.top)
    }
    await dialog.getByRole("button", { name: "开局", exact: true }).click()
    expect(scroller.scrollTop).toBe(0)
    await dialog.getByRole("button", { name: "最新", exact: true }).click()
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight)
    await expect.element(detail).toHaveTextContent("五选其一")
    if (width > 640) {
      await page.viewport(390, 667)
      await expect.element(detail).toHaveTextContent("五选其一")
    }

    await userEvent.keyboard("{Escape}")
    await expect.element(dialog).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger.element())
  } finally { await screen.unmount() }
})
