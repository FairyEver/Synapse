/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import * as chips from "@synapse/shared/game-contracts"
import { PokerChipPile } from "../components/PokerChipPile"
import { ChipMotion } from "../components/ChipMotion"
import { RollingAmount } from "../components/RollingAmount"
import type { PresentedTransfer } from "../lib/chip-presentation"

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root: Root | undefined
const originalAnimate=Element.prototype.animate
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;vi.restoreAllMocks();vi.unstubAllGlobals();Element.prototype.animate=originalAnimate;document.body.replaceChildren()})
function mount() {const host=document.createElement("div");document.body.append(host);root=createRoot(host);return host}
it("等值轮询不重算未变化的筹码堆，数量变化仍更新",async()=>{
  const layout=vi.spyOn(chips,"layoutChipPile"),host=mount()
  const render=(count:number)=>act(async()=>root!.render(<PokerChipPile chips={[{value:1,count}]} label="底池" />))
  await render(120)
  expect(layout).toHaveBeenCalledTimes(1)
  for(let i=0;i<10;i++)await render(120)
  expect(layout).toHaveBeenCalledTimes(1)
  await render(121)
  expect(layout).toHaveBeenCalledTimes(2)
  expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("底池 121")
})
it("大量筹码保留实体层次，单枚DOM开销保持在10个节点内",async()=>{
  const host=mount()
  await act(async()=>root!.render(<PokerChipPile chips={[{value:1,count:120}]} label="底池" />))
  expect(host.querySelectorAll('.poker-chip')).toHaveLength(120)
  expect(host.querySelectorAll('*').length).toBeLessThanOrEqual(120*10+2)
})
it("同批飞行先集中测量共享锚点，再开始动画；已有批次不重复测量",async()=>{
  const host=mount(),operations:string[]=[]
  vi.spyOn(Element.prototype,"getBoundingClientRect").mockImplementation(()=>{operations.push("read");return new DOMRect(0,0,100,100)})
  Element.prototype.animate=()=>{operations.push("write");return {finished:new Promise(()=>{}),cancel:()=>{}} as unknown as Animation}
  const transfers:PresentedTransfer[]=[0,1].map(seatNo=>({id:`pay:${seatNo}`,seatNo,fund:"pot",direction:"in",amount:1,chips:[{value:1,count:1}],kind:"bet",started:false}))
  const render=()=>act(async()=>root!.render(<div><span data-chip-anchor="pot" />{[0,1].map(seatNo=><div key={seatNo} data-seat={seatNo}><div className="poker-seat-bank" /></div>)}<ChipMotion transfers={[...transfers]} layout="landscape" scope="h" onStart={()=>{}} onComplete={()=>{}} /></div>))
  await render()
  expect(operations.filter(v=>v==="read")).toHaveLength(4)
  expect(operations.findLastIndex(v=>v==="read")).toBeLessThan(operations.indexOf("write"))
  operations.length=0
  await render()
  expect(operations).toEqual([])
  expect(host.querySelectorAll('.poker-flying-chip')).toHaveLength(2)
})
it("静止数字开始滚动无需同步读取布局",async()=>{
  mount()
  const render=(value:number)=>act(async()=>root!.render(<RollingAmount value={value} scope="h" />))
  await render(998)
  const rect=vi.spyOn(Element.prototype,"getBoundingClientRect")
  Element.prototype.animate=()=>({cancel:()=>{}} as unknown as Animation)
  await render(123)
  expect(rect).not.toHaveBeenCalled()
})
it("缩放牌桌快速更新金额时，按数字自身高度衔接当前滚动位置",async()=>{
  const host=mount(),starts:string[]=[]
  vi.stubGlobal("DOMMatrixReadOnly",class {m42=-800})
  vi.stubGlobal("getComputedStyle",()=>({transform:"matrix(1,0,0,1,0,-800)"}))
  const render=(value:number)=>act(async()=>root!.render(<RollingAmount value={value} scope="h" />))
  await render(30)
  for(const node of host.querySelectorAll('.poker-number-digit')){
    Object.defineProperty(node,"offsetHeight",{value:64})
    vi.spyOn(node,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,20,32))
  }
  Element.prototype.animate=frames=>{starts.push((frames as Keyframe[])[0].transform as string);return {cancel:()=>{}} as unknown as Animation}
  await render(45)
  starts.length=0
  await render(67)
  expect(starts).toEqual(["translateY(calc(-12.5 * 1.15em))","translateY(calc(-12.5 * 1.15em))"])
})

it("大额筹码全部用实体表达，1k标签正确且不生成覆盖文字",async()=>{
  const host=mount()
  await act(async()=>root!.render(<PokerChipPile chips={[{value:500,count:201}]} label="底池" />))
  const values=[...host.querySelectorAll<HTMLElement>('.poker-chip')].map(node=>Number(node.dataset.chipValue))
  expect(values).toHaveLength(200)
  expect(values.reduce((sum,value)=>sum+value,0)).toBe(100500)
  expect(host.querySelector('[data-chip-value="1000"] text')?.textContent).toBe("1k")
  expect(host.textContent).not.toContain("×")
  expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("底池 100,500")
})
it("大笔飞行不截取前24枚，合并后完整表达金额",async()=>{
  const host=mount(),transfer:PresentedTransfer={id:"large",seatNo:0,fund:"pot",direction:"in",amount:100500,chips:[{value:500,count:201}],kind:"bet",started:false}
  await act(async()=>root!.render(<ChipMotion transfers={[transfer]} layout="landscape" scope="h" onStart={()=>{}} onComplete={()=>{}} />))
  const values=[...host.querySelectorAll<HTMLElement>('.poker-flying-chip .poker-chip')].map(node=>Number(node.dataset.chipValue))
  expect(values).toHaveLength(200)
  expect(values.reduce((sum,value)=>sum+value,0)).toBe(100500)
})
