/** @vitest-environment jsdom */
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AgentProfiles } from "../components/AgentProfiles"

const api = vi.hoisted(() => ({ upsert: vi.fn(), agents: vi.fn(), versions: vi.fn() }))
vi.mock("@/game-center/runtime/account", () => ({
  useAccount: () => ({
    state: { status: "authenticated", connectivity: "online", profile: { user: { id: "user" } } },
  }),
}))
vi.mock("../../../lib/api", () => ({
  gameApi: () => ({
    hall: { overview: async () => ({ sessions: [] }) },
    poker: {
      agent: {
        list: api.agents,
        upsert: api.upsert,
        versions: api.versions,
      },
      stats: { get: async () => ({ vpip: 0, pfr: 0, aggression: 0, winRate: 0 }) },
      hand: { history: async () => ({ items: [], nextOffset: null }) },
    },
  }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
beforeEach(() => {
  api.versions.mockReset().mockResolvedValue([])
  api.agents.mockReset().mockResolvedValue([
    { id: "a", model: "选手A", persona: "原提示词A", versionSeq: 1 },
    { id: "b", model: "选手B", persona: "原提示词B", versionSeq: 1 },
  ])
})

describe("选手档案异步保存", () => {
  it.each([
    ["before-response", false],
    ["before-response", true],
    ["during-refresh", false],
    ["during-refresh", true],
    ["failed-refresh", false],
  ] as const)("%s切回A，继续编辑=%s时同步成功快照且保护新输入", async (timing, dirty) => {
    let finishSave!: (value: unknown) => void,
      finishList!: (value: unknown) => void,
      failList!: (error: Error) => void
    const saved = { id: "a", model: "选手A", persona: "已保存风格二", versionSeq: 2 }
    const version = { id: "v2", versionNo: 2, persona: saved.persona, handCount: 0, firstUsedAt: null }
    const latest = [saved, { id: "b", model: "选手B", persona: "原提示词B", versionSeq: 1 }]
    const refreshing = new Promise((resolve, reject) => {
      finishList = resolve
      failList = reject
    })
    api.upsert.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    const host = document.createElement("div"),
      root = createRoot(host)
    const click = async (label: string) =>
      act(async () =>
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent === label)!
          .click(),
      )
    const type = async (value: string) =>
      act(async () => {
        const input = host.querySelector("textarea")!
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          input,
          value,
        )
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
    const submit = async () =>
      act(async () =>
        host
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      )
    try {
      await act(async () =>
        root.render(
          <StrictMode>
            <AgentProfiles />
          </StrictMode>,
        ),
      )
      await click("选手A")
      await type(saved.persona)
      await submit()
      await click("选手B")
      if (timing !== "before-response") {
        api.agents.mockReturnValueOnce(refreshing)
        api.versions.mockResolvedValue([version])
        await act(async () => finishSave(saved))
      }
      await click("选手A")
      if (dirty) await type("切回后的新草稿")
      if (timing === "before-response") {
        api.agents.mockResolvedValue(latest)
        api.versions.mockResolvedValue([version])
        await act(async () => finishSave(saved))
      } else if (timing === "failed-refresh") {
        await act(async () => failList(new Error("列表刷新失败")))
      } else await act(async () => finishList(latest))
      let expected = dirty ? "切回后的新草稿" : saved.persona,
        expectedModel = saved.model
      expect(host.querySelector("textarea")!.value).toBe(expected)
      expect(host.querySelector("summary")?.textContent).toContain("v2")
      if (timing === "failed-refresh") {
        const external = { ...saved, model: "服务端新模型" }
        api.agents.mockResolvedValue([external, latest[1]])
        await click("重试")
        expect(host.querySelector<HTMLInputElement>("#poker-model")!.value).toBe(external.model)
        await click("选手B")
        await click(external.model)
        expect(host.querySelector<HTMLInputElement>("#poker-model")!.value).toBe(external.model)
        expect(host.querySelector("textarea")!.value).toBe(external.persona)
        expected = external.persona
        expectedModel = external.model
      }
      api.upsert.mockResolvedValueOnce({ ...saved, model: expectedModel, persona: expected })
      api.agents.mockResolvedValue([{ ...saved, model: expectedModel, persona: expected }, latest[1]])
      await submit()
      expect(api.upsert).toHaveBeenLastCalledWith({ id: "a", model: expectedModel, persona: expected })
    } finally {
      await act(async () => root.unmount())
    }
  })

  it.each(["retry", "edit", "new"])("新草稿响应丢失后%s保持对应创建身份，确认后改用实体id", async (mode) => {
    api.upsert.mockReset().mockRejectedValueOnce(new Error("响应丢失"))
      .mockResolvedValue({ id: "saved", model: "", persona: "", versionSeq: 0 })
    const host = document.createElement("div"), root = createRoot(host)
    const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent === label)!
    const submit = async () => act(async () => host.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ))
    try {
      await act(async () => root.render(<AgentProfiles />))
      await submit()
      const first = api.upsert.mock.calls[0][0].creationId
      expect(first).toMatch(/^[0-9a-f-]{36}$/i)
      if (mode === "edit") {
        await act(async () => {
          const input = host.querySelector("textarea")!
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "新的提示词")
          input.dispatchEvent(new Event("input", { bubbles: true }))
        })
      } else if (mode === "new") await act(async () => button("新建选手").click())
      await submit()
      const second = api.upsert.mock.calls[1][0].creationId
      if (mode === "new") expect(second).not.toBe(first)
      else expect(second).toBe(first)
      await submit()
      expect(api.upsert.mock.calls[2][0].id).toBe("saved")
      expect(api.upsert.mock.calls[2][0]).not.toHaveProperty("creationId")
    } finally {
      await act(async () => root.unmount())
    }
  })

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
        ? { creationId: expect.stringMatching(/^[0-9a-f-]{36}$/i), model: "", persona: "" }
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
