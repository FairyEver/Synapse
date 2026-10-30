/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GameQueryFeedback } from "../components/GameQueryFeedback"
import { useGameMutation, useGameQuery } from "../hooks/useGameQuery"
const account = vi.hoisted(() => ({ id: "first", connectivity: "online" }))
vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: {
      status: "authenticated",
      connectivity: account.connectivity,
      profile: { user: { id: account.id } },
    },
  }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
afterEach(() => {
  account.id = "first"
  account.connectivity = "online"
})
describe("游戏查询恢复与异步操作生命周期", () => {
  it("首读失败可以取得错误并手动重试，成功后清除错误", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValueOnce("已恢复")
    const host = document.createElement("div"),
      root = createRoot(host)
    function View() {
      const q = useGameQuery<string>(read, "test")
      return (
        <>
          <output>{q.data}</output>
          <GameQueryFeedback query={q} />
        </>
      )
    }
    await act(async () => root.render(<View />))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("网络中断")
    await act(async () => host.querySelector("button")!.click())
    expect(host.querySelector("output")?.textContent).toBe("已恢复")
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await act(async () => root.unmount())
  })
  it("刷新失败保留最后成功的数据，同时标识错误，恢复后替换旧数据", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce("旧牌况")
      .mockRejectedValueOnce(new Error("连接失败"))
      .mockResolvedValueOnce("新牌况")
    const host = document.createElement("div"),
      root = createRoot(host)
    function View() {
      const q = useGameQuery<string>(read, "refresh")
      return (
        <>
          <output>{q.data}</output>
          <GameQueryFeedback query={q} />
          <button onClick={() => void q.refresh()}>刷新</button>
        </>
      )
    }
    await act(async () => root.render(<View />))
    await act(async () => host.querySelector("button")!.click())
    expect(host.querySelector("output")?.textContent).toBe("旧牌况")
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("连接失败")
    await act(async () =>
      host
        .querySelector('[role="alert"] button')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    )
    expect(host.querySelector("output")?.textContent).toBe("新牌况")
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await act(async () => root.unmount())
  })
  it("切换账号后迟到的读取结果不能覆盖新账号数据", async () => {
    const pending = deferred<string>(),
      read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce("新账号数据")
    const host = document.createElement("div"),
      root = createRoot(host)
    function View() {
      const q = useGameQuery<string>(read, "identity")
      return <output>{q.data}</output>
    }
    await act(async () => root.render(<View />))
    account.id = "second"
    await act(async () => root.render(<View />))
    await act(async () => pending.resolve("旧账号私密数据"))
    expect(host.textContent).toBe("新账号数据")
    await act(async () => root.unmount())
  })
  it("离线时呈现可理解的状态，不发请求也不无限显示加载", async () => {
    account.connectivity = "offline"
    const read = vi.fn(),
      host = document.createElement("div"),
      root = createRoot(host)
    function View() {
      const q = useGameQuery(read, "offline")
      return (
        <output>
          {q.error} · {String(q.loading)}
        </output>
      )
    }
    await act(async () => root.render(<View />))
    expect(host.textContent).toContain("离线")
    expect(host.textContent).toContain("false")
    expect(read).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
  it.each(["unmount", "identity"])("%s 后忽略迟到的写操作结果，不再触发导航", async (mode) => {
    const pending = deferred<string>(),
      onNavigate = vi.fn(),
      host = document.createElement("div"),
      root = createRoot(host)
    let completion!: Promise<void>
    function View() {
      const mutation = useGameMutation()
      return (
        <button
          onClick={() => {
            completion = mutation
              .run(() => pending.promise)
              .then((result) => {
                if (result) onNavigate(result)
              })
          }}
        >
          创建
        </button>
      )
    }
    await act(async () => root.render(<View />))
    await act(async () => host.querySelector("button")!.click())
    if (mode === "unmount") await act(async () => root.unmount())
    else {
      account.id = "second"
      await act(async () => root.render(<View />))
    }
    await act(async () => {
      pending.resolve("旧房间")
      await completion
    })
    expect(onNavigate).not.toHaveBeenCalled()
    if (mode !== "unmount") await act(async () => root.unmount())
  })
})
