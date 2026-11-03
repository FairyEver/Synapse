/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
import { PokerLogRail } from "../components/PokerLogRail"
import { matchOverview } from "../lib/match-information"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const table: PokerTableView = {
  ...tableResponse, mode: "practice",
  potContributions: { handId: "hand", status: "pending", total: 2, players: [{ key: "one", seatNo: 0, displayName: "选手", isMe: true, folded: false, amount: 2 }] },
  handLog: { handId: "hand", complete: true, entries: [
    { seq: 1, seatNo: 0, displayName: "选手", street: "preflop", action: "call", amount: 2, isAuto: false },
    { seq: 2, seatNo: 0, displayName: "选手", street: "preflop", action: "card", amount: 8, isAuto: false,
      card: { id: "07", artId: "v2/07", name: "五选其一", description: "从五张候选中选一张。", status: "choice_required" } },
  ] },
}

function pointer(target: Element, type: string, pointerType: string) {
  target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0 }), { pointerType, pointerId: 1, isPrimary: true }))
}

it("公开日志按最新排序，悬停、键盘、触摸打开同一详情且 Escape 保留焦点", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const render = async (view = table) => act(async () => root.render(<PokerLogRail table={view} />))
  const tooltip = () => document.body.querySelector('[role="tooltip"]')
  try {
    await render()
    const [card, call] = host.querySelectorAll("button")
    expect([card.ariaLabel, call.ariaLabel]).toEqual(["选手，五选其一", "选手，跟注"])
    expect(card.textContent).toBe("")
    expect(card.querySelector("img")?.getAttribute("src")).toContain("/v2/07.png")
    expect(tooltip()).toBeNull()

    await act(async () => pointer(card, "pointerover", "mouse"))
    expect(tooltip()?.textContent).toContain("待选择 · 实付 8 筹码入主池")
    expect(card.getAttribute("aria-describedby")).toBe(tooltip()?.id)
    await act(async () => card.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(tooltip()).toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
      call.focus()
    })
    expect(tooltip()?.textContent).toContain("2 筹码")
    expect(document.activeElement).toBe(call)
    await act(async () => call.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(tooltip()).toBeNull()
    expect(document.activeElement).toBe(call)

    await act(async () => {
      pointer(card, "pointerdown", "touch")
      pointer(card, "pointerup", "touch")
      card.click()
    })
    expect(tooltip()?.textContent).toContain("从五张候选中选一张。")
    await act(async () => pointer(call, "pointerover", "mouse"))
    expect(tooltip()?.textContent).toContain("从五张候选中选一张。")
    await act(async () => call.focus())
    expect(tooltip()?.textContent).toContain("从五张候选中选一张。")
    await act(async () => call.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(tooltip()).toBeNull()
    expect(document.activeElement).toBe(card)
    await act(async () => pointer(call, "pointerover", "mouse"))
    expect(tooltip()?.textContent).toContain("2 筹码")
    await render({ ...table, handId: "another-hand", recentActions: [] })
    expect(tooltip()).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it("总览将卡费和下注分列，日志不完整时不推算费用", () => {
  const { bet, cardFees, players } = matchOverview(table)
  expect({ bet, cardFees, rounds: players[0].rounds }).toMatchObject({ bet: 2, cardFees: 8, rounds: [{ bet: 2, cardFees: 8 }] })
  expect(matchOverview({ ...table, handLog: { ...table.handLog!, complete: false } }).cardFees).toBeUndefined()
})

it("悬停分别显示各轮新翻的牌，以及能力牌详情和实际公开的底牌", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const view: PokerTableView = {
    ...table, board: ["2c", "3h", "4d", "5s", "6c"], hole: ["As", "Ks"],
    handLog: { ...table.handLog!, entries: [table.handLog!.entries[0], {
      ...table.handLog!.entries[1],
      effects: [{ kind: "revealed", target: { seatNo: 1, displayName: "原对手" }, cards: ["Qh"] }],
    }] },
  }
  const tooltip = () => document.body.querySelector('[role="tooltip"]')!
  const faces = () => Array.from(tooltip().querySelectorAll("[data-card]"), node => node.getAttribute("data-card"))
  const hover = (name: string) => act(async () => pointer(host.querySelector(`button[aria-label="${name}"]`)!, "pointerover", "mouse"))
  try {
    await act(async () => root.render(<PokerLogRail table={view} />))
    await hover("翻牌")
    expect(faces()).toEqual(["2c", "3h", "4d"])
    await hover("河牌")
    expect(faces()).toEqual(["6c"])
    await hover("选手，五选其一")
    expect(tooltip().textContent).toContain("原对手公开底牌")
    expect(faces()).toEqual(["Qh"])
    expect(tooltip().querySelector('[data-ability-size="lg"] img')?.getAttribute("src")).toContain("/v2/07.png")
    expect(tooltip().querySelector(".poker-ability-face-name")?.textContent).toBe("五选其一")
    expect(tooltip().querySelector(".poker-ability-details-text")?.textContent).toBe("从五张候选中选一张。")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
