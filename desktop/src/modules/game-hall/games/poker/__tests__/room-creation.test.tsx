/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Lobby } from "../components/Lobby"

const api = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: { status: "authenticated", connectivity: "online", profile: { user: { id: "user" } } },
  }),
}))
vi.mock("../../../lib/api", () => ({
  gameApi: () => ({
    hall: { overview: async () => ({ sessions: [] }) },
    poker: { lobby: { list: async () => ({ items: [], nextOffset: null }) }, room: { create: api.create } },
  }),
}))
vi.mock("../components/LobbyView", () => ({
  LobbyView: ({ onCreate }: { onCreate: () => void }) => <button onClick={onCreate}>打开创建</button>,
}))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots = new Set<Root>()
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  document.body.replaceChildren()
})

async function open(host: HTMLElement) {
  await act(async () => host.querySelector("button")!.click())
}
async function submit() {
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}
describe("建房请求身份", () => {
  it.each(["retry", "change", "reopen"])("响应丢失后%s采用对应的创建意图", async (mode) => {
    api.create.mockReset().mockRejectedValueOnce(new Error("响应丢失"))
      .mockResolvedValueOnce({ roomCode: "1234" })
    const host = document.createElement("div"), root = createRoot(host), onRoom = vi.fn()
    roots.add(root)
    document.body.append(host)
    await act(async () => root.render(<Lobby onRoom={onRoom} />))
    await open(host)
    await submit()
    const first = api.create.mock.calls[0][0].creationId
    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    if (mode === "change") {
      const input = document.querySelector<HTMLInputElement>("#poker-room-name")!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "另一桌")
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
    } else if (mode === "reopen") {
      await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click())
      await open(host)
    }
    await submit()
    const second = api.create.mock.calls[1][0].creationId
    if (mode === "retry") expect(second).toBe(first)
    else expect(second).not.toBe(first)
    expect(onRoom).toHaveBeenCalledWith("1234")
  })
  it("关闭旧表单再打开后，旧创建响应不关闭新表单或导航", async () => {
    let resolve!: (value: { roomCode: string }) => void
    api.create.mockReset().mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const host = document.createElement("div"), root = createRoot(host), onRoom = vi.fn()
    roots.add(root)
    document.body.append(host)
    await act(async () => root.render(<Lobby onRoom={onRoom} />))
    await open(host)
    await submit()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click())
    await open(host)
    await act(async () => resolve({ roomCode: "1234" }))
    expect(onRoom).not.toHaveBeenCalled()
    expect(document.querySelector("form")).not.toBeNull()
  })
})
