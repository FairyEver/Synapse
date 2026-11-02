import "@/styles/globals.css"
import "../../../styles/web.css"
import { beforeEach, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { AgentProfiles } from "../components/AgentProfiles"
import { HandRecord } from "../components/HandRecord"

const api = vi.hoisted(() => ({ history: vi.fn(), detail: vi.fn(), agents: vi.fn(), stats: vi.fn(), versions: vi.fn() }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "owner" } } } }) }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({
  hall: { overview: async () => ({ sessions: [{ game: "poker", roomCode: "123456", funding: "points" }] }) },
  poker: { hand: { history: api.history, detail: api.detail }, agent: { list: api.agents, versions: api.versions }, stats: { get: api.stats } },
}) }))
const name = "W".repeat(32), persona = "UnbrokenPersona".repeat(60), model = "W".repeat(24)
const hand = { handId: "h1", roomCode: "123456", handNo: 1, createdAt: "2026-11-02T00:00:00Z", delta: 50000 }
beforeEach(() => {
  api.history.mockReset().mockResolvedValue({ items: [hand], nextOffset: null })
  api.agents.mockReset().mockResolvedValue([{ id: "a", model, persona, versionSeq: 1 }])
  api.versions.mockReset().mockResolvedValue([{ id: "v1", versionNo: 1, persona, handCount: 20, firstUsedAt: "2026-11-02T00:00:00Z" }])
  api.stats.mockReset().mockResolvedValue({ vpip: .25, pfr: .2, aggression: 2.25, winRate: .6, comparison: [{ seatNo: 0, displayName: name, isMe: true, vpip: .25, pfr: .2, aggression: 2.25, winRate: .6 }] })
  api.detail.mockReset().mockResolvedValue({ roomCode: "123456", handNo: 1, mode: "points", board: ["As", "Kh", "Qd", "Jc", "Ts"], seats: [{ seatNo: 0, displayName: name, startingStack: 1000, endingStack: 1100, hole: ["As", "Kh"] }], actions: [{ seq: 1, seatNo: 0, street: "preflop", action: "raise", amount: 100, potAfter: 200, note: persona, personaVersion: { versionNo: 1, persona } }] })
})
const sizes = [[320, 667], [390, 667], [390, 844], [667, 390], [850, 667], [851, 667], [1280, 844]] as const
async function stable() { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) }
function fits(width: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  for (const element of document.querySelectorAll<HTMLElement>('button, input, textarea, summary, [role="alert"], .poker-record-detail li, .poker-record-detail p')) {
    if (!element.getClientRects().length) continue
    const rect = element.getBoundingClientRect()
    expect(rect.left, element.textContent ?? element.tagName).toBeGreaterThanOrEqual(0)
    expect(rect.right, element.textContent ?? element.tagName).toBeLessThanOrEqual(width + 1)
    if (element.tagName !== "INPUT" && element.tagName !== "TEXTAREA") expect(element.scrollWidth, `${element.tagName}.${element.className} ${element.textContent ?? ""}`).toBeLessThanOrEqual(element.clientWidth + 1)
  }
}

it.each(sizes)("档案 %s×%s 长模型、对比、版本和筛选可操作且不溢出", async (width, height) => {
  await page.viewport(width, height)
  const screen = await render(<div className="game-center h-dvh overflow-y-auto"><AgentProfiles /></div>)
  try {
    await page.getByRole("button", { name: model, exact: true }).click()
    await expect.element(page.getByText(/^v1 · 20 手/)).toBeVisible()
    document.querySelector<HTMLElement>(".game-center")!.scrollTop = 0
    await stable()
    await page.screenshot({ path: `.superpowers/poker-mobile/profiles-form-${width}-${height}.png` })
    await page.getByText(/^v1 · 20 手/).click()
    await stable()
    await page.screenshot({ path: `.superpowers/poker-mobile/profiles-${width}-${height}.png` })
    fits(width)
    const comparison = [...document.querySelectorAll('[aria-label="同桌对比"]')].find(element => element.getClientRects().length)!
    expect(comparison).toBeTruthy()
    expect(comparison.scrollWidth).toBeLessThanOrEqual(comparison.clientWidth + 1)
    await page.getByRole("button", { name: "对比牌桌" }).click()
    await expect.element(page.getByRole("option", { name: "#123456" })).toBeVisible()
    await expect.poll(() => document.querySelectorAll('[data-entering]').length).toBe(0)
    const popover = document.querySelector('[role="listbox"]')!.getBoundingClientRect()
    expect(popover.left).toBeGreaterThanOrEqual(0)
    expect(popover.right).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `.superpowers/poker-mobile/profiles-filter-${width}-${height}.png` })
    await userEvent.keyboard("{Escape}")
    await page.getByRole("button", { name: "陪练", exact: true }).click()
    expect(api.stats).toHaveBeenLastCalledWith({ mode: "practice" })
  } finally { await screen.unmount() }
})

