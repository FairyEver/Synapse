import "@/styles/globals.css"
import "../../../styles/web.css"
import { Button, Input } from "@heroui/react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { Table } from "../components/Table"
import { Settlement } from "../components/Settlement"
import { PracticeBots } from "../components/PracticeBots"

const api = vi.hoisted(() => ({ act: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { action: { act: api.act } } }) }))

const table: PokerTableView = {
  roomCode: "1234", name: null, status: "running", mode: "practice", buyIn: 1000, maxSeats: 6,
  handId: "hand", handNo: 1, street: "flop", board: ["2s", "3h", "4d"], pot: 20,
  dealerSeat: 0, actionOnSeat: 0, deadlineMs: 20000, cursor: "1:3", mySeatNo: 0,
  seats: [{ seatNo: 0, displayName: "本人", isMe: true, stack: 100, status: "active", streetBet: 2, aiState: "online", controller: "human", hole: ["As", "Kh"] },
    { seatNo: 1, displayName: "对手", isMe: false, stack: 100, status: "active", streetBet: 4, aiState: "online" }],
  recentActions: [{ seq: 3, seatNo: 0, displayName: "很长的玩家名称用于检查系统日志的换行与边界", street: "flop", action: "call", amount: 4, potAfter: 20, isAuto: false, note: "自己的判断" }],
  persona: "自己的风格", deckRemaining: 40, actionSeq: 3, controlVersion: 4, controller: "human",
  legalActions: ["fold", "call", "raise", "allin"], toCall: 4, minRaiseTo: 10, maxRaiseTo: 102,
}

afterEach(() => vi.clearAllMocks())

it("contains long player names in full system results without exposing hidden cards", async () => {
  const name = "Player".repeat(24)
  const screen = await render(<div className="w-[280px] bg-surface p-4 font-sans text-foreground" data-testid="result-fixture"><Settlement compact settlement={{
    handId: "previous", handNo: 1, board: [], rules: { variant: "standard52", smallBlind: 1, bigBlind: 2 }, mixedControl: false,
    seats: [{ seatNo: 0, displayName: name, participantKind: "human", isMe: false, folded: true, delta: -4, payout: 0, endingStack: 96 }],
    pots: [{ amount: 4, eligible: [0], winners: [0], shares: { 0: 4 }, refund: false }],
  }} /></div>)
  try {
    const result = await element('[data-testid="result-fixture"]')
    expect(result.textContent).toContain(name)
    expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth)
    expect(result.querySelector('[data-card]')).toBeNull()
  } finally { await screen.unmount() }
})

function button(name: string) {
  return page.getByRole("button", { name, exact: true })
}
async function element(selector: string) {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull()
  return document.querySelector<HTMLElement>(selector)!
}
function inside(inner: Element, outer: Element) {
  const a = inner.getBoundingClientRect(), b = outer.getBoundingClientRect()
  expect(a.left).toBeGreaterThanOrEqual(b.left - 1)
  expect(a.right).toBeLessThanOrEqual(b.right + 1)
  expect(a.top).toBeGreaterThanOrEqual(b.top - 1)
  expect(a.bottom).toBeLessThanOrEqual(b.bottom + 1)
}

