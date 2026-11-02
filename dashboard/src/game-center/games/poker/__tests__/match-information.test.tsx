/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { SidePanel } from "../components/SidePanel"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
afterEach(() => document.body.replaceChildren())
const base: PokerTableView = {
  roomCode: "1234", name: null, status: "running", buyIn: 1000, maxSeats: 3, handId: "h", handNo: 1,
  street: "flop", board: ["As", "Kh", "7c"], pot: 30, dealerSeat: 0, actionOnSeat: 0, deadlineMs: 10000,
  cursor: "1:4", mySeatNo: 0, deckRemaining: 40, recentActions: [],
  seats: [{ seatNo: 0, displayName: "新占座者", stack: 900, pendingCompensation: 8, status: "active", isMe: true, inCurrentHand: true, aiState: "online", streetBet: 0 }],
  potContributions: { handId: "h", status: "pending", total: 30, players: [{ key: "p0", seatNo: 0, displayName: "原玩家", isMe: true, folded: false, amount: 10 }, { key: "p1", seatNo: 1, displayName: "对手", isMe: false, folded: true, amount: 20 }] },
  rollLedger: { handId: "h", status: "pending", players: [{ key: "p0", seatNo: 0, displayName: "原玩家", isMe: true, folded: false }, { key: "p1", seatNo: 1, displayName: "对手", isMe: false, folded: true }], entries: [{ id: "r", payerKey: "p1", kind: "super", street: "preflop", fee: 8, compensations: [{ key: "p0", amount: 8 }] }] },
  handLog: { handId: "h", complete: true, entries: [
    { seq: 1, seatNo: 1, displayName: "对手", street: "preflop", action: "roll", amount: 8, isAuto: false, roll: { kind: "super", count: 1, status: "completed" } },
    { seq: 3, seatNo: 0, displayName: "原玩家", street: "preflop", action: "call", amount: 10, isAuto: false },
    { seq: 4, seatNo: 1, displayName: "对手", street: "flop", action: "fold", amount: 0, isAuto: false },
  ] },
}
async function mount(table = base, perspective: "owner" | "public" = "owner") {
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host)
  const render = async (next = table, nextPerspective = perspective) => act(async () => root.render(<SidePanel table={next} perspective={nextPerspective} />))
  await render(); return { host, root, render }
}
async function tab(host: HTMLElement, label: string) { await act(async () => ([...host.querySelectorAll<HTMLElement>('[role="tab"]')].find(e => e.textContent === label)!).click()) }
describe("对局信息三页", () => {
  it("全下自动发完公共牌后仍列出每个已发生阶段，空轮次明确无行动", async () => {
    const value = { ...base, street: "settled", board: ["As", "Kh", "7c", "2d", "Js"],
      handLog: { ...base.handLog!, entries: base.handLog!.entries.filter(e => e.street === "preflop") } }
    const { host, root } = await mount(value)
    const headings = [...host.querySelectorAll('[data-slot="accordion-trigger"]')]
    expect(headings.map(e => e.textContent?.match(/翻牌前|翻牌|转牌|河牌/)?.[0])).toEqual(["翻牌前", "翻牌", "转牌", "河牌"])
    expect(headings.map(e => e.querySelectorAll('[role="img"]').length)).toEqual([0, 3, 4, 5])
    expect(host.textContent?.match(/本轮暂无行动/g)).toHaveLength(3)
    await act(async () => root.unmount())
  })
  it("总览按轮次拆分仅展示已发生阶段，不把未来轮次写成零", async () => {
    const value = { ...base, street: "preflop", board: [], handLog: { ...base.handLog!, entries: base.handLog!.entries.filter(e => e.street === "preflop") } }
    const { host, root } = await mount(value)
    await tab(host, "总览")
    await act(async () => host.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!.click())
    expect([...host.querySelector('table')!.querySelectorAll('th[scope="row"]')].map(e => e.textContent)).toEqual(["翻牌前"])
    await act(async () => root.unmount())
  })
  it("日志只显示本手分轮次的顺序流水，汇总和资产仅在总览", async () => {
    const { host, root } = await mount()
    expect([...host.querySelectorAll('[role="tab"]')].map(e => e.textContent)).toEqual(["日志", "总览", "AI"])
    let panel = host.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("超级 Roll")
    expect([...panel.querySelectorAll('[data-log-seq]')].map(e => e.getAttribute('data-log-seq'))).toEqual(["1", "3", "4"])
    expect(panel.textContent).not.toMatch(/累计下注|本手筹码|本手净变化|待结算补偿/)
    await tab(host, "总览"); panel = host.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("累计下注")
    expect(panel.textContent).toContain("原玩家")
    expect(panel.textContent).not.toContain("新占座者")
    expect(panel.textContent).toContain("已弃牌")
    expect(panel.querySelector('[aria-label="累计下注"]')?.textContent).toContain("30")
    expect(panel.querySelector('[aria-label="Roll 花费"]')?.textContent).toContain("8")
    expect(panel.querySelector('[aria-label="Roll 次数"]')?.textContent).toContain("1")
    await act(async () => root.unmount())
  })
  it("缺完整数据不从recentActions推算总览，旧手事件不进入日志", async () => {
    const value = { ...base, handLog: undefined, potContributions: undefined, rollLedger: undefined, recentActions: [{ seq: 5, seatNo: 0, displayName: "原玩家", street: "preflop", action: "raise", amount: 999, potAfter: 1000, isAuto: false }] }
    const { host, root } = await mount(value)
    expect(host.textContent).toContain("完整日志暂不可用")
    await tab(host, "总览")
    expect(host.querySelector('[aria-label="累计下注"]')?.textContent).toContain("暂不可用")
    expect(host.querySelector('[aria-label="Roll 花费"]')?.textContent).toContain("暂不可用")
    await act(async () => root.unmount())
  })
  it("AI Tab始终存在，私密内容仅本人可读，切换视角/手牌重置", async () => {
    const value = { ...base, persona: "秘密风格", recentActions: [{ seq: 3, seatNo: 0, street: "preflop", action: "call", amount: 10, potAfter: 30, isAuto: false, note: "秘密判断" }] }
    const { host, root, render } = await mount(value)
    await tab(host, "AI"); expect(host.textContent).toContain("秘密判断")
    await render(value, "public")
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("日志")
    await tab(host, "AI"); expect(host.textContent).not.toMatch(/秘密判断|秘密风格/)
    expect(host.textContent).toContain("仅本人入座后可查看")
    await render({ ...base, handId: "next", handNo: 2 })
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("日志")
    expect(host.textContent).not.toContain("超级 Roll")
    await act(async () => root.unmount())
  })
})
