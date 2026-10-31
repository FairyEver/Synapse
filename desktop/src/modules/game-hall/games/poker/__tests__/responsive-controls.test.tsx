/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { HumanControls } from "../components/HumanControls"
import { Table } from "../components/Table"

const api = vi.hoisted(() => ({ act: vi.fn(), control: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { action: { act: api.act }, control: { set: api.control } } }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const observers = new Set<{ callback: ResizeObserverCallback; elements: Set<Element> }>()
vi.stubGlobal("ResizeObserver", class {
  elements = new Set<Element>()
  constructor(public callback: ResizeObserverCallback) { observers.add(this) }
  observe(element: Element) { this.elements.add(element) }
  unobserve(element: Element) { this.elements.delete(element) }
  disconnect() { observers.delete(this) }
})
const table: PokerTableView = { roomCode:"1234", name:null, status:"running", buyIn:1000, maxSeats:2, handId:"hand", handNo:1, street:"flop", board:[], pot:20, dealerSeat:0, actionOnSeat:0, deadlineMs:20000, cursor:"1:3", mySeatNo:0, seats:[{ seatNo:0, displayName:"本人", isMe:true, stack:100, status:"active", streetBet:2, aiState:"online", controller:"human" }], recentActions:[], deckRemaining:40, actionSeq:3, controlVersion:4, controller:"human", legalActions:["fold","call","raise","allin"], toCall:4, minRaiseTo:10, maxRaiseTo:102 }
const button = (host: ParentNode, label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label)!
const click = async (host: ParentNode, label: string) => act(async () => { const target=button(host,label); if(target.getAttribute("role")==="tab") target.dispatchEvent(new MouseEvent("mousedown",{button:0,bubbles:true})); target.click() })
afterEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); observers.clear() })
async function controls(value = table) {
  const host=document.createElement("div"),root=createRoot(host)
  document.body.append(host)
  const render=async(next: PokerTableView)=>act(async()=>root.render(<HumanControls table={next} compact perspective="owner" onRefresh={vi.fn()} />))
  await render(value)
  return {host,root,render}
}

describe("窄屏精简出牌", () => {
  it("常驻三个合法操作，展开加注不提交，金额显式确认才出牌", async () => {
    api.act.mockResolvedValue({ok:true})
    const {host,root}=await controls()
    expect([...host.querySelectorAll(".poker-action-buttons button")].map(b=>b.textContent)).toEqual(["弃牌","跟注 4","加注"])
    expect(host.querySelector("input")).toBeNull()
    expect(button(host,"交给 AI")).toBeUndefined()
    await click(host,"加注")
    expect(api.act).not.toHaveBeenCalled()
    expect(host.querySelector('input[type="number"]')).not.toBeNull()
    await click(host,"半池")
    await click(host,"确认加注 18")
    expect(api.act).toHaveBeenCalledWith(expect.objectContaining({action:"raise",to:18,controlVersion:4}))
    await act(async()=>root.unmount())
  })
  it("全下取消回到金额设置，确认前不提交且保留焦点", async () => {
    api.act.mockResolvedValue({ok:true})
    const {host,root}=await controls()
    await click(host,"加注")
    button(host,"全下").focus()
    await click(host,"全下")
    expect(api.act).not.toHaveBeenCalled()
    await click(host,"取消")
    expect(host.querySelector('input[type="number"]')).not.toBeNull()
    expect(document.activeElement).toBe(button(host,"全下"))
    await click(host,"全下")
    await click(host,"确认全下 100")
    expect(api.act).toHaveBeenCalledWith(expect.objectContaining({action:"allin"}))
    await act(async()=>root.unmount())
  })
  it("没有加注资格但允许全下时保留入口，跟注耗尽筹码也需确认", async () => {
    const {host,root,render}=await controls({...table,legalActions:["fold","call","allin"]})
    await click(host,"全下")
    expect(api.act).not.toHaveBeenCalled()
    expect(button(host,"确认全下 100")).toBeDefined()
    await click(host,"取消")
    expect(host.querySelector('input[type="number"]')).toBeNull()
    await render({...table,toCall:100,actionSeq:4,legalActions:["fold","call"]})
    await click(host,"跟注 100")
    expect(api.act).not.toHaveBeenCalled()
    expect(button(host,"确认全下 100")).toBeDefined()
    await act(async()=>root.unmount())
  })
  it.each(["hand","sequence","control","perspective"])("%s 变化关闭旧金额弹层", async kind => {
    const {host,root,render}=await controls()
    await click(host,"加注")
    if(kind==="perspective") await act(async()=>root.render(<HumanControls table={table} compact perspective="public" onRefresh={vi.fn()} />))
    else await render({...table,...(kind==="hand"?{handId:"next"}:kind==="sequence"?{actionSeq:4}:{controlVersion:5,controller:"ai" as const})})
    expect(host.querySelector('input[type="number"]')).toBeNull()
    expect(api.act).not.toHaveBeenCalled()
    await act(async()=>root.unmount())
  })
  it("响应未知后关闭金额弹层仍能用原动作重试", async () => {
    api.act.mockRejectedValueOnce(new Error("响应丢失")).mockResolvedValueOnce({ok:true})
    const {host,root}=await controls()
    await click(host,"加注")
    await click(host,"确认加注 10")
    const intent=api.act.mock.calls[0][0]
    expect(button(host,"弃牌").disabled).toBe(true)
    if(button(host,"收起加注设置")) await click(host,"收起加注设置")
    await click(host,"重试出牌")
    expect(api.act.mock.calls[1][0]).toEqual(intent)
    await act(async()=>root.unmount())
  })
})

