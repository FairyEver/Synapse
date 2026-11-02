/** @vitest-environment jsdom */
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { HumanControls } from "../components/HumanControls"
import { canvasFit, mergeTableEvents } from "../lib/table-layout"
import { projectTable } from "../lib/view"
import { rollIntentStore } from "../lib/roll-intent-store"
import { betPresets } from "../lib/action-view"
const api = vi.hoisted(() => ({ act: vi.fn(), control: vi.fn(), join: vi.fn(), sit: vi.fn(), leave: vi.fn(), state: vi.fn(), rollStart: vi.fn(), rollChoose: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { roll: {start:api.rollStart,choose:api.rollChoose}, table: { state: api.state }, action: { act: api.act }, control: { set: api.control }, seat: { join: api.join, sit: api.sit, leave: api.leave } } }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({state:{status:"authenticated",connectivity:"online",profile:{user:{id:"human-controls-user"}}}}) }))
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const table: PokerTableView = { roomCode: "1234", name: null, status: "running", buyIn: 1000, maxSeats: 2, handId: "hand", handNo: 1, street: "flop", board: [], pot: 20, dealerSeat: 0, actionOnSeat: 0, deadlineMs: 20000, cursor: "1:3", mySeatNo: 0, seats: [{ seatNo: 0, displayName: "本人", isMe: true, stack: 100, status: "active", streetBet: 2, aiState: "online", controller: "human" }], recentActions: [], deckRemaining: 40, actionSeq: 3, controlVersion: 4, controller: "human", legalActions: ["fold", "call", "raise", "allin"], toCall: 4, minRaiseTo: 10, maxRaiseTo: 102 }
afterEach(() => { vi.resetAllMocks(); sessionStorage.clear(); document.body.replaceChildren() })
async function render(value = table, identityKey?: string) { const host = document.createElement("div"), root = createRoot(host); document.body.append(host); await act(async () => root.render(<HumanControls identityKey={identityKey} table={value} perspective="owner" onRefresh={vi.fn()} />)); return { host, root } }
function button(host: HTMLElement, label: string) { return [...host.querySelectorAll("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label || b.getAttribute("aria-label")?.startsWith(label + " "))! }
async function openManagement(host: HTMLElement) { await act(async () => button(host, "更多牌桌操作").click()) }
describe("真人牌桌操作", () => {
 it("关闭Roll的房间在会话存储不可读时仍可正常弃牌",async()=>{
  api.act.mockResolvedValue({ok:true})
  const failure=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("denied")})
  const {host,root}=await render({...table,roll:{enabled:false}},"no-roll-storage-denied")
  expect(button(host,"弃牌").disabled).toBe(false)
  await act(async()=>button(host,"弃牌").click())
  expect(api.act).toHaveBeenCalledOnce();expect(api.rollStart).not.toHaveBeenCalled()
  failure.mockRestore();await act(async()=>root.unmount())
 })
 it("新Roll保存失败未付费，关闭提示后仍可正常弃牌",async()=>{
  api.act.mockResolvedValue({ok:true})
  const value={...table,hole:["As","Kd"],roll:{enabled:true,count:0,normal:{fee:3,available:true},super:{fee:8,available:true},pending:null}}
  const {host,root}=await render(value,"failed-save-roll-user")
  await act(async()=>button(host,"Roll 换牌").click())
  await act(async()=>document.querySelector<HTMLInputElement>('input[type="radio"][value="0"]')!.click())
  const failure=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("denied")})
  await act(async()=>button(document.body,"支付 3 点数换牌").click())
  expect(api.rollStart).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("恢复记录")
  await act(async()=>button(document.body,"取消").click())
  expect(button(host,"弃牌").disabled).toBe(false)
  await act(async()=>button(host,"弃牌").click())
  expect(api.act).toHaveBeenCalledOnce()
  failure.mockRestore();await act(async()=>root.unmount())
 })

 it("Roll面板选择档位和原手牌后明确确认才支付，行动点变化清理未提交选择",async()=>{
  api.rollStart.mockResolvedValue({ok:true})
  const value={...table,hole:["As","Kd"],roll:{enabled:true,count:0,normal:{fee:3,available:true},super:{fee:8,available:true},pending:null}}
  const {host,root}=await render(value,"human-controls-test")
  await act(async()=>button(host,"Roll 换牌").click())
  const dialog=document.body.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain("选择换掉的牌")
  expect(dialog.querySelector('[aria-label="保留第 1 张，A♠"]')).not.toBeNull()
  expect(dialog.querySelector('[aria-label="保留第 2 张，K♦"]')).not.toBeNull()
  expect(api.rollStart).not.toHaveBeenCalled();expect(button(document.body,"支付 3 点数换牌").disabled).toBe(true)
  await act(async()=>document.querySelector<HTMLInputElement>('input[type="radio"][value="super"]')!.click())
  await act(async()=>document.querySelector<HTMLInputElement>('input[type="radio"][value="1"]')!.click())
  expect(dialog.querySelector('[aria-label="换掉第 2 张，K♦"]')).not.toBeNull()
  await act(async()=>button(document.body,"支付 8 点数换牌").click())
  expect(api.rollStart).toHaveBeenCalledWith(expect.objectContaining({kind:"super",cardIndex:1,expectedFee:8,expectedActionSeq:3,controlVersion:4}))
  await act(async()=>root.render(<HumanControls identityKey="human-controls-test" table={{...value,actionSeq:4}} perspective="owner" onRefresh={vi.fn()}/>))
  await act(async()=>button(host,"Roll 换牌").click())
  expect(button(document.body,"支付 3 点数换牌").disabled).toBe(true)
  await act(async()=>root.unmount())
 })
 it("AI待选可在面板接管，原候选保留后本人明确选择，不再收款",async()=>{
  api.control.mockResolvedValue({});api.rollChoose.mockResolvedValue({ok:true})
  const pending={rollId:"ai-pending",cardIndex:0,candidates:["2c","3c","4c"]}
  const value={...table,controller:"ai" as const,roll:{enabled:true,count:1,pending,pendingSeatNo:0}}
  const {host,root}=await render(value,"human-controls-test")
  await act(async()=>button(document.querySelector('[role="dialog"]') as HTMLElement,"本人接管").click())
  expect(api.control).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,action:"takeover"})
  expect(api.rollChoose).not.toHaveBeenCalled()
  await act(async()=>root.render(<HumanControls identityKey="human-controls-test" table={{...value,controller:"human",controlVersion:5}} perspective="owner" onRefresh={vi.fn()}/>))
  await act(async()=>document.querySelector<HTMLInputElement>('input[type="radio"][value="2"]')!.click())
  await act(async()=>button(document.body,"选择这张牌").click())
  expect(api.rollChoose).toHaveBeenCalledWith(expect.objectContaining({rollId:"ai-pending",candidateIndex:2,controlVersion:5}))
  expect(api.rollStart).not.toHaveBeenCalled()
  await act(async()=>root.unmount())
 })

 it("超级待选即使旧响应仍列合法下注也禁用，候选可关闭重开并保留原牌", async()=>{
  const pending={rollId:"super-old",cardIndex:1,candidates:["2c","3c","4c"]}
  const {host,root}=await render({...table,hole:["As","Kd"],roll:{enabled:true,count:1,pending,pendingSeatNo:0}},"pending-reopen-user")
  expect(button(host,"弃牌").disabled).toBe(true)
  const dialog=document.body.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain("选择新牌")
  expect(dialog.textContent).toContain("当前手牌")
  expect(dialog.querySelector('[aria-label="当前手牌"]')?.textContent).toContain("换掉")
  expect(dialog.querySelector('[aria-label="选择候选 1，2♣"]')).not.toBeNull()
  expect(dialog.querySelector('[aria-label="选择候选 3，4♣"]')).not.toBeNull()
  await act(async()=>button(document.body,"稍后选择").click())
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  await act(async()=>button(host,"完成换牌").click())
  expect(document.body.querySelectorAll('input[type="radio"]')).toHaveLength(3)
  expect(button(document.body,"选择这张牌").disabled).toBe(true)
  await act(async()=>root.unmount())
 })

 it("超级待选时旁观快捷入口可切回本人，恢复原候选且不新抽", async () => {
  api.rollChoose.mockResolvedValue({ok:true})
  const pending={rollId:"super-public-original",cardIndex:1,candidates:["2c","3c","4c"]}
  const value={...table,hole:["As","Kd"],roll:{enabled:true,count:1,pending,pendingSeatNo:0}}
  function Perspective() {
    const [perspective,setPerspective]=useState<"owner"|"public">("public")
    return <HumanControls identityKey="pending-public-switch" table={projectTable(value,perspective)} perspective={perspective} onPerspective={setPerspective} onRefresh={vi.fn()}/>
  }
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  await act(async()=>root.render(<Perspective/>))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(button(host,"切回玩家视角").disabled).toBe(false)
  await act(async()=>button(host,"切回玩家视角").click())
  expect([...document.querySelectorAll('[role="dialog"] [aria-label]')].map(el=>el.getAttribute("aria-label"))).toEqual(expect.arrayContaining(["选择候选 1，2♣","选择候选 2，3♣","选择候选 3，4♣"]))
  expect(button(host,"弃牌").disabled).toBe(true)
  await act(async()=>document.querySelector<HTMLInputElement>('input[type="radio"][value="2"]')!.click())
  await act(async()=>button(document.body,"选择这张牌").click())
  expect(api.rollChoose).toHaveBeenCalledWith(expect.objectContaining({rollId:pending.rollId,candidateIndex:2}))
  expect(api.rollStart).not.toHaveBeenCalled()
  await act(async()=>root.unmount())
 })
 it("未知Roll请求不阻挡纯视角切换，也不因此重新提交", async () => {
  const scope={identityKey:"unknown-public-switch",roomCode:table.roomCode}
  const intent={operation:"start" as const,input:{roomCode:table.roomCode,handId:table.handId!,street:"flop" as const,expectedActionSeq:3,controlVersion:4,actionId:"12345678-1234-4234-a234-123456789012",kind:"super" as const,cardIndex:1,expectedFee:8}}
  rollIntentStore.save(scope,intent)
  const value={...table,roll:{enabled:true,count:0,normal:{fee:3,available:true},super:{fee:8,available:true}}}
  function Perspective() {
    const [perspective,setPerspective]=useState<"owner"|"public">("public")
    return <HumanControls identityKey={scope.identityKey} table={projectTable(value,perspective)} perspective={perspective} onPerspective={setPerspective} onRefresh={vi.fn()}/>
  }
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  await act(async()=>root.render(<Perspective/>))
  expect(button(host,"切回玩家视角").disabled).toBe(false)
  await act(async()=>button(host,"切回玩家视角").click())
  expect(button(host,"弃牌").disabled).toBe(true)
  expect(rollIntentStore.getSnapshot(scope).intent).toEqual(intent)
  expect(api.rollStart).not.toHaveBeenCalled();expect(api.rollChoose).not.toHaveBeenCalled()
  await act(async()=>root.unmount())
 })

 it("已暂离可以直接回座，旁观时直接切回玩家，AI 控制时直接接管", async () => {
  api.sit.mockResolvedValue({}); api.control.mockResolvedValue({})
  const {host,root}=await render({...table,status:"paused",actionOnSeat:null,seats:[{...table.seats[0],status:"sitting_out"}]})
  await act(async()=>button(host,"回到牌桌").click())
  expect(api.sit).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,sittingOut:false,reason:"user"})
  const perspective=vi.fn()
  await act(async()=>root.render(<HumanControls table={table} perspective="public" onPerspective={perspective} onRefresh={vi.fn()} />))
  await act(async()=>button(host,"切回玩家视角").click())
  expect(perspective).toHaveBeenCalledWith("owner")
  await act(async()=>root.render(<HumanControls table={{...table,controller:"ai"}} perspective="owner" onRefresh={vi.fn()} />))
  await act(async()=>button(host,"本人接管").click())
  expect(api.control).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,action:"takeover"})
  await act(async()=>root.unmount())
 })
 it.each(["sit","leave"])("%s 延后生效在行动状态旁持续显示", async kind => {
  const value={...table,...(kind==="sit"?{pauseReason:"user" as const}:{seats:[{...table.seats[0],leavePending:true}]})}
  const {host,root}=await render(value)
  expect(host.querySelector('[role="status"]')?.textContent).toContain(kind==="sit"?"本手后暂离":"本手后离桌")
  expect(host.querySelector('[role="status"]')?.textContent).toContain("轮到你")
  await act(async()=>root.unmount())
 })
 it("自定义只显示金额设置，关闭不丢选择，旁观不保留旧表单", async () => {
  const {host,root}=await render()
  await act(async()=>button(host,"自定义").click())
  expect(host.querySelector('[aria-label="下注决策信息"]')).toBeNull()
  expect(host.querySelector('input[type="number"]')).not.toBeNull()
  expect(button(host,"确认加注 10").closest('[role="dialog"]')).toBeNull()
  await act(async()=>root.render(<HumanControls table={table} perspective="public" onRefresh={vi.fn()} />))
  expect(host.querySelector('input[type="number"]')).toBeNull()
  expect(button(host,"半池")).toBeUndefined()
  await act(async()=>root.unmount())
 })
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
  if(action === "raise") { await act(async()=>button(host,"自定义").click()); await act(async()=>button(host,"一池").click()) }
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
  await act(async()=>button(host,"自定义").click())
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
  await act(async () => button(host,"自定义").click()); await act(async () => button(host,"确认加注 10").click()); const first = api.act.mock.calls[0][0]; expect(first).toMatchObject({ roomCode:"1234", action:"raise", to:10, handId:"hand", street:"flop", expectedActionSeq:3, controlVersion:4 }); expect(first.actionId).toMatch(/^[0-9a-f-]{36}$/i);
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
  await act(async()=>button(host,"自定义").click())
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
 it("无座位接入AI先打开统一面板，明确授权后才复制，等待时可取消", async () => {
  api.control.mockResolvedValue({controller:null,controlVersion:5,handoffPending:true})
  const copy=vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
  const {host,root}=await render({...table,mySeatNo:null,seats:[],controller:null})
  api.state.mockResolvedValue({...table,mySeatNo:null,seats:[],controller:null})
  await act(async()=>button(host,"接入 AI").click())
  expect(api.control).not.toHaveBeenCalled()
  await act(async()=>button(document.body,"允许 AI 接入并复制指令").click())
  expect(api.control).toHaveBeenCalledWith({roomCode:"1234",controlVersion:4,action:"request_ai"})
  expect(copy).toHaveBeenCalledOnce()
  expect(copy.mock.calls[0][0]).toContain("seat.join 并携带该 controlVersion")
  expect(api.control.mock.invocationCallOrder[0]).toBeLessThan(copy.mock.invocationCallOrder[0])
  await act(async()=>root.render(<HumanControls table={{...table,mySeatNo:null,seats:[],controller:null,controlVersion:5,handoffPending:true}} perspective="public" onRefresh={vi.fn()} />))
  expect(host.textContent).toContain("等待 AI 入座")
  await act(async()=>button(document.body,"复制接入指令").click())
  expect(api.control).toHaveBeenCalledTimes(1)
  api.state.mockResolvedValue({...table,mySeatNo:null,seats:[],controller:null,controlVersion:5,handoffPending:true})
  await act(async()=>button(document.body,"取消 AI 接入").click())
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
