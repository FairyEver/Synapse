/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableEvent, PokerTableView } from "@synapse/shared/game-contracts"
import { SidePanel } from "../components/SidePanel"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
afterEach(() => document.body.replaceChildren())
const table: PokerTableView = {
  roomCode: "1234", name: null, status: "running", buyIn: 1000, maxSeats: 3,
  handId: "hand", handNo: 1, street: "flop", board: [], pot: 20, dealerSeat: 0,
  actionOnSeat: 1, deadlineMs: 10000, cursor: "1:3", mySeatNo: 0, deckRemaining: 40,
  seats: [{ seatNo: 0, isMe: true, inCurrentHand: true, isHistorical: false,
    displayName: "本人", stack: 100, pendingCompensation: 0, status: "active", streetBet: 2, aiState: "online" }],
  recentActions: [], roll: { enabled: true },
}
const received = { ...table, seats: [{ ...table.seats[0], pendingCompensation: 8 }] }
const event: PokerTableEvent = {
  kind: "roll", handId: "hand", handNo: 1, seq: 3,
  roll: { kind: "super", phase: "start", fee: 8, count: 1, seatNo: 1,
    displayName: "对手", source: "human", compensations: { "0": 8 } },
}
async function mount(value = table, events: PokerTableEvent[] = []) {
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  await act(async () => root.render(<SidePanel table={value} perspective="owner" events={events} />))
  return { host, root }
}
function funds(host: HTMLElement) {
  const panel = host.querySelector('[aria-label="本手筹码"]')!
  expect(panel).not.toBeNull()
  return Object.fromEntries([...panel.querySelectorAll("dt")].map(label => [label.textContent, label.nextElementSibling?.textContent]))
}
describe("牌桌本人冻结补偿快照", () => {
  it("收到补偿后按最新座位快照单列金额，不并入可用筹码", async () => {
    const { host, root } = await mount()
    await act(async () => root.render(<SidePanel table={received} perspective="owner" events={[event]} />))
    expect(funds(host)).toEqual({ "可用筹码": "100", "本手待结算补偿": "8" })
    await act(async () => root.unmount())
  })
  it("刷新后没有事件也保留本手待结算金额", async () => {
    const { host, root } = await mount(received)
    expect(funds(host)).toEqual({ "可用筹码": "100", "本手待结算补偿": "8" })
    expect(host.querySelector('[aria-label="换牌日志"]')).toBeNull()
    await act(async () => root.unmount())
  })
  it("结算快照归零时不从保留的旧事件恢复冻结金额", async () => {
    const { host, root } = await mount(received, [event])
    const settled = { ...received, status: "paused", street: "settled", seats: [{ ...received.seats[0], stack: 108, pendingCompensation: 0 }] }
    await act(async () => root.render(<SidePanel table={settled} perspective="owner" events={[event]} />))
    expect(funds(host)).toEqual({ "可用筹码": "108", "本手待结算补偿": "0" })
    await act(async () => root.unmount())
  })
  it.each(["new-admission", "historical", "departed", "other-user", "public"])("%s不显示旧入座资产为本人当前资金", async scenario => {
    const { host, root } = await mount(received, [event])
    const value = { ...received, seats: [{ ...received.seats[0],
      ...(scenario === "new-admission" ? { inCurrentHand: false, pendingCompensation: undefined, stack: 500 } : {}),
      ...(scenario === "historical" ? { isHistorical: true } : {}),
      ...(scenario === "other-user" ? { isMe: false } : {}),
    }], ...(scenario === "departed" ? { mySeatNo: null } : {}) }
    await act(async () => root.render(<SidePanel table={value} perspective={scenario === "public" ? "public" : "owner"} events={[event]} />))
    expect(host.querySelector('[aria-label="本手筹码"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
