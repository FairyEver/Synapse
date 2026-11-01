/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { SettlementPanel } from "../components/SettlementPanel"
const api = vi.hoisted(() => ({ ready: vi.fn(), control: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { seat: { ready: api.ready }, control: { set: api.control } } }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { table } from "./settlement-fixture"
afterEach(() => { vi.resetAllMocks(); document.body.replaceChildren() })
const button = (text: string) => [...document.querySelectorAll("button")].find(b => b.textContent?.includes(text))!
async function render(value = table) {
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host), refresh = vi.fn()
  const update = async (next: PokerTableView) => act(async () => root.render(<SettlementPanel table={next} perspective="owner" identityKey="user" onRefresh={refresh} />))
  await update(value)
  return { root, update, refresh }
}
it("自动展示一次，关闭和轮询不准备，重开保留本手且不渲染暗牌", async () => {
  const screen = await render()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("本局结算")
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("600")
  const folded = document.querySelector('[data-player-seat="1"]')!
  expect(folded.querySelector('[data-face="up"]')).toBeNull()
  expect(folded.textContent).toContain("未公开")
  await act(async () => button("返回牌桌").click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await screen.update({ ...table })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(api.ready).not.toHaveBeenCalled()
  await act(async () => button("本局结算").click())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => screen.root.unmount())
})
it("显式准备携带手牌和控制版本，重复点击不重发，成功后刷新", async () => {
  api.ready.mockResolvedValue({ handId: "h1", started: false })
  const screen = await render()
  await act(async () => { button("准备下一手").click(); button("准备下一手").click() })
  expect(api.ready).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", handId: "h1", controlVersion: 3 })
  expect(screen.refresh).toHaveBeenCalledOnce()
  await screen.update({ ...table, seats: table.seats.map(s => s.isMe ? { ...s, status: "ready", readyForNextHand: true } : s) })
  expect(button("已准备").disabled).toBe(true)
  await screen.update({ ...table, handId: "h2", handNo: 2, street: "preflop", status: "running", settlement: null, awaitingReady: false })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => screen.root.unmount())
})
it("AI控制、旁观、暂离不允许真人代准备；失败保持可核对且不静默准备", async () => {
  const screen = await render({ ...table, controller: "ai" })
  expect(document.body.textContent).toContain("等待 AI 确认准备")
  expect(button("准备下一手")).toBeUndefined()
  await screen.update(table)
  api.ready.mockRejectedValue(new Error("响应未知"))
  await act(async () => button("准备下一手").click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("响应未知")
  expect(api.ready).toHaveBeenCalledOnce()
  await act(async () => screen.root.unmount())
})
it("同一手暂离再回座后必须能够重新准备，不能沿用本机旧确认", async () => {
  api.ready.mockResolvedValue({ handId: "h1", started: false })
  const screen = await render()
  await act(async () => button("准备下一手").click())
  await screen.update({ ...table, seats: table.seats.map(s => s.isMe ? { ...s, status: "ready", readyForNextHand: true } : s) })
  await screen.update({ ...table, seats: table.seats.map(s => s.isMe ? { ...s, status: "sitting_out", nextHandEligible: false } : s) })
  await screen.update(table)
  expect(button("准备下一手")).toBeDefined()
  expect(button("准备下一手").disabled).toBe(false)
  await act(async () => screen.root.unmount())
})
it("结算内直接接管，不代准备，接回后提示重新准备且弹窗保持打开", async () => {
  api.control.mockResolvedValue({ controller: "human", controlVersion: 4 })
  const screen = await render({ ...table, controller: "ai", seats: table.seats.map(s => s.isMe ? { ...s, readyForNextHand: true } : s) })
  await act(async () => { button("本人接管").click(); button("本人接管").click() })
  expect(api.control).toHaveBeenCalledExactlyOnceWith({ roomCode: "1234", controlVersion: 3, action: "takeover" })
  expect(api.ready).not.toHaveBeenCalled()
  await screen.update({ ...table, controlVersion: 4 })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.body.textContent).toContain("已接管，请重新准备")
  expect(button("准备下一手").disabled).toBe(false)
  await screen.update({ ...table, handId: "h2", handNo: 2, awaitingReady: false, settlement: null, status: "running" })
  expect(document.body.textContent).not.toContain("已接管，请重新准备")
  await act(async () => screen.root.unmount())
})
it("结算接管失败显示错误，仍不代准备", async () => {
  api.control.mockRejectedValue(new Error("版本已变化"))
  const screen = await render({ ...table, controller: "ai" })
  await act(async () => button("本人接管").click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("版本已变化")
  expect(api.ready).not.toHaveBeenCalled()
  await act(async () => screen.root.unmount())
})

it("Roll支出与补偿分列，总净变化不替代普通下注投入",async()=>{
  const settlement={...table.settlement!,rules:{...table.settlement!.rules,ruleOptions:{roll:true}},seats:table.settlement!.seats.map((seat,index)=>index?seat:{...seat,delta:12,payout:40,endingStack:112,rollPaid:8,rollReceived:10,pokerDelta:10})}
  const screen=await render({...table,settlement})
  const money=document.querySelector('[data-player-seat="0"] .poker-result-money')!
  const fields=Object.fromEntries([...money.children].map(node=>[node.querySelector('dt')!.textContent,node.querySelector('dd')!.textContent]))
  expect(fields).toMatchObject({投入:"30",收回:"40","Roll 支出":"8","Roll 补偿":"10",总净变化:"+12"})
  await act(async()=>screen.root.unmount())
})
it.each(["points","practice"] as const)("%s结算的Roll净变化使用实际资金单位",async mode=>{
  const screen=await render({...table,mode})
  expect(document.querySelector('.poker-result-net strong small')?.textContent).toBe(mode==="practice"?"筹码":"点数")
  await act(async()=>screen.root.unmount())
})
