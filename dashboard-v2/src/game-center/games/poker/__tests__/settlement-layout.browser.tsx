import "@/styles/globals.css"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { SettlementPanel } from "../components/SettlementPanel"
import { table } from "./settlement-fixture"
const api = vi.hoisted(() => ({ ready: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { seat: { ready: api.ready } } }) }))

function stressTable(): PokerTableView {
  const settlement = { ...table.settlement!, seats: Array.from({ length: 10 }, (_, i) => ({
    ...table.settlement!.seats[i === 0 ? 0 : 1], seatNo: i, displayName: `${i}-` + "VeryLongUnbrokenPlayerName".repeat(8),
    isMe: i === 0, payout: i === 0 ? 1000000 : 0, delta: i === 0 ? 900000 : -100000, endingStack: 2147483647,
  })) }
  return { ...table, maxSeats: 10, settlement, seats: settlement.seats.map(s => ({ ...table.seats[0], seatNo: s.seatNo, displayName: s.displayName, isMe: s.isMe })) }
}
function inside(element: Element) {
  const rect = element.getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(-1)
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1)
  expect(rect.top).toBeGreaterThanOrEqual(-1)
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
}
async function element(selector: string) {
  await expect.poll(() => document.querySelector(selector)).not.toBeNull()
  return document.querySelector<HTMLElement>(selector)!
}
for (const [width, height] of [[1360, 900], [390, 667], [390, 844], [320, 568]]) {
  it(`${width}×${height} 十人长姓名无横向溢出，正文可滚到底，操作保持可达`, async () => {
    await page.viewport(width, height)
    api.ready.mockRejectedValue(new Error("模拟响应未知"))
    const screen = await render(<SettlementPanel table={stressTable()} perspective="owner" identityKey="layout" onRefresh={vi.fn()} />)
    try {
      const dialog = await element('[role="dialog"]')
      await expect.poll(() => dialog.closest('[data-slot="modal-container"]')?.hasAttribute('data-entering')).toBe(false)
      await expect.poll(() => getComputedStyle(dialog.closest('.modal__backdrop')!).opacity).toBe('1')
      inside(dialog)
      for (const selector of ['.poker-result-details', '.poker-result-players', '.poker-result-best', '.poker-result-ready-list', '.poker-result-footer']) {
        const node = dialog.querySelector<HTMLElement>(selector)!
        expect(node.scrollWidth, selector).toBeLessThanOrEqual(node.clientWidth + 1)
      }
      for (const name of dialog.querySelectorAll<HTMLElement>('.poker-result-player-name')) {
        expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth + 1)
        expect(getComputedStyle(name).textOverflow).not.toBe('ellipsis')
      }
      for (const button of dialog.querySelectorAll('.poker-result-footer button')) inside(button)
      await page.screenshot({ path: `.superpowers/sdd/2026-11-01-poker-settlement-ready/${width}x${height}-top.png` })
      const body = dialog.querySelector<HTMLElement>('.modal__body')!
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
      body.scrollTop = body.scrollHeight
      await expect.poll(() => body.scrollTop).toBeGreaterThan(0)
      const last = dialog.querySelector('.poker-result-ready-list li:last-child')!
      inside(last)
      await page.screenshot({ path: `.superpowers/sdd/2026-11-01-poker-settlement-ready/${width}x${height}-bottom.png` })
      await page.getByRole('button', { name: '准备下一手', exact: true }).click()
      await expect.element(page.getByRole('alert')).toHaveTextContent('模拟响应未知')
      for (const button of dialog.querySelectorAll('.poker-result-footer button')) inside(button)
      await page.getByRole('tab', { name: '底池分配 1', exact: true }).click()
      await expect.element(page.getByText('主池', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '返回牌桌', exact: true }).click()
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
      await page.getByRole('button', { name: '本局结算', exact: true }).click()
      await expect.element(page.getByRole('dialog')).toBeVisible()
    } finally { await screen.unmount() }
  })
}
it.each([[1360, 900], [390, 667]])('%i×%i 普通结算保留原型层级与五张牌，键盘可关闭并返回触发位置', async (width, height) => {
  await page.viewport(width, height)
  const normal = { ...table, settlement: { ...table.settlement!, seats: table.settlement!.seats.map((s, i) => ({ ...s, displayName: i === 0 ? '沐白' : '林川' })) } }
  const screen = await render(<SettlementPanel table={normal} perspective="owner" identityKey="normal" onRefresh={vi.fn()} />)
  try {
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await expect.poll(() => getComputedStyle(document.querySelector('.modal__backdrop')!).opacity).toBe('1')
    await page.screenshot({ path: `.superpowers/sdd/2026-11-01-poker-settlement-ready/normal-${width}.png` })
    expect(document.querySelectorAll('.poker-result-best [data-face="up"]')).toHaveLength(5)
    await page.getByRole('button', { name: '返回牌桌', exact: true }).click()
    await page.getByRole('button', { name: '本局结算', exact: true }).click()
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('本局结算')
  } finally { await screen.unmount() }
})
