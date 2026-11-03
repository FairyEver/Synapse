/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Table } from "../components/Table"
import { rollTable } from "./roll-visibility-fixtures"
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: {} }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "owner" } } } }) }))
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { sessionStorage.clear(); document.body.replaceChildren() })
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label)!
async function mount(table = rollTable, identityKey = "owner") {
  const host = document.createElement("div"), root = createRoot(host)
  document.body.append(host)
  const render = (value = table, identity = identityKey) => act(async () => root.render(<Table table={value} identityKey={identity} perspective="owner" onPerspective={() => {}} onBack={() => {}} />))
  await render()
  return { host, root, render }
}
describe("Roll玩家信息", () => {
  it("牌桌不常驻换牌数字，点击玩家后才显示个人和全桌累计", async () => {
    const { host, root } = await mount()
    expect(host.querySelector('[aria-label="查看换牌统计"]')).toBeNull()
    expect(host.querySelector(".poker-seat-roll")).toBeNull()
    expect(host.textContent).not.toContain("房间累计")
    expect(host.querySelectorAll(".poker-seat-info-trigger")).toHaveLength(10)
    await act(async () => button("查看你的玩家信息").click())
    const info=document.querySelector('[aria-label="玩家换牌统计"]')!
    expect(info.textContent).toContain("本手")
    expect(info.textContent).toContain("2 次")
    expect(info.textContent).toContain("支出 22 筹码")
    expect(info.textContent).toContain("支出 60 筹码")
    expect(document.querySelector('[aria-label="全桌换牌统计"]')?.textContent).toContain("96")
    await act(async () => root.unmount())
  })
  it.each([false,true])("超级待选=%s的换牌界面保留公共牌、手牌和未发空槽", async pending => {
    const value = { ...rollTable, roll: { ...rollTable.roll!, ...(pending ? { pendingSeatNo: 0, pending: { rollId: "r", cardIndex: 1, candidates: ["2c", "3c", "4c"] } } : {}) } }
    const { root } = await mount(value)
    if (!document.querySelector('[role="dialog"]')) await act(async () => button(pending ? "完成换牌" : "Roll 换牌").click())
    const dialog = document.querySelector('[role="dialog"]')!, board=dialog.querySelector('[aria-label="公共牌"]')!
    expect(board.querySelector('[aria-label="K♠"]')).not.toBeNull()
    expect(board.querySelectorAll('[aria-label="未发牌"]')).toHaveLength(2)
    expect(dialog.textContent).toContain(pending ? "选择新牌" : "已支出 22 筹码")
    await act(async () => root.unmount())
  })
  it("缺统计不伪造零，同座位换人/账号切换关闭旧玩家信息", async () => {
    const { root, render }=await mount({...rollTable,rollStats:undefined})
    await act(async()=>button("查看你的玩家信息").click())
    expect(document.querySelector('[aria-label="玩家换牌统计"]')?.textContent).toContain("暂不可用")
    await act(async()=>button("关闭").click())
    await render(rollTable)
    await act(async()=>button("查看你的玩家信息").click())
    await render({...rollTable,rollStats:{...rollTable.rollStats!,seats:[{...rollTable.rollStats!.seats[0],key:"replacement"}]}})
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async()=>button("查看你的玩家信息").click())
    await render(rollTable,"other")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async()=>root.unmount())
  })
  it("点击其他玩家只展示该玩家数据，与总览互斥，关闭不提交动作", async()=>{
    const {root}=await mount()
    await act(async()=>button("对局信息").click())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    await act(async()=>button("关闭对局信息").click())
    await act(async()=>{await new Promise(resolve=>requestAnimationFrame(resolve))})
    await act(async()=>button("查看玩家1的玩家信息").click())
    expect(document.querySelector('[role="dialog"][aria-label="总览"]')).toBeNull()
    const info=document.querySelector('[aria-label="玩家换牌统计"]')!
    expect(info.textContent).toContain("支出 8 筹码")
    expect(info.textContent).toContain("支出 36 筹码")
    expect(info.textContent).not.toContain("支出 60")
    await act(async()=>root.unmount())
  })
  it("目标离开再回到同座位不会自动重开信息或抢焦点", async()=>{
    const {root,render}=await mount()
    await act(async()=>button("查看你的玩家信息").click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await render({...rollTable,seats:rollTable.seats.filter(seat=>seat.seatNo!==0)})
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await render(rollTable)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async()=>root.unmount())
  })
})