describe.each([
  { mode: "wide", width: "w-[1280px]", layout: "right" },
  { mode: "compact", width: "w-[390px]", layout: "bottom" },
])("poker system surfaces: $mode", ({ mode, width, layout }) => {
  it("keeps panels in the system theme while preserving gameplay, focus and action intent", async () => {
    await page.viewport(mode === "compact" ? 390 : 1360, 1000)
    api.act.mockResolvedValue({ ok: true })
    const botControls = { canManage: true, busy: false, full: false, retrying: false,
      bots: [{ ...table.seats[1], botId: "bot", displayName: "陪练机器人很长的名字" }], add: vi.fn(), remove: vi.fn() }
    const screen = await render(<>
      <div data-testid="system-reference" className="bg-surface p-4 font-sans text-foreground">
        <Button variant="secondary">标准控件</Button><Input variant="secondary" aria-label="标准输入" />
      </div>
      <div data-testid="poker-fixture" className={`${width} h-[800px]`}>
        <Table table={table} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} extras={<PracticeBots controls={botControls} />} />
      </div>
    </>)
    try {
      const surface = await element(".poker-table")
      await expect.poll(() => surface.getAttribute("data-control-layout")).toBe(layout)
      const reference = document.querySelector<HTMLElement>('[data-testid="system-reference"]')!
      const referenceStyle = getComputedStyle(reference)
      const canvas = await element(".poker-canvas")
      const gameButton = await element(".poker-action-buttons .poker-button")
      expect(getComputedStyle(gameButton).fontFamily).toContain("Game Geist")
      expect(getComputedStyle(surface).backgroundColor).not.toBe(referenceStyle.backgroundColor)

      await button("日志").click()
      const drawer = await element(".poker-information-drawer:not([hidden])")
      expect(getComputedStyle(drawer).backgroundColor).toBe(referenceStyle.backgroundColor)
      expect(getComputedStyle(drawer).fontFamily).toBe(referenceStyle.fontFamily)
      expect(drawer.scrollWidth).toBeLessThanOrEqual(drawer.clientWidth)
      await expect.element(page.getByText("陪练机器人很长的名字", { exact: true })).not.toBeVisible()
      inside(drawer, surface)
      if (mode === "compact") expect(drawer.getBoundingClientRect().bottom).toBeLessThanOrEqual(document.querySelector(".poker-controls-anchor")!.getBoundingClientRect().top + 1)
      await page.getByTestId("poker-fixture").screenshot({ path: `.superpowers/sdd/2026-11-01-poker-system-ui/${mode}-log.png` })
      await page.getByRole("tab", { name: "AI 判断", exact: true }).click()
      await expect.element(page.getByText("自己的判断", { exact: true })).toBeVisible()
      await page.getByRole("tab", { name: "陪练", exact: true }).click()
      await expect.element(button("移除 陪练机器人很长的名字")).toBeVisible()
      await button("关闭日志").click()
      const transform = canvas.style.transform

      await button("更多牌桌操作").click()
      const menu = await element('.poker-system-popover [role="dialog"]')
      expect(getComputedStyle(menu.closest(".poker-system-popover")!).backgroundColor).toBe(referenceStyle.backgroundColor)
      expect(getComputedStyle(menu).fontFamily).toBe(referenceStyle.fontFamily)
      const management = await element('.poker-system-popover button:not([aria-label])')
      expect(getComputedStyle(management).backgroundColor).not.toBe(getComputedStyle(gameButton).backgroundColor)
      inside(menu.closest(".poker-system-popover")!, surface)
      await page.getByTestId("poker-fixture").screenshot({ path: `.superpowers/sdd/2026-11-01-poker-system-ui/${mode}-management.png` })
      await userEvent.keyboard("{Escape}")
      await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("更多牌桌操作")

      if (mode === "compact") await button("加注").click()
      const input = await element('.poker-table input[type="number"]')
      const standardInput = document.querySelector<HTMLElement>('[aria-label="标准输入"]')!
      expect(getComputedStyle(input).backgroundColor).toBe(getComputedStyle(standardInput).backgroundColor)
      expect(getComputedStyle(input).fontFamily).toBe(getComputedStyle(standardInput).fontFamily)
      await page.getByRole("spinbutton").fill("103")
      await expect.element(button(mode === "compact" ? "确认加注 103" : "加注 103")).toBeDisabled()
      await page.getByRole("spinbutton").fill("18")
      input.focus()
      expect(input.matches(":focus")).toBe(true)
      await expect.element(page.getByRole("slider", { name: "下注金额" })).toHaveValue("18")
      await page.getByTestId("poker-fixture").screenshot({ path: `.superpowers/sdd/2026-11-01-poker-system-ui/${mode}-amount.png` })
      await button("全下").click()
      const confirmation = await element('[role="alertdialog"]')
      await expect.poll(() => confirmation.closest('[data-slot="alert-dialog-backdrop"]')?.hasAttribute("data-entering")).toBe(false)
      await expect.poll(() => confirmation.closest('[data-slot="alert-dialog-container"]')?.hasAttribute("data-entering")).toBe(false)
      expect(getComputedStyle(confirmation).backgroundColor).toBe(referenceStyle.backgroundColor)
      expect(getComputedStyle(confirmation).fontFamily).toBe(referenceStyle.fontFamily)
      expect(api.act).not.toHaveBeenCalled()
      const confirmationRect = confirmation.getBoundingClientRect()
      expect(confirmationRect.left).toBeGreaterThanOrEqual(0)
      expect(confirmationRect.right).toBeLessThanOrEqual(window.innerWidth + 1)
      expect(confirmationRect.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
      await page.screenshot({ path: `.superpowers/sdd/2026-11-01-poker-system-ui/${mode}-confirmation.png` })
      await button("取消").click()
      await expect.poll(() => document.activeElement?.textContent).toBe("全下")
      expect((input as HTMLInputElement).value).toBe("18")
      expect(canvas.style.transform).toBe(transform)
      await button(mode === "compact" ? "确认加注 18" : "加注 18").click()
      expect(api.act).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "raise", to: 18, controlVersion: 4, expectedActionSeq: 3 }))
    } finally { await screen.unmount() }
  })
})