it.each(["empty", "error", "loading"])("320px 档案及版本的 %s 状态保持可读", async state => {
  await page.viewport(320, 667)
  if (state === "empty") {
    api.history.mockResolvedValue({ items: [], nextOffset: null })
    api.versions.mockResolvedValue([])
  } else if (state === "error") {
    api.stats.mockRejectedValue(new Error("STATS_FAILURE_".repeat(50)))
    api.versions.mockRejectedValue(new Error("VERSION_FAILURE_".repeat(50)))
  } else {
    api.stats.mockImplementation(() => new Promise(() => {}))
    api.versions.mockImplementation(() => new Promise(() => {}))
  }
  const screen = await render(<div className="game-center h-dvh overflow-y-auto"><AgentProfiles /></div>)
  try {
    await page.getByRole("button", { name: model, exact: true }).click()
    if (state === "empty") {
      await expect.element(page.getByText("暂无牌局记录")).toBeVisible()
      await expect.element(page.getByText("尚无提示词版本")).toBeVisible()
    } else if (state === "error") await expect.poll(() => document.querySelectorAll('[role="alert"]').length).toBe(2)
    else await expect.element(page.getByRole("heading", { name: "版本历史" })).toBeVisible()
    await stable()
    fits(320)
    if (state === "error") {
      api.stats.mockResolvedValue({ vpip: 0, pfr: 0, aggression: 0, winRate: 0 })
      api.versions.mockResolvedValue([])
      for (const alert of [...document.querySelectorAll('[role="alert"]')]) {
        await userEvent.click(alert.querySelector("button")!)
      }
      await expect.poll(() => document.querySelectorAll('[role="alert"]').length).toBe(0)
      await expect.element(page.getByText("尚无提示词版本")).toBeVisible()
    }
  } finally { await screen.unmount() }
})

it.each(sizes)("记录 %s×%s 展开长姓名、行动和私有提示词后可返回", async (width, height) => {
  await page.viewport(width, height)
  const screen = await render(<div className="game-center h-dvh overflow-y-auto"><HandRecord /></div>)
  try {
    await page.getByRole("button", { name: /#123456 · 第 1 手/ }).click()
    await expect.element(page.getByRole("heading", { name: "#123456 · 第 1 手" })).toBeVisible()
    await page.getByText("v1", { exact: true }).click()
    await stable()
    await page.screenshot({ path: `.superpowers/poker-mobile/records-${width}-${height}.png` })
    fits(width)
    if (width < 1024) {
      await page.getByRole("button", { name: "返回记录列表" }).click()
      await expect.element(page.getByRole("button", { name: /#123456 · 第 1 手/ })).toBeVisible()
      expect(document.activeElement?.getAttribute("aria-pressed")).toBe("false")
    }
  } finally { await screen.unmount() }
})

it.each(["empty", "error"])("320px 系统页的 %s 状态保留内容与重试入口", async state => {
  await page.viewport(320, 667)
  if (state === "empty") api.history.mockResolvedValue({ items: [], nextOffset: null })
  else api.history.mockRejectedValue(new Error("READ_FAILURE_".repeat(50)))
  const screen = await render(<div className="game-center h-dvh overflow-y-auto"><HandRecord /></div>)
  try {
    if (state === "empty") await expect.element(page.getByText("暂无牌局记录")).toBeVisible()
    else await expect.element(page.getByRole("button", { name: "重试" })).toBeVisible()
    await stable()
    fits(320)
    if (state === "error") {
      api.history.mockResolvedValue({ items: [], nextOffset: null })
      await page.getByRole("button", { name: "重试" }).click()
      await expect.element(page.getByText("暂无牌局记录")).toBeVisible()
    }
  } finally { await screen.unmount() }
})
