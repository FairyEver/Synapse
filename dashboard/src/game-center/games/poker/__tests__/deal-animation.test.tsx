/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Table } from "../components/Table"
import { usePokerCardMotion } from "../hooks/usePokerCardMotion"
import { cardTable } from "./card-stage-fixture"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function mount(initial: PokerTableView) {
  const host = document.createElement("div"), root = createRoot(host)
  function Motion({ table, scope }: { table: PokerTableView; scope: string }) {
    const { batch, complete } = usePokerCardMotion(table, scope)
    return <button onClick={() => batch && complete(batch)}>{batch?.casts.map(cast => cast.id).join(",")}</button>
  }
  const render = (table: PokerTableView, scope = "owner") => act(async () => root.render(<Motion table={table} scope={scope} />))
  await render(initial)
  return { host, render, close: () => act(async () => root.unmount()) }
}

const initialCardTable: PokerTableView = { ...cardTable, cards: { ...cardTable.cards!, version: "cards-v2" } }

function play(before: PokerTableView, seq: number): PokerTableView {
  const cards = before.cards!
  return { ...before, actionSeq: seq, cards: { ...cards, used: [
    ...cards.used, { id: `play-${seq}`, cardId: "22", name: "灵感迸发", seatNo: 0, seq, status: "completed" },
  ] } }
}

it("连续三次确认用牌时，后到的快照不会覆盖已经排队的动画", async () => {
  const { host, render, close } = await mount(initialCardTable)
  try {
    expect(host.textContent).toBe("")
    const first = play(initialCardTable, 4), second = play(first, 5), third = play(second, 6)
    await render(first)
    await render(second)
    await render(third)
    const button = host.querySelector("button")!
    expect(host.textContent).toBe("play-4")
    await act(async () => button.click())
    expect(host.textContent).toBe("play-5")
    await act(async () => button.click())
    expect(host.textContent).toBe("play-6")
  } finally { await close() }
})

it("断流、视角切换或减少动态效果时直接显示快照", async () => {
  vi.useFakeTimers()
  const { host, render, close } = await mount(initialCardTable)
  try {
    vi.advanceTimersByTime(4000)
    await render(play(initialCardTable, 4))
    expect(host.textContent).toBe("")
    await render(play(initialCardTable, 5), "public")
    expect(host.textContent).toBe("")
  } finally { await close() }

  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
  const reduced = await mount(initialCardTable)
  try {
    await reduced.render(play(initialCardTable, 4))
    expect(reduced.host.textContent).toBe("")
  } finally { await reduced.close() }
})

it("真实牌桌保留逐张揭示，尺寸未测得时也不会直接亮出整排牌", async () => {
  vi.useFakeTimers()
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  const initial = { ...cardTable, cards: undefined, ruleOptions: undefined, board: [], street: "preflop" as const }
  const render = (table: PokerTableView) => act(async () => root.render(<Table table={table} perspective="owner" onPerspective={() => {}} onBack={() => {}} />))
  try {
    await render(initial)
    await render({ ...initial, street: "flop", board: ["As", "Kd", "Qc"], actionSeq: 4 })
    const slots = [...host.querySelectorAll<HTMLElement>(".poker-deal-slot")].slice(0, 3)
    expect(slots.map(slot => slot.dataset.dealt)).toEqual(["false", "false", "false"])
    expect(slots[0].querySelector("[data-card]")).toBeNull()
    await act(async () => vi.advanceTimersByTime(55))
    expect(slots.map(slot => slot.dataset.dealt)).toEqual(["true", "false", "false"])
    expect(slots[0].querySelector('[data-card="As"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
