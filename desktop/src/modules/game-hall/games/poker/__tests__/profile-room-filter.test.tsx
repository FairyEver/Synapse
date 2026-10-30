/** @vitest-environment jsdom */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AgentProfiles } from "../components/AgentProfiles"

const api = vi.hoisted(() => ({ hall: vi.fn(), stats: vi.fn(), connectivity: "online" }))
vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: {
      status: "authenticated",
      connectivity: api.connectivity,
      profile: { user: { id: "user" } },
    },
  }),
}))
vi.mock("../../../lib/api", () => ({
  gameApi: () => ({
    hall: { overview: api.hall },
    poker: {
      agent: { list: async () => [] },
      stats: { get: api.stats },
      hand: { history: async () => ({ items: [], nextOffset: null }) },
    },
  }),
}))
// Keep the page's selection binding while avoiding shared Radix geometry in jsdom.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
  }) => (
    <select
      aria-label="对比牌桌"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const seated = { sessions: [{ game: "poker", roomCode: "4821" }] }
const numbers = { vpip: 0, pfr: 0, aggression: 0, winRate: 0.1 }
const roots = new Set<Root>()
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function render() {
  const host = document.createElement("div"),
    root = createRoot(host)
  roots.add(root)
  await act(async () => root.render(<AgentProfiles />))
  return { host, root }
}
async function selectRoom(host: HTMLElement) {
  await act(async () => {
    const select = host.querySelector("select")!
    select.value = "4821"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  api.connectivity = "online"
  api.hall.mockReset().mockResolvedValue(seated)
  api.stats.mockReset().mockResolvedValue(numbers)
})
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  vi.useRealTimers()
})

describe("档案同桌筛选生命周期", () => {
  it("大厅确认最后一个座位消失后恢复全局统计，旧房间迟到错误不再困住页面", async () => {
    const oldStats = deferred<unknown>()
    let globalReads = 0
    api.stats.mockImplementation((input: { roomCode?: string }) =>
      input.roomCode
        ? oldStats.promise
        : Promise.resolve({ ...numbers, winRate: ++globalReads === 1 ? 0.1 : 0.75 }),
    )
    const { host } = await render()
    await selectRoom(host)
    expect(api.stats).toHaveBeenLastCalledWith({ roomCode: "4821" })
    api.hall.mockResolvedValueOnce({ sessions: [] })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(api.stats).toHaveBeenLastCalledWith({})
    expect(host.textContent).toContain("75%")
    await act(async () => oldStats.reject(new Error("POKER_SEAT_NOT_FOUND")))
    expect(host.textContent).not.toContain("POKER_SEAT_NOT_FOUND")
    expect(host.querySelector("select")).toBeNull()
  })
  it("大厅临时错误、离线及重连首读等待不清除仍有效的选择", async () => {
    const { host, root } = await render()
    await selectRoom(host)
    api.hall.mockRejectedValueOnce(new Error("临时网络错误"))
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(host.querySelector("select")!.value).toBe("4821")
    api.connectivity = "offline"
    await act(async () => root.render(<AgentProfiles />))
    const reconnect = deferred<typeof seated>()
    api.hall.mockReturnValueOnce(reconnect.promise)
    api.connectivity = "online"
    await act(async () => root.render(<AgentProfiles />))
    expect(api.stats).toHaveBeenLastCalledWith({ roomCode: "4821" })
    await act(async () => reconnect.resolve(seated))
    expect(host.querySelector("select")!.value).toBe("4821")
  })
})
