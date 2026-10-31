/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { SidePanel } from "../components/SidePanel"
import { PracticeBots } from "../components/PracticeBots"
import { StatusBar } from "../components/StatusBar"
import { tableResponse } from "../../../../../../app-capabilities/game-hall/main/__tests__/response-fixtures"
const api = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }))
vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "owner" } } } }) }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { bot: api } }) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const table = { ...tableResponse, mode: "practice" as const, ownerUserId: "owner", seats: [{ ...tableResponse.seats[0], participantKind: "bot" as const, botId: "bot", isMe: false, aiState: "bot" }], mySeatNo: 1, actionOnSeat: tableResponse.seats[0].seatNo }
describe("陪练房操作", () => {
  it("切换日志和陪练标签不丢失添加请求的幂等标识", async () => {
    api.add.mockReset().mockRejectedValueOnce(new Error("丢响应")).mockResolvedValue({botId:"new",seatNo:1})
    const host=document.createElement("div"),root=createRoot(host)
    const tab=async(label:string)=>act(async()=>{ const target=[...host.querySelectorAll("[role=tab]")].find(t=>t.textContent===label)!; target.dispatchEvent(new MouseEvent("mousedown",{button:0,bubbles:true})) })
    try {
      await act(async()=>root.render(<SidePanel table={table} perspective="owner" extras={<PracticeBots table={table} onRefresh={()=>{}} />} />))
      await tab("陪练")
      await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="添加机器人")!.click())
      const first=api.add.mock.calls[0][0].creationId
      await tab("日志")
      await tab("陪练")
      await act(async()=>[...host.querySelectorAll("button")].find(b=>b.textContent==="重试添加机器人"||b.textContent==="添加机器人")!.click())
      expect(api.add.mock.calls[1][0].creationId).toBe(first)
    } finally { await act(async()=>root.unmount()) }
  })

  it.each([false, true])("添加丢响应后确认移除（pending=%s），下次添加使用新创建意图", async (pending) => {
    api.add.mockReset().mockRejectedValueOnce(new Error("丢响应")).mockResolvedValue({ botId: "replacement", seatNo: 0 })
    api.remove.mockReset().mockResolvedValue({ pending })
    const host = document.createElement("div"), root = createRoot(host)
    const empty = { ...table, maxSeats: 2, mySeatNo: null, seats: [] }
    try {
      await act(async () => root.render(<PracticeBots table={empty} onRefresh={() => {}} />))
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
      const first = api.add.mock.calls[0][0].creationId
      expect(host.querySelector("button")!.textContent).toBe("重试添加机器人")
      // The successful server write becomes visible through the next table poll.
      await act(async () => root.render(<PracticeBots table={{ ...table, maxSeats: 2, mySeatNo: null }} onRefresh={() => {}} />))
      expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true)
      const remove = [...host.querySelectorAll("button")].find((button) => button.textContent?.endsWith(" · 移除"))!
      await act(async () => remove.click())
      expect(api.remove).toHaveBeenCalledWith({ roomCode: table.roomCode, botId: "bot" })
      expect(host.querySelector("button")!.textContent).toBe("添加机器人")
      await act(async () => root.render(<PracticeBots table={empty} onRefresh={() => {}} />))
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
      expect(api.add.mock.calls[1][0].creationId).not.toBe(first)
    } finally { await act(async () => root.unmount()) }
  })
  it("移除失败不丢失尚未确认的添加标识", async () => {
    api.add.mockReset().mockRejectedValueOnce(new Error("丢响应")).mockResolvedValue({ botId: "bot", seatNo: 0 })
    api.remove.mockReset().mockRejectedValue(new Error("移除失败"))
    const host = document.createElement("div"), root = createRoot(host)
    try {
      await act(async () => root.render(<PracticeBots table={table} onRefresh={() => {}} />))
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
      const first = api.add.mock.calls[0][0].creationId
      await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.endsWith(" · 移除"))!.click())
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
      expect(api.add.mock.calls[1][0].creationId).toBe(first)
    } finally { await act(async () => root.unmount()) }
  })
  it("旧房间的迟到移除不刷新新房间，后续添加重试仍复用标识", async () => {
    let resolve!: (value: { pending: boolean }) => void
    api.remove.mockReset().mockImplementation(() => new Promise((done) => { resolve = done }))
    api.add.mockReset().mockRejectedValueOnce(new Error("丢响应")).mockResolvedValue({ botId: "new-room-bot", seatNo: 0 })
    const host = document.createElement("div"), root = createRoot(host)
    const refresh = vi.fn(), next = { ...table, roomCode: "7890" }
    try {
      await act(async () => root.render(<PracticeBots table={table} onRefresh={refresh} />))
      await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.endsWith(" · 移除"))!.click())
      await act(async () => root.render(<PracticeBots table={next} onRefresh={refresh} />))
      await act(async () => resolve({ pending: false }))
      expect(refresh).not.toHaveBeenCalled()
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
      const first = api.add.mock.calls[0][0].creationId
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
      expect(api.add.mock.calls[1][0].creationId).toBe(first)
    } finally { await act(async () => root.unmount()) }
  })
  it("添加丢响应重试复用创建标识，成功后明确新添加使用新标识", async () => {
    api.add.mockReset().mockRejectedValueOnce(new Error("丢响应")).mockResolvedValue({ botId: "new", seatNo: 1 })
    const host = document.createElement("div"), root = createRoot(host), refresh = vi.fn()
    try {
      await act(async () => root.render(<PracticeBots table={table} onRefresh={refresh} />))
      const add = [...host.querySelectorAll("button")].find((b) => b.textContent === "添加机器人")!
      await act(async () => add.click())
      await act(async () => add.click())
      const first = api.add.mock.calls[0][0].creationId
      expect(api.add.mock.calls[1][0].creationId).toBe(first)
      await act(async () => add.click())
      expect(api.add.mock.calls[2][0].creationId).not.toBe(first)
      expect(refresh).toHaveBeenCalledTimes(2)
    } finally { await act(async () => root.unmount()) }
  })
  it("非房主/点数房不显示机器人管理，等待移除不能重复提交", async () => {
    const host = document.createElement("div"), root = createRoot(host)
    try {
      for (const state of [{ ...table, mode: "points" as const }, { ...table, ownerUserId: "other" }]) {
        await act(async () => root.render(<PracticeBots table={state} onRefresh={() => {}} />))
        expect(host.querySelector("button")).toBeNull()
      }
      await act(async () => root.render(<PracticeBots table={{ ...table, seats: table.seats.map((s) => ({ ...s, leavePending: true })) }} onRefresh={() => {}} />))
      expect(host.textContent).toContain("本手后移除")
    } finally { await act(async () => root.unmount()) }
  })
  it("机器人行动不显示掉线、AI或催促按钮", async () => {
    const host = document.createElement("div"), root = createRoot(host)
    try {
      await act(async () => root.render(<StatusBar table={table} perspective="owner" onNudge={() => {}} />))
      expect(host.textContent).toContain("机器人行动中")
      expect(host.textContent).not.toMatch(/提醒他|掉线|的 AI/)
      expect(host.querySelector("button")).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
})
