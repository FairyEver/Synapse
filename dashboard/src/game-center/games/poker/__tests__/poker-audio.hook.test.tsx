/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePokerAudio } from "../hooks/usePokerAudio"
import { Table } from "../components/Table"
import { soundTable, wager as moneyWager } from "./sound-fixture"
import type { PokerTableView } from "@synapse/shared/game-contracts"

function check(): PokerTableView {
  const table = moneyWager(0)
  return { ...table, recentActions: table.recentActions.map(a => ({ ...a, action: "check", amount: 0 })) }
}

const audio = vi.hoisted(() => ({ activate: vi.fn(), play: vi.fn(), land: vi.fn(), stop: vi.fn(), dispose: vi.fn() }))
vi.mock("../lib/poker-audio", () => ({ createPokerAudio: () => audio }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, host: HTMLDivElement
function Harness({ table, context = "owner", enabled = true }: { table: PokerTableView; context?: string; enabled?: boolean }) {
  usePokerAudio(table, "owner", context, enabled)
  return null
}
async function render(table: PokerTableView, context = "owner", enabled = true) {
  await act(async () => root.render(<Harness table={table} context={context} enabled={enabled} />))
}
describe("牌桌声音生命周期", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    host = document.createElement("div")
    root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.useRealTimers() })
  it("初次进入、重复轮询、过旧快照和历史事件不重播", async () => {
    await render(soundTable)
    expect(audio.play).not.toHaveBeenCalled()
    await render(check())
    expect(audio.play).toHaveBeenCalledTimes(1)
    await render({ ...check() })
    await render(soundTable)
    await render({ ...check() })
    expect(audio.play).toHaveBeenCalledTimes(1)
  })
  it("断流、身份视角控制变化和重新开启声音建立基线", async () => {
    await render(soundTable)
    vi.advanceTimersByTime(3100)
    await render(check())
    await render({ ...check(), actionSeq: 2 }, "other-user")
    await render(soundTable, "other-user", false)
    await render(check(), "other-user", true)
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.stop).toHaveBeenCalled()
  })
  it("后台和恢复时停止声音，恢复后的首个快照不补响", async () => {
    await render(soundTable)
    window.dispatchEvent(new Event("blur"))
    await render(check())
    window.dispatchEvent(new Event("focus"))
    await render(check())
    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.stop).toHaveBeenCalled()
    await render({ ...check(), actionSeq: 2, recentActions: check().recentActions.map(a => ({ ...a, seq: 2 })) })
    expect(audio.play).toHaveBeenCalledTimes(1)
  })
  it("真实牌桌按飞行筹码数发声：100一枚、501两枚，快照不抢响或重播", async () => {
    const original=Element.prototype.animate
    const pending:{element:Element;done:()=>void}[]=[]
    Element.prototype.animate=function(){
      let resolve!:()=>void,reject!:(reason:unknown)=>void,observed=false
      const finished=new Promise<void>((yes,no)=>{resolve=yes;reject=no})
      pending.push({element:this,done:resolve})
      return {get finished(){observed=true;return finished},cancel:()=>{if(observed)reject(new DOMException("Cancelled","AbortError"))}} as unknown as Animation
    }
    const show=async(table:PokerTableView)=>act(async()=>root.render(<Table table={table} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} />))
    try{
      await show(soundTable)
      const first=moneyWager(100)
      await show(first)
      expect(audio.play).not.toHaveBeenCalled()
      expect(audio.land).not.toHaveBeenCalled()
      let chips=pending.filter(p=>p.element.classList.contains("poker-flying-chip"))
      expect(chips).toHaveLength(1)
      await act(async()=>chips[0].done())
      expect(audio.land).toHaveBeenCalledTimes(1)
      const next={...moneyWager(501),actionSeq:2,recentActions:moneyWager(501).recentActions.map(a=>({...a,seq:2}))}
      await show(next)
      chips=pending.filter(p=>p.element.classList.contains("poker-flying-chip"))
      expect(chips).toHaveLength(3)
      await act(async()=>chips[1].done())
      expect(audio.land).toHaveBeenCalledTimes(2)
      await show({...next})
      expect(audio.land).toHaveBeenCalledTimes(2)
      await act(async()=>chips[2].done())
      expect(audio.land).toHaveBeenCalledTimes(3)
      expect(audio.land.mock.calls.every(([cue])=>cue.sound==="chip"&&cue.delay===0)).toBe(true)
      const hidden={...moneyWager(501),actionSeq:3,recentActions:moneyWager(501).recentActions.map(a=>({...a,seq:3}))}
      await show(hidden)
      const inFlight=pending.filter(p=>p.element.classList.contains("poker-flying-chip")).slice(3)
      expect(inFlight).toHaveLength(2)
      await act(async()=>window.dispatchEvent(new Event("blur")))
      await act(async()=>inFlight[0].done())
      expect(audio.land).toHaveBeenCalledTimes(3)
      await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="更多牌桌操作"]')!.click())
      await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="关闭音效"]')!.click())
      await act(async()=>window.dispatchEvent(new Event("focus")))
      await act(async()=>inFlight[1].done())
      expect(audio.land).toHaveBeenCalledTimes(3)
    }finally{await act(async()=>root.unmount());root=createRoot(host);Element.prototype.animate=original}
  })
  it("真实交互解锁音频，卸载释放资源", async () => {
    await render(soundTable)
    document.dispatchEvent(new Event("pointerdown"))
    expect(audio.activate).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
    expect(audio.dispose).toHaveBeenCalledTimes(1)
    root = createRoot(host)
  })
  it("牌桌开关可静音，重新开启不补播静音期间动作", async () => {
    const show = async (table: PokerTableView) => act(async () => root.render(<Table table={table} perspective="owner" onPerspective={() => {}} onBack={() => {}} />))
    await show(soundTable)
    await show(check())
    expect(audio.play).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="更多牌桌操作"]')!.click())
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="关闭音效"]')!
    await act(async () => toggle.click())
    expect(toggle.getAttribute("aria-label")).toBe("开启音效")
    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    const next = { ...check(), actionSeq: 2, recentActions: check().recentActions.map(a => ({ ...a, seq: 2 })) }
    await show(next)
    await act(async () => toggle.click())
    expect(audio.play).toHaveBeenCalledTimes(1)
    await show({ ...next, actionSeq: 3, recentActions: next.recentActions.map(a => ({ ...a, seq: 3 })) })
    expect(audio.play).toHaveBeenCalledTimes(2)
  })
})
