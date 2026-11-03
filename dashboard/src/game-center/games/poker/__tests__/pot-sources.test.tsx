/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Table } from "../components/Table"
import { PokerPotSourcesDialog } from "../components/PokerPotSourcesDialog"
import { potContributions, potTable } from "./pot-sources-fixture"

vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: {} }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "owner" } } } }) }))
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { sessionStorage.clear(); document.body.replaceChildren() })
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label)!
async function mount(standalone = false) {
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  const render = (table = potTable, identity = "owner", perspective: "owner" | "public" = "owner") => act(async () => root.render(standalone ? <PokerPotSourcesDialog table={table} onClose={() => {}} /> : <Table table={table} identityKey={identity} perspective={perspective} onPerspective={() => {}} onBack={() => {}} />))
  await render()
  return { host, root, render }
}
describe("底池来源面板", () => {
  it("点击整个底池区域打开300来源、占比和弃牌投入，关闭/Escape恢复入口焦点", async () => {
    const { root } = await mount()
    const trigger = button("查看底池来源")
    expect(trigger).toBeDefined()
    expect(trigger.querySelector('.poker-chip-pile[data-fund="pot"]')).not.toBeNull()
    expect(trigger.querySelector('.poker-pot')).not.toBeNull()
    await act(async () => trigger.click())
    const panel = document.querySelector('[role="dialog"]')!
    expect(panel.textContent).toContain("当前底池")
    expect(panel.textContent).toContain("300")
    expect(panel.textContent).toContain("50.0%")
    expect(panel.textContent).toContain("33.3%")
    expect(panel.textContent).toContain("老陈")
    expect(panel.textContent).toContain("已弃牌")
    expect(panel.textContent).not.toContain("未投入玩家")
    expect(panel.textContent).not.toContain("403")
    await act(async () => { button("关闭底池来源").click(); await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    await act(async () => button("关闭底池来源").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => root.unmount())
  })
  it.each(["hand", "room", "identity", "perspective"])("%s变化关闭旧底池来源", async context => {
    const { root, render } = await mount()
    await act(async () => button("查看底池来源").click())
    await render({ ...potTable, ...(context === "hand" ? { handId: "next" } : {}), ...(context === "room" ? { roomCode: "next" } : {}) }, context === "identity" ? "other" : "owner", context === "perspective" ? "public" : "owner")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => root.unmount())
  })
  it("与Roll来源/总览互斥，快照更新沿用原身份而不是当前座位姓名", async () => {
    const { root, render } = await mount()
    await act(async () => button("查看暂存明细").click())
    await act(async () => button("查看底池来源").click())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("来源分布")
    await render({ ...potTable, pot: 350, seats: potTable.seats.map(seat => ({ ...seat, displayName: "新占座者" })), potContributions: { ...potContributions, total: 350, players: potContributions.players.map(player => player.key === "lin" ? { ...player, amount: 200 } : player) } })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("林舟")
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("新占座者")
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("57.1%")
    await act(async () => { button("关闭底池来源").click(); await new Promise(resolve => requestAnimationFrame(resolve)) })
    await act(async () => button("对局信息").click())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"][aria-label="总览"]')).not.toBeNull()
    await act(async () => button("关闭对局信息").click())
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    await act(async () => button("查看底池来源").click())
    expect(document.querySelector('[role="dialog"][aria-label="总览"]')).toBeNull()
    await act(async () => root.unmount())
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
  })
  it("旧接口缺源不伪造零，空底池、点数、结算和取消口径明确", async () => {
    const { root, render } = await mount(true)
    await render({ ...potTable, potContributions: undefined })
    expect(document.body.textContent).toContain("底池来源暂不可用")
    await render({ ...potTable, potContributions: { ...potContributions, total: 0, players: [] } })
    expect(document.body.textContent).toContain("本手暂无投入")
    await render({ ...potTable, mode: "points", pot: 0, potContributions: { ...potContributions, status: "settled" } })
    expect(document.body.textContent).toContain("本手累计投入")
    expect(document.body.textContent).toContain("已结算")
    expect(document.body.textContent).toContain("点数")
    expect(document.body.textContent).not.toContain("当前底池")
    await render({ ...potTable, potContributions: { ...potContributions, status: "cancelled" } })
    expect(document.body.textContent).toContain("已取消")
    await act(async () => root.unmount())
  })
})
