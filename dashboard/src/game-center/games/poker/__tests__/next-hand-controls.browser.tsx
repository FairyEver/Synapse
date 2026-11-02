import "@/styles/globals.css"
import "../../../styles/web.css"
import { useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { Table } from "../components/Table"
import { table } from "./settlement-fixture"
const api = vi.hoisted(() => ({ ready: vi.fn(), control: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { seat: { ready: api.ready }, control: { set: api.control } } }) }))

for (const [width, height] of [[1360, 900], [390, 667], [320, 568]]) {
  it(`${width}×${height} 结算直接接管，关闭后底部可准备并持续显示等待对象`, async () => {
    await page.viewport(width, height)
    let current: PokerTableView = { ...table, controller: "ai" }
    function Harness() {
      const [snapshot, setSnapshot] = useState<typeof table>(current)
      api.control.mockImplementation(async () => { current = { ...table, controller: "human", controlVersion: 4 }; return {} })
      api.ready.mockImplementation(async () => { current = { ...current, seats: current.seats.map(s => s.isMe ? { ...s, readyForNextHand: true } : s) }; return { started: false } })
      return <div className="h-dvh"><Table table={snapshot} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} identityKey="next-hand" onRefresh={() => setSnapshot(current)} /></div>
    }
    const screen = await render(<Harness />)
    try {
      await expect.element(page.getByRole("dialog")).toBeVisible()
      await page.getByRole("dialog").getByRole("button", { name: "本人接管", exact: true }).click()
      await expect.element(page.getByRole("dialog").getByRole("button", { name: "准备下一手", exact: true })).toBeEnabled()
      expect(api.ready).not.toHaveBeenCalled()
      await page.getByRole("button", { name: "返回牌桌", exact: true }).click()
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument()
      const dock = page.getByRole("region", { name: "牌桌 1234" })
      await expect.element(dock.getByRole("button", { name: "准备下一手", exact: true })).toBeVisible()
      await userEvent.tab()
      await dock.getByRole("button", { name: "准备下一手", exact: true }).click()
      await expect.element(dock.getByRole("button", { name: "已准备", exact: true })).toBeDisabled()
      await expect.element(dock.getByRole("status")).toHaveTextContent("已准备 1 / 2 · 等待 对手")
      expect(api.ready).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", handId: "h1", controlVersion: 4 })
      const controls = document.querySelector('.poker-controls-anchor')!.getBoundingClientRect()
      expect(controls.left).toBeGreaterThanOrEqual(0)
      expect(controls.right).toBeLessThanOrEqual(width)
      expect(controls.bottom).toBeLessThanOrEqual(height)
      await page.screenshot({ path: `.superpowers/sdd/2026-11-01-poker-next-hand-controls/${width}-ready.png` })
    } finally { await screen.unmount(); vi.resetAllMocks() }
  })
}
it("接管未返回时关闭结算，底部共享忙碌状态，不重复接管", async () => {
  await page.viewport(390, 667)
  let finish!: () => void
  api.control.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const screen = await render(<div className="h-dvh"><Table table={{ ...table, controller: "ai" }} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} identityKey="shared-pending" onRefresh={vi.fn()} /></div>)
  try {
    await page.getByRole("dialog").getByRole("button", { name: "本人接管", exact: true }).click()
    await page.getByRole("button", { name: "返回牌桌", exact: true }).click()
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument()
    await expect.element(page.getByRole("button", { name: "本人接管", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "更多牌桌操作", exact: true }).click()
    await expect.element(page.getByRole("button", { name: "切换旁观视角", exact: true })).toBeDisabled()
    expect(api.control).toHaveBeenCalledTimes(1)
    finish()
  } finally { await screen.unmount(); vi.resetAllMocks() }
})
it.each([[1360, 900], [320, 568]])("%i×%i 十人长等待姓名不挤出接管按钮或覆盖底部操作", async (width, height) => {
  await page.viewport(width, height)
  const stress = { ...table, controller: "ai" as const, maxSeats: 10, seats: Array.from({ length: 10 }, (_, i) => ({ ...table.seats[0], seatNo: i, isMe: i === 0, displayName: `玩家${i}` + "长姓名".repeat(15), readyForNextHand: i === 0 })) }
  const screen = await render(<div className="h-dvh"><Table table={stress} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} identityKey="long-wait" /></div>)
  const inside = (node: Element) => {
    const rect = node.getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(width)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(height)
  }
  try {
    const dialog = page.getByRole("dialog")
    await expect.element(dialog).toBeVisible()
    await expect.poll(() => getComputedStyle(document.querySelector('.modal__backdrop')!).opacity).toBe('1')
    for (const node of document.querySelectorAll('.poker-result-footer button')) inside(node)
    await page.screenshot({ path: `.superpowers/sdd/2026-11-01-poker-next-hand-controls/${width}-long-modal.png` })
    await page.getByRole("button", { name: "返回牌桌", exact: true }).click()
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument()
    await expect.element(page.getByRole("status")).toHaveTextContent("已准备 1 / 10")
    inside(page.getByRole("button", { name: "本人接管", exact: true }).element())
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(document.querySelector('.poker-canvas-viewport')!.getBoundingClientRect().height).toBeGreaterThan(0)
    await page.screenshot({ path: `.superpowers/sdd/2026-11-01-poker-next-hand-controls/${width}-long-bottom.png` })
  } finally { await screen.unmount() }
})
