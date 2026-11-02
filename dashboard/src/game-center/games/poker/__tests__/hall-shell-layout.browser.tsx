import "@/styles/globals.css"
import "../../../styles/web.css"
import { expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { HallOverview, PokerSummaryView } from "@synapse/shared/game-contracts"
import { HallHome } from "../../../components/HallHome"
import { SystemAppTopBarActionButton, SystemAppWindowShell } from "../../../runtime/page-shell"
import { PokerArtwork } from "../components/PokerArtwork"
import { PokerHandPreview } from "../components/PokerPreview"

const hand: PokerSummaryView = { handId: "hand", roomCode: "123456", handNo: 2147483647, seatNo: 0, delta: -Number.MAX_SAFE_INTEGER, result: "lost", hole: ["As", "Kh"], board: [], createdAt: "2026-11-02T00:00:00Z" }
const overview: HallOverview = {
  points: { total: Number.MAX_SAFE_INTEGER, available: Number.MAX_SAFE_INTEGER, inPlay: Number.MAX_SAFE_INTEGER, pending: Number.MAX_SAFE_INTEGER, netProfit: -Number.MAX_SAFE_INTEGER },
  games: [{ id: "poker", name: "德州扑克", entry: "poker", icon: "cards", status: "available" }], sessions: [], next: null,
}
const sizes = [[320, 667], [390, 844], [667, 320], [850, 667], [851, 667], [1280, 844]] as const
async function stable() { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) }
function fits(width: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  for (const element of document.querySelectorAll<HTMLElement>('button, [role="tab"], .card, .card p, .gc-poker-art, .gc-art-hand .poker-card')) {
    if (!element.getClientRects().length) continue
    const rect = element.getBoundingClientRect()
    expect(rect.left, element.textContent ?? element.className).toBeGreaterThanOrEqual(0)
    expect(rect.right, element.textContent ?? element.className).toBeLessThanOrEqual(width + 1)
    if (!element.matches('.gc-art-hand .poker-card, .gc-poker-art')) expect(element.scrollWidth, element.textContent ?? element.className).toBeLessThanOrEqual(element.clientWidth + 1)
  }
}
it.each(sizes)("大厅 %s×%s 大额点数、预览和进入操作可滚动抵达", async (width, height) => {
  await page.viewport(width, height)
  const onEnter = vi.fn()
  const screen = await render(<SystemAppWindowShell left="游戏中心" actions={<SystemAppTopBarActionButton onClick={vi.fn()}>返回控制台</SystemAppTopBarActionButton>}><div className="game-hall game-center h-full min-h-0 overflow-y-auto overscroll-contain"><HallHome overview={overview} previews={{ poker: () => <PokerHandPreview hand={hand} /> }} artwork={{ poker: PokerArtwork }} onEnter={onEnter} onSession={vi.fn()} onGrant={vi.fn()} /></div></SystemAppWindowShell>)
  try {
    await stable()
    await page.screenshot({ path: `.superpowers/poker-mobile/hall-top-${width}-${height}.png` })
    fits(width)
    const illustration = document.querySelector('.poker-artwork')!.getBoundingClientRect()
    for (const part of document.querySelectorAll('.gc-poker-art > span, .gc-art-hand .poker-card')) {
      const rect = part.getBoundingClientRect()
      expect(rect.left).toBeGreaterThanOrEqual(illustration.left - 1)
      expect(rect.right).toBeLessThanOrEqual(illustration.right + 1)
    }
    const enter = page.getByRole("button", { name: "进入游戏 · 德州扑克" })
    enter.element().scrollIntoView({ block: "center" })
    await stable()
    const rect = enter.element().getBoundingClientRect()
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(height)
    expect(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest("button")).toBe(enter.element())
    await page.screenshot({ path: `.superpowers/poker-mobile/hall-${width}-${height}.png` })
    await enter.click()
    expect(onEnter).toHaveBeenCalledExactlyOnceWith("poker")
  } finally { await screen.unmount() }
})
it.each(sizes)("导航 %s×%s 三页入口及返回可见并可键盘切换", async (width, height) => {
  await page.viewport(width, height)
  const onValueChange = vi.fn(), onBack = vi.fn()
  const screen = await render(<SystemAppWindowShell left="德州扑克" tabs={[{ id: "rooms", label: "房间" }, { id: "records", label: "牌局记录" }, { id: "agents", label: "选手档案" }]} value="rooms" onValueChange={onValueChange} actions={<SystemAppTopBarActionButton onClick={onBack}>返回大厅</SystemAppTopBarActionButton>}><div className="h-full overflow-y-auto"><div className="h-dvh">内容</div><button>页面末端</button></div></SystemAppWindowShell>)
  try {
    await stable()
    fits(width)
    const tabs = document.querySelector('[role="tablist"]')!
    expect(tabs.scrollWidth).toBeLessThanOrEqual(tabs.clientWidth + 1)
    page.getByRole("tab", { name: "房间", exact: true }).element().focus()
    await userEvent.keyboard("{ArrowRight}")
    expect(onValueChange).toHaveBeenLastCalledWith("records")
    const end = page.getByRole("button", { name: "页面末端" }).element()
    end.scrollIntoView({ block: "end" })
    expect(end.getBoundingClientRect().bottom).toBeLessThanOrEqual(height)
    await page.getByRole("button", { name: "返回大厅" }).click()
    expect(onBack).toHaveBeenCalledOnce()
    await page.screenshot({ path: `.superpowers/poker-mobile/shell-${width}-${height}.png` })
  } finally { await screen.unmount() }
})
it.each(sizes.slice(0, 3))("大厅 %s×%s 空态、补助和不可用游戏入口保持可达", async (width, height) => {
  await page.viewport(width, height)
  const onGrant = vi.fn(), onEnter = vi.fn()
  const empty = { ...overview, points: { total: 0, available: 0, inPlay: 0, pending: 0, netProfit: 0 } }
  const screen = await render(<SystemAppWindowShell><div className="game-hall game-center h-full min-h-0 overflow-y-auto"><HallHome overview={empty} previews={{}} artwork={{ poker: PokerArtwork }} onEnter={onEnter} onSession={vi.fn()} onGrant={onGrant} /></div></SystemAppWindowShell>)
  try {
    await stable()
    fits(width)
    await page.getByRole("button", { name: "领取每日补助" }).click()
    expect(onGrant).toHaveBeenCalledOnce()
    const unavailable = page.getByRole("button", { name: "敬请期待 · 德州扑克" })
    await expect.element(unavailable).toBeDisabled()
    unavailable.element().scrollIntoView({ block: "center" })
    expect(unavailable.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(height)
    await expect.element(page.getByRole("list", { name: "正在进行的游戏" }).getByText("暂无进行中的游戏")).toBeVisible()
    expect(onEnter).not.toHaveBeenCalled()
  } finally { await screen.unmount() }
})
