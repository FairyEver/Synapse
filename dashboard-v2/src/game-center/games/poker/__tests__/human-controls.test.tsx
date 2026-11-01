/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { HumanControls } from "../components/HumanControls"
import { canvasFit, mergeTableEvents } from "../lib/table-layout"
import { betPresets } from "../lib/action-view"
const api = vi.hoisted(() => ({ act: vi.fn(), control: vi.fn(), join: vi.fn(), sit: vi.fn(), leave: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { action: { act: api.act }, control: { set: api.control }, seat: { join: api.join, sit: api.sit, leave: api.leave } } }) }))
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const table: PokerTableView = { roomCode: "1234", name: null, status: "running", buyIn: 1000, maxSeats: 2, handId: "hand", handNo: 1, street: "flop", board: [], pot: 20, dealerSeat: 0, actionOnSeat: 0, deadlineMs: 20000, cursor: "1:3", mySeatNo: 0, seats: [{ seatNo: 0, displayName: "本人", isMe: true, stack: 100, status: "active", streetBet: 2, aiState: "online", controller: "human" }], recentActions: [], deckRemaining: 40, actionSeq: 3, controlVersion: 4, controller: "human", legalActions: ["fold", "call", "raise", "allin"], toCall: 4, minRaiseTo: 10, maxRaiseTo: 102 }
afterEach(() => { vi.resetAllMocks(); document.body.replaceChildren() })
async function render(value = table) { const host = document.createElement("div"), root = createRoot(host); document.body.append(host); await act(async () => root.render(<HumanControls table={value} perspective="owner" onRefresh={vi.fn()} />)); return { host, root } }
function button(host: HTMLElement, label: string) { return [...host.querySelectorAll("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label || b.getAttribute("aria-label")?.startsWith(label + " "))! }
async function openManagement(host: HTMLElement) { await act(async () => button(host, "更多牌桌操作").click()) }
describe("真人牌桌操作", () => {
 it("上手历史座位不能阻止离桌后重新申请入座，实际容量由服务端裁决", async () => {
  api.join.mockResolvedValue({seatNo:0})
  const departed={...table,mySeatNo:null,controller:null,seats:[{...table.seats[0],status:"folded"},{...table.seats[0],seatNo:1,isMe:false}]}
  const {host,root}=await render(departed)
  expect(button(host,"本人入座").disabled).toBe(false)
  await act(async()=>button(host,"本人入座").click())
  expect(api.join).toHaveBeenCalledWith({roomCode:"1234"})
  await act(async()=>root.unmount())
 })
 it.each(["raise","call"] as const)("%s 耗尽筹码也需确认，倒计时可被辅助技术读取", async (action) => {
  api.act.mockResolvedValue({ok:true})
  const {host,root}=await render({...table,...(action === "call" ? {toCall:100} : {pot:500})})
  expect(host.querySelector('[role="timer"]')?.textContent).toBe("0:20")
  if(action === "raise") { await act(async()=>button(host,"加注").click()); await act(async()=>button(host,"一池").click()) }
  await act(async()=>button(host,action === "raise" ? "确认加注 102" : "跟注 100").click())
  expect(api.act).not.toHaveBeenCalled()
  await act(async()=>button(host,"确认全下 100").click())
  expect(api.act.mock.calls[0][0].action).toBe(action)
  await act(async()=>root.unmount())
 })
 it("底池预设按跟注后的底池计算，短筹码时不超出服务端上限", () => {
  expect(betPresets(table).map(preset=>preset.to)).toEqual([10,18,30])
  expect(betPresets({...table,maxRaiseTo:12}).map(preset=>preset.to)).toEqual([10,12,12])
 })
 it("明确提示行动对象，预设下注遵守服务端范围，全下需二次确认", async () => {
  api.act.mockResolvedValue({ok:true})
  const {host,root}=await render()
  expect(host.querySelector('[role="status"]')?.textContent).toContain("轮到你")
  await act(async()=>button(host,"加注").click())
  await act(async()=>button(host,"半池").click())
  expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("18")
  await act(async()=>button(host,"全下").click())
  expect(api.act).not.toHaveBeenCalled()
  await act(async()=>button(host,"确认全下 100").click())
  expect(api.act.mock.calls[0][0]).toMatchObject({action:"allin",controlVersion:4})
  await act(async()=>root.render(<HumanControls table={{...table,actionOnSeat:1,seats:[...table.seats,{...table.seats[0],seatNo:1,isMe:false,displayName:"对手"}]}} perspective="owner" onRefresh={vi.fn()} />))
  expect(host.querySelector('[role="status"]')?.textContent).toContain("等待 对手 行动")
  await act(async()=>root.unmount())
 })
 it("按服务端金额边界提交，防重并在未知结果重试复用同一动作", async () => {
  api.act.mockRejectedValueOnce(new Error("响应丢失")).mockResolvedValueOnce({ ok: true }); const {host,root} = await render();
  await act(async () => button(host,"加注").click()); await act(async () => button(host,"确认加注 10").click()); const first = api.act.mock.calls[0][0]; expect(first).toMatchObject({ roomCode:"1234", action:"raise", to:10, handId:"hand", street:"flop", expectedActionSeq:3, controlVersion:4 }); expect(first.actionId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(button(host,"弃牌").disabled).toBe(true); await act(async () => button(host,"重试出牌").click()); expect(api.act.mock.calls[1][0]).toEqual(first); await act(async () => root.unmount());
 });
 it("未确认动作在离开再进入房间后仍使用原 actionId", async () => {
  api.act.mockRejectedValueOnce(new Error("响应丢失")).mockResolvedValueOnce({ok:true})
  const host=document.createElement("div"), first=createRoot(host)
  await act(async()=>first.render(<HumanControls identityKey="identity-retry" table={table} perspective="owner" onRefresh={vi.fn()} />))
  await act(async()=>button(host,"弃牌").click())
  const command=api.act.mock.calls[0][0]
  await act(async()=>first.unmount())
  const second=createRoot(host)
  await act(async()=>second.render(<HumanControls identityKey="identity-retry" table={table} perspective="owner" onRefresh={vi.fn()} />))
  await act(async()=>button(host,"重试出牌").click())
  expect(api.act.mock.calls[1][0]).toEqual(command)
  await act(async()=>second.unmount())
 })
 it("金额越界时不可下注，合法金额可通过原生输入调整", async () => {
  const {host,root}=await render()
  await act(async()=>button(host,"加注").click())
  const input=host.querySelector("input")!
  await act(async()=>{ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"103"); input.dispatchEvent(new Event("input",{bubbles:true})) })
  expect(button(host,"确认加注 103").disabled).toBe(true)
  await act(async()=>{ Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"20"); input.dispatchEvent(new Event("input",{bubbles:true})) })
  api.act.mockResolvedValue({ok:true})
  await act(async()=>button(host,"确认加注 20").click())
  expect(api.act.mock.calls[0][0].to).toBe(20)
  await act(async()=>root.unmount())
 })
 it("请求进行中连续点击只提交一次", async () => {
  let done!:(v:unknown)=>void
  api.act.mockImplementationOnce(()=>new Promise(resolve=>{done=resolve}))
  const {host,root}=await render()
  await act(async()=>{button(host,"弃牌").click();button(host,"弃牌").click()})
  expect(api.act).toHaveBeenCalledOnce()
  await act(async()=>done({ok:true}))
  await act(async()=>root.unmount())
 })
 it("无座位接入AI先授权再复制，等待时可取消", async () => {
  api.control.mockResolvedValue({controller:null,controlVersion:5,handoffPending:true})
  const copy=vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
  const {host,root}=await render({...table,mySeatNo:null,seats:[],controller:null})
  await act(async()=>button(host,"接入 AI").click())
  expect(api.control).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,action:"request_ai"})
  expect(copy).toHaveBeenCalledOnce()
  expect(copy.mock.calls[0][0]).toContain("seat.join 并携带该 controlVersion")
  expect(api.control.mock.invocationCallOrder[0]).toBeLessThan(copy.mock.invocationCallOrder[0])
  await act(async()=>root.render(<HumanControls table={{...table,mySeatNo:null,seats:[],controller:null,controlVersion:5,handoffPending:true}} perspective="public" onRefresh={vi.fn()} />))
  expect(host.textContent).toContain("等待 AI 入座")
  await act(async()=>button(host,"复制 AI 接入指令").click())
  expect(api.control).toHaveBeenCalledTimes(1)
  await act(async()=>button(host,"取消 AI 接入").click())
  expect(api.control).toHaveBeenLastCalledWith({roomCode:"1234",controlVersion:5,action:"cancel_ai"})
  await act(async()=>root.unmount())
 })
 it("本人入座与暂离离桌带控制版本", async () => {
  api.join.mockResolvedValue({seatNo:0});api.sit.mockResolvedValue({pending:true});api.leave.mockResolvedValue({})
  const {host,root}=await render({...table,mySeatNo:null,seats:[]})
  await act(async()=>button(host,"本人入座").click())
  expect(api.join).toHaveBeenCalledWith({roomCode:"1234"})
  await act(async()=>root.render(<HumanControls table={table} perspective="owner" onRefresh={vi.fn()} />))
  await openManagement(host)
  await act(async()=>button(host,"暂离").click())
  expect(api.sit).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,sittingOut:true,reason:"user"})
  await openManagement(host)
  await act(async()=>button(host,"离桌").click())
  expect(api.leave).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4})
  await act(async()=>root.unmount())
 })
 it("等待 AI 接入时本人仍可出牌并可取消交接", async () => { const {host,root} = await render({...table,handoffPending:true}); expect(button(host,"跟注 4").disabled).toBe(false); api.control.mockResolvedValue({}); await openManagement(host); await act(async()=>button(host,"取消 AI 接管").click()); expect(api.control).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,action:"cancel_ai"}); await act(async()=>root.unmount()) });
 it("AI 座位立即接管，旁观视角不显示出牌控件", async () => { api.control.mockResolvedValue({}); const {host,root} = await render({...table,controller:"ai"}); await openManagement(host); expect(button(host,"暂离").disabled).toBe(true); expect(button(host,"离桌").disabled).toBe(true); await act(async()=>button(host,"本人接管").click()); expect(api.control).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,action:"takeover"}); await act(async()=>root.render(<HumanControls table={table} perspective="public" onRefresh={vi.fn()} />)); expect(host.querySelector('input')).toBeNull(); expect(button(host,"弃牌")).toBeUndefined(); await act(async()=>root.unmount()) });
})
describe("完整画布与事件", () => {
 it.each([[1440,900],[1280,720],[960,640],[640,480]])("%sx%s 等比例完整呈现", (w,h)=>{ const fit=canvasFit(w,h); expect(fit.width).toBeLessThanOrEqual(w); expect(fit.height).toBeLessThanOrEqual(h); expect(fit.width/fit.height).toBeCloseTo(1440/900) });
 it("首批历史仅建立游标，同 handId/seq 不重复播放",()=>{ const e={kind:"action" as const,handId:"h",handNo:1,seq:1}; const first=mergeTableEvents([], [e,e], true); expect(first.events).toHaveLength(1); expect(first.animate).toHaveLength(0); const second=mergeTableEvents(first.events,[e,{...e,seq:2}],false); expect(second.events).toHaveLength(2); expect(second.animate).toHaveLength(1) });
})