describe("牌桌共用侧栏", () => {
  it("按内容宽度切换，日志、金额和更多互斥且不改变画布尺寸", async () => {
    const host=document.createElement("div"),root=createRoot(host)
    document.body.append(host)
    await act(async()=>root.render(<Table table={table} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} extras={<span>陪练设置</span>} />))
    const surface=host.querySelector(".poker-table")!,viewport=host.querySelector(".poker-canvas-viewport")!
    const resize=async(width:number)=>act(async()=>{
      for(const observer of [...observers]) if(observer.elements.has(surface)) observer.callback([
        {target:surface,contentRect:{width,height:700}},
        {target:viewport,contentRect:{width:700,height:560}},
      ] as ResizeObserverEntry[],{} as ResizeObserver)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    await resize(720)
    expect(host.querySelector("input")).toBeNull()
    await click(host,"日志")
    expect(button(host,"收起日志").getAttribute("aria-expanded")).toBe("true")
    const transform=(host.querySelector(".poker-canvas") as HTMLElement).style.transform
    await click(host,"更多牌桌操作")
    expect(button(host,"日志").getAttribute("aria-expanded")).toBe("false")
    expect(button(host,"交给 AI")).toBeDefined()
    await act(async()=>root.render(<Table table={{...table,actionSeq:4}} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} extras={<span>陪练设置</span>} />))
    expect(button(host,"交给 AI")).toBeDefined()
    await act(async()=>{ const target=button(host,"加注"); target.dispatchEvent(new MouseEvent("pointerdown",{button:0,bubbles:true})); target.focus(); target.click() })
    await act(async()=>new Promise(resolve=>setTimeout(resolve,10)))
    expect(host.querySelector('input[type="number"]')).not.toBeNull()
    expect(button(host,"更多牌桌操作").getAttribute("aria-expanded")).toBe("false")
    expect(button(host,"交给 AI")).toBeUndefined()
    expect((host.querySelector(".poker-canvas") as HTMLElement).style.transform).toBe(transform)
    await resize(1024)
    expect(button(host,"更多牌桌操作")).toBeUndefined()
    expect(host.querySelector('input[type="number"]')).not.toBeNull()
    await click(host,"日志")
    await click(host,"陪练")
    expect(host.textContent).toContain("陪练设置")
    await act(async()=>root.unmount())
  })
})
