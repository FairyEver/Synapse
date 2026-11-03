/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { PokerMatchOverviewDialog } from "../components/PokerMatchOverviewDialog"

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
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  await act(async () => root.render(<PokerMatchOverviewDialog table={table} perspective={perspective} compact={false} open onOpenChange={vi.fn()} />))
  return { root, dialog: document.querySelector('[role="dialog"][aria-label="总览"]')! }
}

describe("对局总览", () => {
  it.each([
    ["preflop", [], ["翻牌前"]],
    ["settled", ["As", "Kh", "7c", "2d", "Js"], ["翻牌前", "翻牌", "转牌", "河牌"]],
  ] as const)("按轮次拆分仅展示 %s 时已发出的阶段", async (street, board, stages) => {
    const value = { ...base, street, board: [...board], handLog: { ...base.handLog!, entries: base.handLog!.entries.filter(e => e.street === "preflop") } }
    const { dialog, root } = await mount(value)
    await act(async () => dialog.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!.click())
    expect([...dialog.querySelectorAll('table[aria-label="原玩家各轮投入"] th[scope="row"]')].map(e => e.textContent)).toEqual(stages)
    await act(async () => root.unmount())
  })

  it("打开即展示累计、原参赛身份及弃牌状态，日志和 AI 私密内容不进入弹窗", async () => {
    const value = { ...base, persona: "秘密风格", recentActions: [{ seq: 3, seatNo: 0, street: "preflop", action: "call", amount: 10, potAfter: 30, isAuto: false, note: "秘密判断" }] }
    const { dialog, root } = await mount(value)
    expect(dialog.querySelector('[role="tablist"]')).toBeNull()
    expect(dialog.querySelector('[data-log-seq]')).toBeNull()
    expect(dialog.textContent).not.toMatch(/秘密判断|秘密风格|新占座者/)
    expect(dialog.textContent).toContain("原玩家")
    expect(dialog.textContent).toContain("已弃牌")
    expect(dialog.querySelector('[aria-label="累计下注"]')?.textContent).toContain("30")
    expect(dialog.querySelector('[aria-label="Roll 花费"]')?.textContent).toContain("8")
    expect(dialog.querySelector('[aria-label="Roll 次数"]')?.textContent).toContain("1")
    await act(async () => root.unmount())
  })

  it("缺完整数据不从 recentActions 推算总览", async () => {
    const value = { ...base, handLog: undefined, potContributions: undefined, rollLedger: undefined, recentActions: [{ seq: 5, seatNo: 0, displayName: "原玩家", street: "preflop", action: "raise", amount: 999, potAfter: 1000, isAuto: false }] }
    const { dialog, root } = await mount(value)
    expect(dialog.querySelector('[aria-label="累计下注"]')?.textContent).toContain("暂不可用")
    expect(dialog.querySelector('[aria-label="Roll 花费"]')?.textContent).toContain("暂不可用")
    await act(async () => root.unmount())
  })
})
