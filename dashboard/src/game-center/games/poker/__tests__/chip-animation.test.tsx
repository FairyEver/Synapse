/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ChipMotion } from "../components/ChipMotion"
import { RollingAmount } from "../components/RollingAmount"
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const pending: {resolve:()=>void;animation:Animation}[]=[]
const original=Element.prototype.animate
afterEach(()=>{Element.prototype.animate=original;pending.length=0;document.body.replaceChildren()})
function animationClock(){
  Element.prototype.animate=function(){
    let resolve!:()=>void,reject!:(error:Error)=>void
    const finished=new Promise<void>((yes,no)=>{resolve=yes;reject=no})
    let observed=false
    const animation={get finished(){observed=true;return finished},cancel:()=>{if(observed)reject(new DOMException("Cancelled","AbortError"))},onfinish:null} as unknown as Animation
    pending.push({resolve:()=>{resolve();animation.onfinish?.call(animation,{} as AnimationPlaybackEvent)},animation})
    return animation
  }
}
it("逐枚飞行全部完成后才通知，不用固定时间提前放行",async()=>{
  animationClock()
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  const complete=vi.fn(),start=vi.fn(),land=vi.fn(),transfer={id:"a",seatNo:0,fund:"pot" as const,direction:"in" as const,amount:501,chips:[{value:500 as const,count:1},{value:1 as const,count:1}],kind:"bet" as const,started:false}
  const render=()=>act(async()=>root.render(<div><div data-seat="0"><div className="poker-seat-bank" /></div><span data-chip-anchor="pot" /><ChipMotion transfers={[transfer]} layout="landscape:1" scope="hand" onStart={start} onComplete={complete} onLand={land} /></div>))
  await render()
  expect(host.querySelectorAll('.poker-chip-transfer [data-chip-value]')).toHaveLength(2)
  expect(start).toHaveBeenCalledExactlyOnceWith("a")
  expect(land).not.toHaveBeenCalled()
  await act(async()=>pending[0].resolve())
  expect(land).toHaveBeenCalledExactlyOnceWith(transfer,0)
  expect(complete).not.toHaveBeenCalled()
  await render()
  expect(pending).toHaveLength(2)
  await act(async()=>pending[1].resolve())
  expect(complete).toHaveBeenCalledExactlyOnceWith("a")
  expect(land).toHaveBeenCalledTimes(2)
  expect(land).toHaveBeenLastCalledWith(transfer,1)
  await act(async()=>root.unmount())
})
it("滚动金额保留进位、千位分隔和动态效果完成通知，换手取消旧动画",async()=>{
  animationClock()
  const host=document.createElement("div"),root=createRoot(host),notify=vi.fn();document.body.append(host)
  const render=(value:number,scope="h")=>act(async()=>root.render(<RollingAmount value={value} scope={scope} onAnimating={notify} />))
  await render(999)
  expect(pending).toHaveLength(0)
  await render(1000)
  expect([...host.querySelectorAll('[data-digit]')].map(n=>n.getAttribute('data-digit')).join('')).toBe("1000")
  expect(host.querySelectorAll('.poker-number-comma')).toHaveLength(1)
  expect(notify).toHaveBeenLastCalledWith(true)
  await render(30,"new")
  expect(notify).toHaveBeenLastCalledWith(false)
  expect(host.querySelector('.sr-only')?.textContent).toBe("30")
  await render(31,"new")
  expect(notify).toHaveBeenLastCalledWith(true)
  await act(async()=>root.unmount())
  expect(notify).toHaveBeenLastCalledWith(false)
})

it.each([
  ["pot", "in", "bet"], ["roll", "in", "roll"],
  ["pot", "out", "payout"], ["pot", "out", "refund"], ["roll", "out", "compensation"],
] as const)("%s/%s/%s 每枚真实落地一次，取消及迟到完成均不补响",async(fund,direction,kind)=>{
  animationClock()
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  const land=vi.fn(),complete=vi.fn(),transfer={id:"flow",seatNo:0,fund,direction,kind,amount:501,chips:[{value:500 as const,count:1},{value:1 as const,count:1}],started:false}
  const render=(active:boolean)=>act(async()=>root.render(<div><div data-seat="0"><div className="poker-seat-bank" /></div><span data-chip-anchor={fund} /><ChipMotion transfers={active?[transfer]:[]} layout="landscape:1" scope="hand" onStart={()=>{}} onComplete={complete} onLand={land} /></div>))
  try{
    await render(true)
    await act(async()=>pending[0].resolve())
    expect(land).toHaveBeenCalledTimes(1)
    await render(false)
    await act(async()=>pending[1].resolve())
    expect(land).toHaveBeenCalledTimes(1)
    expect(complete).not.toHaveBeenCalled()
  }finally{await act(async()=>root.unmount())}
})
it("CSS降级逐枚结束才落地，重复事件和兜底计时不额外碰撞",async()=>{
  vi.useFakeTimers()
  Element.prototype.animate=undefined as unknown as typeof Element.prototype.animate
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  const land=vi.fn(),complete=vi.fn(),transfer={id:"css",seatNo:0,fund:"pot" as const,direction:"in" as const,kind:"bet" as const,amount:501,chips:[{value:500 as const,count:1},{value:1 as const,count:1}],started:false}
  try{
    await act(async()=>root.render(<div><div data-seat="0"><div className="poker-seat-bank" /></div><span data-chip-anchor="pot" /><ChipMotion transfers={[transfer]} layout="l" scope="h" onStart={()=>{}} onComplete={complete} onLand={land} /></div>))
    const chips=host.querySelectorAll('.poker-flying-chip')
    expect(land).not.toHaveBeenCalled()
    await act(async()=>chips[0].dispatchEvent(new Event("animationend",{bubbles:true})))
    await act(async()=>chips[0].dispatchEvent(new Event("animationend",{bubbles:true})))
    expect(land).toHaveBeenCalledTimes(1)
    expect(complete).not.toHaveBeenCalled()
    await act(async()=>chips[1].dispatchEvent(new Event("animationend",{bubbles:true})))
    expect(land).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalledTimes(1)
    await act(async()=>vi.runAllTimers())
    expect(land).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalledTimes(1)
  }finally{await act(async()=>root.unmount());vi.useRealTimers()}
})
it("减少动态效果直接更新金额，不凭空播放整批碰撞",async()=>{
  const media=window.matchMedia
  window.matchMedia=()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}} as unknown as MediaQueryList)
  animationClock()
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host)
  const land=vi.fn(),complete=vi.fn(),transfer={id:"reduced",seatNo:0,fund:"pot" as const,direction:"in" as const,kind:"bet" as const,amount:100,chips:[{value:100 as const,count:1}],started:false}
  try{
    await act(async()=>root.render(<ChipMotion transfers={[transfer]} layout="l" scope="h" onStart={()=>{}} onComplete={complete} onLand={land} />))
    expect(complete).toHaveBeenCalledExactlyOnceWith("reduced")
    expect(land).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
  }finally{await act(async()=>root.unmount());window.matchMedia=media}
})
