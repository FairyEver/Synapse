/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi } from "vitest"
const current = vi.hoisted(() => ({ userId: "first" }))
vi.mock("@/game-center/runtime/account", () => ({
  useAccount: () => ({
    state: { status: "authenticated", profile: { user: { id: current.userId } } },
  }),
}))
vi.mock("../hooks/useHallOverview", () => ({
  useHallOverview: () => ({ authenticated: true, data: { games: [] } }),
}))
vi.mock("../hooks/useGameQuery", () => ({ useGameMutation: () => ({ run: vi.fn() }) }))
vi.mock("../game-registry", async () => {
  const { useState } = await import("react")
  function Page() {
    const [draft, setDraft] = useState("")
    return <input aria-label="私密草稿" value={draft} onChange={(e) => setDraft(e.target.value)} />
  }
  return { GAME_RENDERERS: { "/poker": { Page, Preview: () => null } } }
})
import { GameHallApp } from "../GameHallApp"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
describe("账号切换私密状态", () => {
  it("切换账号时销毁游戏内提示词等本地草稿", async () => {
    const host = document.createElement("div"),
      root = createRoot(host),
      request = { requestId: "r", path: "/poker/4821" }
    document.body.append(host)
    await act(async () => root.render(<GameHallApp openRequest={request} />))
    const input = host.querySelector("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "账号一的私密提示词",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(input.value).toBe("账号一的私密提示词")
    current.userId = "second"
    await act(async () => root.render(<GameHallApp openRequest={request} />))
    expect(host.querySelector("input")!.value).toBe("")
    await act(async () => root.unmount())
    host.remove()
  })
})
