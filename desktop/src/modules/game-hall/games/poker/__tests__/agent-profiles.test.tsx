/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { AgentProfiles } from "../components/AgentProfiles"

const api = vi.hoisted(() => ({ upsert: vi.fn() }))
vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: { status: "authenticated", connectivity: "online", profile: { user: { id: "user" } } },
  }),
}))
vi.mock("../../../lib/api", () => ({
  gameApi: () => ({
    hall: { overview: async () => ({ sessions: [] }) },
    poker: {
      agent: {
        list: async () => [
          { id: "a", model: "选手A", persona: "原提示词A", versionSeq: 1 },
          { id: "b", model: "选手B", persona: "原提示词B", versionSeq: 1 },
        ],
        upsert: api.upsert,
        versions: async () => [],
      },
      stats: { get: async () => ({ vpip: 0, pfr: 0, aggression: 0, winRate: 0 }) },
      hand: { history: async () => ({ items: [], nextOffset: null }) },
    },
  }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("选手档案异步保存", () => {
  it.each(["edit", "switch", "new", "create-edit"])("保存响应迟到时保留后续的%s草稿", async (mode) => {
    api.upsert.mockReset()
    let resolve!: (value: unknown) => void
    api.upsert.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const host = document.createElement("div"),
      root = createRoot(host)
    document.body.append(host)
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find((element) => element.textContent === label)!
    await act(async () => root.render(<AgentProfiles />))
    if (mode !== "create-edit") await act(async () => button("选手A").click())
    await act(async () =>
      host.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    )
    expect(api.upsert).toHaveBeenLastCalledWith(
      mode === "create-edit"
        ? { id: undefined, model: "", persona: "" }
        : { id: "a", model: "选手A", persona: "原提示词A" },
    )
    if (mode === "edit" || mode === "create-edit") {
      const input = host.querySelector("textarea")!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          input,
          "后续新草稿",
        )
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
    } else await act(async () => button(mode === "switch" ? "选手B" : "新建选手").click())
    await act(async () => resolve({ id: "a", model: "选手A", persona: "原提示词A", versionSeq: 2 }))
    expect(host.querySelector("textarea")!.value).toBe(
      mode === "edit" || mode === "create-edit"
        ? "后续新草稿"
        : mode === "switch" ? "原提示词B" : "",
    )
    if (mode === "create-edit") {
      api.upsert.mockResolvedValueOnce({ id: "a", model: "", persona: "后续新草稿", versionSeq: 3 })
      await act(async () =>
        host.querySelector("form")!.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      )
      expect(api.upsert).toHaveBeenLastCalledWith({ id: "a", model: "", persona: "后续新草稿" })
    }
    await act(async () => root.unmount())
    host.remove()
  })
})
