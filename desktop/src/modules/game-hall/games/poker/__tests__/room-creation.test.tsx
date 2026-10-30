/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Lobby } from "../components/Lobby"

const api = vi.hoisted(() => ({ create: vi.fn(), state: vi.fn(), control: vi.fn() }))
vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: { status: "authenticated", connectivity: "online", profile: { user: { id: "user" } } },
  }),
}))
vi.mock("../../../lib/api", () => ({
  gameApi: () => ({
    hall: { overview: async () => ({ sessions: [] }) },
    poker: { lobby: { list: async () => ({ items: [], nextOffset: null }) }, room: { create: api.create }, table: {state:api.state}, control:{set:api.control} },
  }),
}))
vi.mock("../components/LobbyView", () => ({
  LobbyView: ({ onCreate, onConnect }: { onCreate: () => void; onConnect:(code:string)=>void }) => <><button onClick={onCreate}>打开创建</button><button onClick={()=>onConnect("1234")}>接入测试房</button></>,
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
    expect(api.create.mock.calls[0][0]).toMatchObject({variant:"standard52",blindPreset:"1/2"})
    expect(document.querySelector("#poker-variant")?.textContent).toContain("标准 52 张")
    expect(document.querySelector("#poker-blinds")?.textContent).toContain("1/2")
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
  it("大厅接入AI先授权，复制失败重试不再次改变控制版本", async () => {
    api.state.mockReset().mockResolvedValueOnce({mySeatNo:null,controlVersion:4,handoffPending:false}).mockResolvedValueOnce({mySeatNo:null,controlVersion:5,handoffPending:true})
    api.control.mockReset().mockResolvedValue({controlVersion:5,handoffPending:true})
    const copy=vi.fn().mockRejectedValueOnce(new Error("拒绝剪贴板")).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
    const host=document.createElement("div"),root=createRoot(host)
    roots.add(root);document.body.append(host)
    await act(async()=>root.render(<Lobby onRoom={vi.fn()} />))
    await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="接入测试房")!.click())
    const button=[...document.querySelectorAll("button")].find(b=>b.textContent==="复制接入指令")!
    await act(async()=>button.click())
    await act(async()=>button.click())
    expect(api.control).toHaveBeenCalledOnce()
    expect(api.control).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,action:"request_ai"})
    expect(copy).toHaveBeenCalledTimes(2)
    expect(copy.mock.calls[1][0]).toContain("handoffPending=true")
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
