/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HumanControls } from "../components/HumanControls"
import { Seat } from "../components/Seat"
import { PracticeBots, PracticeBotAddButton } from "../components/PracticeBots"
import { usePracticeBots } from "../hooks/usePracticeBots"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
import type { PokerTableView } from "@synapse/shared/game-contracts"

const api = vi.hoisted(() => ({ join: vi.fn(), sit: vi.fn(), leave: vi.fn(), set: vi.fn(), act: vi.fn(), add: vi.fn(), remove: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { seat: api, control: api, action: api, bot: api } }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "owner" } } } }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
const table: PokerTableView = { ...tableResponse, ownerUserId: "owner", mode: "practice", controlVersion: 1, controller: "human", actionOnSeat: 0,
  seats: [{ ...tableResponse.seats[0], controller: "human", controlVersion: 1 }], legalActions: ["fold", "call", "raise", "allin"], minRaiseTo: 10, maxRaiseTo: 100 }
afterEach(() => { vi.resetAllMocks(); document.body.replaceChildren() })
async function mount(node: React.ReactNode) {
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  await act(async () => root.render(node))
  return { host, root }
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text || b.getAttribute("aria-label") === text)!

describe("亮色牌桌交互修复", () => {
  it("未入座直接操作，不经过更多菜单", async () => {
    const { host, root } = await mount(<HumanControls table={{ ...table, mySeatNo: null }} perspective="owner" onRefresh={() => {}} />)
    expect(button(host, "本人入座")).toBeDefined()
    expect(button(host, "本人入座").closest('[role="dialog"]')).toBeNull()
    await act(async () => root.unmount())
  })
  it("管理写入成功即关闭，刷新失败也不误报写入失败", async () => {
    api.sit.mockResolvedValue({})
    const refresh = vi.fn().mockRejectedValue(new Error("断流"))
    const { host, root } = await mount(<HumanControls table={table} perspective="owner" onRefresh={refresh} />)
    await act(async () => button(host, "更多牌桌操作").click())
    await act(async () => button(host, "暂离").click())
    expect(api.sit).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain("操作已完成，刷新失败")
    expect(button(host, "重试出牌")).toBeUndefined()
    await act(async () => root.unmount())
  })
  it("管理写入失败保留菜单与错误", async () => {
    api.sit.mockRejectedValue(new Error("暂离失败"))
    const { host, root } = await mount(<HumanControls table={table} perspective="owner" onRefresh={() => {}} />)
    await act(async () => button(host, "更多牌桌操作").click())
    await act(async () => button(host, "暂离").click())
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.textContent).toContain("暂离失败")
    await act(async () => root.unmount())
  })
  it("自定义金额校验给出范围和原因", async () => {
    const { host, root } = await mount(<HumanControls table={table} perspective="owner" onRefresh={() => {}} />)
    expect(host.querySelector("input")).toBeNull()
    await act(async () => button(host, "自定义").click())
    expect(api.act).not.toHaveBeenCalled()
    const input = host.querySelector("input")!
    for (const [value, error] of [["", "请输入金额"], ["1.5", "请输入整数金额"], ["0", "至少加注到 10"], ["101", "最多加注到 100"]]) {
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) })
      expect(host.textContent).toContain(error)
      expect(host.textContent).toContain("10–100")
    }
    await act(async () => root.unmount())
  })
  it("下一手参与者不显示牌背，旧响应仍保留兼容显示", async () => {
    const props = { seat: { ...table.seats[0], inCurrentHand: false }, maxSeats: 4, acting: false, dealer: false, dealt: true, deadlineMs: null }
    const { host, root } = await mount(<Seat {...props} />)
    expect(host.querySelector(".poker-seat-cards")).toBeNull()
    expect(host.textContent).toContain("下一手加入")
    await act(async () => root.render(<Seat {...props} seat={table.seats[0]} />))
    expect(host.querySelector(".poker-seat-cards")).not.toBeNull()
    await act(async () => root.unmount())
  })
  it("新身份占旧赢家座位不继承结果，暂离座位不承诺下一手加入", async () => {
    const result = { handId:"old",handNo:1,board:[],rules:{variant:"standard52" as const,smallBlind:1,bigBlind:2},mixedControl:false,seats:[{seatNo:0,displayName:"旧玩家",participantKind:"human" as const,isMe:false,folded:false,delta:20,payout:40,endingStack:1020}],pots:[{amount:40,eligible:[0],winners:[0],shares:{0:40},refund:false}] }
    const props = { seat:{...table.seats[0],inCurrentHand:false},result,maxSeats:4,acting:false,dealer:false,dealt:true,deadlineMs:null }
    const {host,root}=await mount(<Seat {...props} />)
    expect(host.querySelector('[data-winner="true"]')).toBeNull()
    expect(host.textContent).toContain("下一手加入")
    await act(async()=>root.render(<Seat {...props} seat={{...props.seat,status:"sitting_out"}} />))
    expect(host.textContent).toContain("已暂离")
    expect(host.textContent).not.toContain("下一手加入")
    expect(host.querySelector(".poker-seat-cards")).toBeNull()
    await act(async()=>root.unmount())
  })
  it("管理请求晚成功不能关闭后来打开的面板", async () => {
    let resolve!: (value: object) => void
    api.sit.mockImplementation(()=>new Promise(done=>{resolve=done}))
    const onPanelChange=vi.fn()
    const {host,root}=await mount(<HumanControls table={table} activePanel={null} onPanelChange={onPanelChange} perspective="owner" onRefresh={()=>{}} />)
    await act(async()=>root.render(<HumanControls table={table} activePanel="menu" onPanelChange={onPanelChange} perspective="owner" onRefresh={()=>{}} />))
    await act(async()=>button(host,"暂离").click())
    await act(async()=>root.render(<HumanControls table={table} activePanel="bet" onPanelChange={onPanelChange} perspective="owner" onRefresh={()=>{}} />))
    await act(async()=>resolve({}))
    expect(onPanelChange).not.toHaveBeenCalled()
    expect(host.querySelector('input[type="number"]')).not.toBeNull()
    await act(async()=>root.unmount())
  })
  it("历史机器人不占容量，不显示无效管理；待离桌的当前座位仍占位", async () => {
    function Bots({ value }: { value: PokerTableView }) { return <PracticeBots controls={usePracticeBots(value, () => {})} /> }
    const real = { ...table.seats[0], seatNo: 1, isMe: false, participantKind: "bot" as const, botId: "bot", leavePending: true }
    const historical = { ...real, seatNo: 2, botId: undefined, isHistorical: true }
    const state = { ...table, maxSeats: 3, seats: [table.seats[0], real, historical] }
    const { host, root } = await mount(<Bots value={state} />)
    expect(host.textContent).toContain("陪练机器人 · 1")
    expect(button(host, "添加机器人").disabled).toBe(false)
    expect(host.querySelectorAll('[aria-label^="移除 "]')).toHaveLength(1)
    await act(async () => root.render(<Bots value={{ ...state, maxSeats: 2 }} />))
    expect(button(host, "座位已满").disabled).toBe(true)
    await act(async () => root.unmount())
  })
  it("添加陪练只在确认成功后通知菜单关闭", async () => {
    const add=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true), onAdded=vi.fn()
    const controls={canManage:true,bots:[],full:false,busy:false,retrying:false,add,remove:vi.fn()}
    const {host,root}=await mount(<PracticeBotAddButton controls={controls} onAdded={onAdded} />)
    await act(async()=>button(host,"添加机器人").click())
    expect(onAdded).not.toHaveBeenCalled()
    await act(async()=>button(host,"添加机器人").click())
    expect(onAdded).toHaveBeenCalledOnce()
    await act(async()=>root.unmount())
  })
})
