/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Table } from "../components/Table"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = []
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
vi.stubGlobal("ResizeObserver", class {
  disconnect = vi.fn()
  constructor(callback: ResizeObserverCallback) { observers.push({callback,disconnect:this.disconnect}) }
  observe() {}
})
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id=++nextFrame; frames.set(id,callback); return id })
vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
const table: PokerTableView = { roomCode:"1234",name:null,status:"waiting",buyIn:1000,maxSeats:10,handId:null,handNo:0,street:null,board:[],pot:0,dealerSeat:0,actionOnSeat:null,deadlineMs:null,cursor:"0:0",mySeatNo:3,seats:[{seatNo:3,displayName:"本人",isMe:true,stack:1000,status:"active",streetBet:0,aiState:"online",controller:"human"}],recentActions:[],deckRemaining:32 }
afterEach(() => { document.body.replaceChildren(); observers.length=0; frames.clear() })

describe("三种牌桌场景接入", () => {
  it("相同缩放值切换场景仍更新坐标，日志开合不改变场景，本人保持下方", async () => {
    const host=document.createElement("div"),root=createRoot(host)
    document.body.append(host)
    await act(async()=>root.render(<Table table={table} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} />))
    const canvas=host.querySelector<HTMLElement>(".poker-canvas")!,viewport=host.querySelector(".poker-canvas-viewport")!
    const resize=async(width:number,height:number)=>act(async()=>{
      observers[0].callback([{target:viewport,contentRect:{width,height}}] as ResizeObserverEntry[],{} as ResizeObserver)
      for (const [id,callback] of frames) { frames.delete(id); callback(0) }
    })
    for(const [width,height,mode] of [[1440,900,"landscape"],[1080,1080,"square"],[840,1320,"portrait"]] as const){
      await resize(width,height)
      expect(canvas.dataset.tableShape).toBe(mode)
      expect(canvas.style.width).toBe(`${width}px`)
      expect(canvas.style.height).toBe(`${height}px`)
      expect(canvas.style.transform).toContain("scale(1)")
      expect(host.querySelector('[data-mine="true"]')?.getAttribute("data-position")).toBe("0")
    }
    const style=canvas.getAttribute("style")
    await act(async()=>{ [...host.querySelectorAll("button")].find(button=>button.textContent==="日志")!.click() })
    expect(canvas.getAttribute("style")).toBe(style)
    await act(async()=>root.unmount())
    expect(observers[0].disconnect).toHaveBeenCalledOnce()
  })

  it("同帧多次尺寸变化只使用最新测量，卸载取消待执行布局", async () => {
    const host=document.createElement("div"),root=createRoot(host)
    await act(async()=>root.render(<Table table={table} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} />))
    const viewport=host.querySelector(".poker-canvas-viewport")!
    // Ignore initial focus frames scheduled by the independent control panel.
    frames.clear()
    const resize=(width:number,height:number)=>observers[0].callback([{target:viewport,contentRect:{width,height}}] as ResizeObserverEntry[],{} as ResizeObserver)
    await act(async()=>{
      resize(1440,900);resize(420,660)
      expect(frames.size).toBe(1)
      for(const [id,callback] of frames){frames.delete(id);callback(0)}
    })
    expect(host.querySelector<HTMLElement>(".poker-canvas")!.dataset.tableShape).toBe("portrait")
    expect(host.querySelector<HTMLElement>(".poker-canvas")!.style.transform).toContain("scale(0.5)")
    resize(900,900)
    expect(frames.size).toBe(1)
    await act(async()=>root.unmount())
    expect(frames.size).toBe(0)
  })
})
