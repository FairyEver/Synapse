/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { usePokerCardMotion } from "../hooks/usePokerCardMotion"
import { cardTable } from "./card-stage-fixture"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function mount(initial: PokerTableView) {
  const host = document.createElement("div"), root = createRoot(host)
  function Motion({ table, scope }: { table: PokerTableView; scope: string }) {
    const { batch, queued, complete } = usePokerCardMotion(table, scope)
    return <button data-queued={queued?.deals.join(",")} onClick={() => batch && complete(batch)}>{batch?.deals.join(",")}</button>
  }
  const render = (table: PokerTableView, scope = "owner") => act(async () => root.render(<Motion table={table} scope={scope} />))
  await render(initial)
  return { host, render, close: () => act(async () => root.unmount()) }
}

it("首次进入不重播，下一手发牌并在它结束后接新增公共牌", async () => {
  const initial = { ...cardTable, handNo: 1 }
  const { host, render, close } = await mount(initial)
  try {
    expect(host.textContent).toBe("")
    const next = { ...initial, handNo: 2, handId: "new", street: "preflop" as const, board: [], actionSeq: 0 }
    await render(next)
    expect(host.textContent).toContain("hole:0:0")
    await render({ ...next, board: ["As", "Kd", "Qc"], actionSeq: 1 })
    const button = host.querySelector("button")!
    expect(button.dataset.queued).toBe("board:0,board:1,board:2")
    await act(async () => button.click())
    expect(host.textContent).toBe("board:0,board:1,board:2")
  } finally { await close() }
})

it("断流、视角切换或减少动态效果时直接显示快照", async () => {
  vi.useFakeTimers()
  const initial = { ...cardTable, board: [] }
  const { host, render, close } = await mount(initial)
  try {
    vi.advanceTimersByTime(4000)
    await render({ ...initial, board: ["As"] })
    expect(host.textContent).toBe("")
    await render({ ...initial, board: ["As", "Kd"] }, "public")
    expect(host.textContent).toBe("")
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
    await close()
    const reduced = await mount(initial)
    try {
      await reduced.render({ ...initial, board: ["As"] })
      expect(reduced.host.textContent).toBe("")
    } finally { await reduced.close() }
  } finally { if (host.firstChild) await close() }
})
