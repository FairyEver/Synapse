/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { HumanControls } from "../components/HumanControls"
import { table } from "./settlement-fixture"
import type { PokerTableView } from "@synapse/shared/game-contracts"
const api = vi.hoisted(() => ({ start: vi.fn(), ready: vi.fn(), control: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { room: { start: api.start }, seat: { ready: api.ready }, control: { set: api.control } } }) }))
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.resetAllMocks(); document.body.replaceChildren() })
const button = (text: string) => [...document.querySelectorAll("button")].find(b => b.textContent === text)
async function render(value = table) {
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host), refresh = vi.fn()
  const update = async (next: PokerTableView, identity = "owner", perspective: "owner" | "public" = "owner") => act(async () => root.render(<HumanControls table={next} identityKey={identity} perspective={perspective} onRefresh={refresh} />))
  await update(value)
  return { root, update, refresh }
}
it("底部无需打开结算即可准备，携带当前手牌版本；准备后显示人数和等待对象", async () => {
  api.ready.mockResolvedValue({ started: false })
  const screen = await render()
  expect(document.body.textContent).toContain("已准备 0 / 2")
  await act(async () => { button("准备下一手")!.click(); button("准备下一手")!.click() })
  expect(api.ready).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", handId: "h1", controlVersion: 3 })
  await screen.update({ ...table, seats: table.seats.map(s => s.isMe ? { ...s, readyForNextHand: true } : s) })
  expect(document.body.textContent).toContain("已准备 1 / 2")
  expect(document.body.textContent).toContain("等待 对手")
  expect(button("已准备")!.disabled).toBe(true)
  await act(async () => screen.root.unmount())
})
it("底部接回后提示重新准备，身份变化不沿用提示，旁观和历史座位不提供准备", async () => {
  const screen = await render({ ...table, controller: "ai" })
  await screen.update({ ...table, controlVersion: 4 })
  expect(document.body.textContent).toContain("已接管，请重新准备")
  await screen.update({ ...table, controlVersion: 4 }, "another")
  expect(document.body.textContent).not.toContain("已接管，请重新准备")
  await screen.update(table, "another", "public")
  expect(button("准备下一手")).toBeUndefined()
  await screen.update({ ...table, mySeatNo: null, seats: table.seats.map(s => ({ ...s, isHistorical: true })) })
  expect(button("准备下一手")).toBeUndefined()
  await act(async () => screen.root.unmount())
})
it("准备失败在底部显示核对与刷新入口，不假定已准备", async () => {
  api.ready.mockRejectedValue(new Error("响应未知"))
  const screen = await render()
  await act(async () => button("准备下一手")!.click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("响应未知")
  expect(button("准备下一手")!.disabled).toBe(false)
  expect(button("刷新牌桌")).toBeDefined()
  await act(async () => screen.root.unmount())
})
it("暂离 AI 不属于准备名单，显示暂离与房间进度，不等待它准备", async () => {
  const screen = await render({ ...table, controller: "ai", seats: table.seats.map(s => s.isMe ? { ...s, status: "sitting_out", nextHandEligible: false } : s) })
  expect(document.body.textContent).not.toContain("等待 AI 确认准备")
  expect(document.body.textContent).toContain("已暂离")
  expect(document.body.textContent).toContain("已准备 0 / 1")
  await act(async () => screen.root.unmount())
})
it("本人切到旁观视角仍可接回自己的 AI 座位，但不能代准备", async () => {
  api.control.mockResolvedValue({})
  const screen = await render({ ...table, controller: "ai" })
  await screen.update({ ...table, controller: "ai" }, "owner", "public")
  await act(async () => button("本人接管")!.click())
  expect(api.control).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", controlVersion: 3, action: "takeover" })
  expect(api.ready).not.toHaveBeenCalled()
  expect(button("准备下一手")).toBeUndefined()
  await act(async () => screen.root.unmount())
})

it("首局准备发送null且全员准备不会代房主开始", async () => {
  const first = { ...table, handId: null, handNo: 0, street: null, settlement: null, isRoomOwner: true, canStart: false }
  const screen = await render(first)
  await act(async () => button("准备")!.click())
  expect(api.ready).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", handId: null, controlVersion: 3 })
  expect(api.start).not.toHaveBeenCalled()
  expect(button("开始")!.disabled).toBe(true)
  const allReady = { ...first, canStart: true, seats: first.seats.map(s => ({ ...s, readyForNextHand: true })) }
  await screen.update(allReady)
  expect(document.body.textContent).toContain("等待房主开始")
  expect(api.start).not.toHaveBeenCalled()
  await act(async () => { button("开始")!.click(); button("开始")!.click() })
  expect(api.start).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", handId: null, controlVersion: 3 })
  await screen.update({ ...allReady, isRoomOwner: false })
  expect(button("开始")).toBeUndefined()
  await act(async () => screen.root.unmount())
})
it("每轮准备后房主仍需手动开始，旁观视角不可开始", async () => {
  const ready = { ...table, isRoomOwner: true, canStart: true, seats: table.seats.map(s => ({ ...s, readyForNextHand: true })) }
  const screen = await render(ready)
  await act(async () => button("开始")!.click())
  expect(api.start).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", handId: "h1", controlVersion: 3 })
  await screen.update(ready, "owner", "public")
  expect(button("开始")).toBeUndefined()
  await act(async () => screen.root.unmount())
})
