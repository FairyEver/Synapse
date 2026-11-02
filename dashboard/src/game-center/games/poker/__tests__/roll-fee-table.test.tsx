/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Table } from "../components/Table"
import { feeTable } from "./roll-fee-fixtures"

vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: {} }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "owner" } } } }) }))
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { sessionStorage.clear(); document.body.replaceChildren() })
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label)!
async function mount() {
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  const render = (table = feeTable, identityKey = "owner", perspective: "owner" | "public" = "owner") => act(async () => root.render(<Table table={table} identityKey={identityKey} perspective={perspective} onPerspective={() => {}} onBack={() => {}} />))
  await render()
  return { host, root, render }
}
describe("牌桌Roll费用入口", () => {
  it("费用标签金额筹码均在入口内；与日志互斥、关闭恢复焦点，不提交资金操作", async () => {
    const { host, root } = await mount()
    const trigger = button("查看 Roll 费用明细")
    expect(trigger).toBeDefined()
    expect(trigger.querySelector('.poker-chip-pile[data-fund="roll"]')).not.toBeNull()
    await act(async () => button("日志").click())
    await act(async () => trigger.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("支付合计 403")
    expect(host.querySelector('.poker-information-drawer')?.hasAttribute('hidden')).toBe(true)
    await act(async () => {
      button("关闭费用明细").click()
      await new Promise(resolve => requestAnimationFrame(resolve))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await new Promise(resolve => requestAnimationFrame(resolve))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await act(async () => root.unmount())
  })
  it.each(["hand", "room", "identity", "perspective"])("%s变化关闭旧费用明细", async context => {
    const { root, render } = await mount()
    await act(async () => button("查看 Roll 费用明细").click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await render({ ...feeTable, ...(context === "hand" ? { handId: "next" } : {}), ...(context === "room" ? { roomCode: "another" } : {}) }, context === "identity" ? "other" : "owner", context === "perspective" ? "public" : "owner")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
