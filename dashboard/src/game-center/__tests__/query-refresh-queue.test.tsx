/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useGameQuery } from "../hooks/useGameQuery"

const account = vi.hoisted(() => ({ id: "first" }))
vi.mock("@/game-center/runtime/account", () => ({
  useAccount: () => ({
    state: {
      status: "authenticated",
      connectivity: "online",
      profile: { user: { id: account.id } },
    },
  }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  account.id = "first"
  vi.useRealTimers()
})

describe("游戏写入后的查询刷新", () => {
  it("读取期间多次失效合并一次尾随刷新，调用者等新数据完成", async () => {
    const first = deferred<string>(),
      latest = deferred<string>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise)
    let refresh!: () => Promise<void>,
      completed = false
    const host = document.createElement("div"),
      root = createRoot(host)
    function View() {
      const query = useGameQuery<string>(read, "agents")
      refresh = query.refresh
      return <output>{query.data}</output>
    }
    await act(async () => root.render(<View />))
    const update = Promise.all([refresh(), refresh()]).then(() => {
      completed = true
    })
    await act(async () => first.resolve("保存前的选手列表"))
    expect(read).toHaveBeenCalledTimes(2)
    expect(completed).toBe(false)
    await act(async () => {
      latest.resolve("包含新选手的列表")
      await update
    })
    expect(host.textContent).toBe("包含新选手的列表")
    expect(completed).toBe(true)
    await act(async () => root.unmount())
  })
  it.each(["unmount", "identity"])("%s 结束待执行刷新，不向旧上下文继续请求", async (mode) => {
    const first = deferred<string>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("新账号数据")
    let refresh!: () => Promise<void>,
      completed = false
    const host = document.createElement("div"),
      root = createRoot(host)
    function View() {
      const query = useGameQuery<string>(read, "agents")
      refresh = query.refresh
      return <output>{query.data}</output>
    }
    await act(async () => root.render(<View />))
    const update = refresh().then(() => {
      completed = true
    })
    if (mode === "unmount") await act(async () => root.unmount())
    else {
      account.id = "second"
      await act(async () => root.render(<View />))
    }
    expect(completed).toBe(true)
    await update
    await act(async () => first.resolve("旧账号数据"))
    expect(read).toHaveBeenCalledTimes(mode === "unmount" ? 1 : 2)
    if (mode === "identity") {
      expect(host.textContent).toBe("新账号数据")
      await act(async () => root.unmount())
    }
  })
  it("轮询不会在读取繁忙时积攒尾随请求", async () => {
    vi.useFakeTimers()
    const first = deferred<string>(),
      read = vi.fn().mockReturnValue(first.promise)
    const host = document.createElement("div"),
      root = createRoot(host)
    function View() {
      useGameQuery(read, "poll", 10)
      return null
    }
    await act(async () => root.render(<View />))
    await act(async () => vi.advanceTimersByTimeAsync(50))
    await act(async () => first.resolve("最新数据"))
    expect(read).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
})
