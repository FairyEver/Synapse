import "@/styles/globals.css"
import "../../../styles/web.css"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { Table } from "../components/Table"
import { MySessions } from "../../../components/MySessions"
import { RoomList } from "../components/RoomList"
import { HandRecord } from "../components/HandRecord"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
import type { PokerTableView } from "@synapse/shared/game-contracts"

const api = vi.hoisted(() => ({ act: vi.fn(), join: vi.fn(), detail: vi.fn() }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: {
  action: { act: api.act }, seat: { join: api.join },
  hand: { history: async () => ({ items: Array.from({ length: 50 }, (_, i) => ({ roomCode: "1234", handNo: i + 1, handId: `h${i}`, createdAt: "2026-11-01T00:00:00Z", delta: i })), nextOffset: 50 }), detail: api.detail },
} }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "owner" } } } }) }))
const sizes = [[390,667],[390,844],[850,700],[851,700],[1280,800]] as const
const fixture = (count: number): PokerTableView => ({ ...tableResponse, mySeatNo: 0, actionOnSeat: 0, controller: "human", controlVersion: 2, legalActions: ["fold", "call", "raise", "allin"], minRaiseTo: 10, maxRaiseTo: 1000,
  seats: Array.from({ length: count }, (_, i) => ({ seatNo: i, displayName: i ? "很长的玩家名称Player".repeat(5) : "本人", stack: 1000, isMe: i === 0, streetBet: 10, status: "active", aiState: "bot", participantKind: i ? "bot" : "human", controller: "human", inCurrentHand: true, ...(i === 0 ? { hole: ["As", "Kh"] } : {}) })), maxSeats: count })
const rect = (e: Element) => e.getBoundingClientRect()
const overlap = (a: Element, b: Element) => { const x = rect(a), y = rect(b); return Math.min(x.right,y.right)-Math.max(x.left,y.left)>1 && Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1 }
function contrast(element: Element) {
  const context = document.createElement("canvas").getContext("2d")!
  const rgb = (color: string) => { context.clearRect(0,0,1,1); context.fillStyle = color; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data] }
  const luminance = (color: number[]) => color.slice(0,3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i],0)
  let parent: Element | null = element, background = [255,255,255,255]
  while (parent) { const color = rgb(getComputedStyle(parent).backgroundColor); if (color[3] === 255) { background = color; break } parent = parent.parentElement }
  const a = luminance(rgb(getComputedStyle(element).color)), b = luminance(background)
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05)
}
async function stable() { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) }

describe.each(sizes)("亮色牌桌 %s×%s", (width,height) => {
  it.each([2,4,6,10])("%s座可读、无裁切与互相遮挡，面板不挤压画布", async count => {
    await page.viewport(width,height)
    const screen = await render(<div className="h-dvh"><Table table={fixture(count)} perspective="owner" onPerspective={() => {}} onBack={() => {}} /></div>)
    try {
      await expect.poll(() => document.querySelector(".poker-table")?.getAttribute("data-compact-controls")).toBe(String(width <= 850))
      await stable()
      const canvas = document.querySelector<HTMLElement>(".poker-canvas")!, viewport = document.querySelector(".poker-canvas-viewport")!, footer = document.querySelector(".poker-controls-anchor")!
      await expect.poll(() => rect(canvas).width <= rect(viewport).width + 1 && rect(canvas).height <= rect(viewport).height + 1).toBe(true)
      const scale = rect(canvas).width / canvas.offsetWidth
      for (const selector of [".poker-pot-label", ".poker-board-caption", ".poker-seat-meta"]) {
        const element = document.querySelector(selector)!
        expect(parseFloat(getComputedStyle(element).fontSize) * scale, selector).toBeGreaterThanOrEqual(11.99)
      }
      expect(parseFloat(getComputedStyle(document.querySelector(".poker-stack")!).fontSize) * scale).toBeGreaterThanOrEqual(13.99)
      for (const selector of [".poker-pot-label", ".poker-seat-meta", ".poker-ai-state[data-acting=true]", ".poker-control-state", '.poker-seat[data-mine=true] .poker-seat-avatar']) expect(contrast(document.querySelector(selector)!), selector).toBeGreaterThanOrEqual(4.5)
      expect(rect(document.querySelector(".poker-edge-controls")!).height).toBe(56)
      const seats = [...document.querySelectorAll(".poker-seat")]
      const board = document.querySelector(".poker-board")!
      for (const seat of seats) {
        expect(rect(seat).left).toBeGreaterThanOrEqual(rect(viewport).left - 1)
        expect(rect(seat).right).toBeLessThanOrEqual(rect(viewport).right + 1)
        expect(rect(seat).top).toBeGreaterThanOrEqual(rect(viewport).top - 1)
        expect(rect(seat).bottom).toBeLessThanOrEqual(rect(viewport).bottom + 1)
        expect(overlap(seat, board), `公共牌与座位${seat.getAttribute("data-position")}`).toBe(false)
        for (const other of seats) if (seat !== other) expect(overlap(seat,other), `座位${seat.getAttribute("data-position")}/${other.getAttribute("data-position")}`).toBe(false)
      }
      const transform = canvas.style.transform
      await page.getByRole("button",{name:"日志",exact:true}).click()
      const drawer = document.querySelector(".poker-information-drawer")!
      expect(rect(drawer).bottom).toBeLessThanOrEqual(rect(footer).top + 1)
      expect(canvas.style.transform).toBe(transform)
      await userEvent.keyboard("{Escape}")
      expect(document.querySelector(".poker-information-drawer")?.hasAttribute("hidden")).toBe(true)
      if (count === 10) await page.screenshot({path:`.superpowers/sdd/2026-11-01-poker-light-ui/${width}-${height}-10-seats.png`})
    } finally { await screen.unmount() }
  })
})

it.each(sizes)("%s×%s 的10座结算、长姓名和公共牌互不遮挡", async (width,height) => {
  await page.viewport(width,height)
  const table = fixture(10), board = ["As","Kh","Qd","Jc","Ts"]
  const settlement = { handId:"hand",handNo:1,board,rules:{variant:"standard52" as const,smallBlind:1,bigBlind:2},mixedControl:false,
    seats:table.seats.map(seat => ({seatNo:seat.seatNo,displayName:seat.displayName,participantKind:seat.participantKind!,isMe:seat.isMe,folded:false,delta:seat.seatNo<2?40:-10,payout:seat.seatNo<2?50:0,endingStack:seat.stack,handName:"顺子"})),
    pots:[{amount:100,eligible:[0,1],winners:[0,1],shares:{0:50,1:50},refund:false}] }
  const screen = await render(<div className="h-dvh"><Table table={{...table,board,street:"settled",status:"paused",actionOnSeat:null,settlement}} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} /></div>)
  try {
    await stable()
    const seats = [...document.querySelectorAll(".poker-seat")], cards = document.querySelector(".poker-board")!, result = document.querySelector(".poker-settlement")!, footer = document.querySelector(".poker-controls-anchor")!
    expect(contrast(document.querySelector(".poker-seat-result")!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(document.querySelector(".poker-settlement b")!)).toBeGreaterThanOrEqual(4.5)
    for (const seat of seats) {
      expect(overlap(seat,cards)).toBe(false)
      expect(overlap(seat,result)).toBe(false)
      expect(overlap(seat,footer)).toBe(false)
      for (const other of seats) if (seat !== other) expect(overlap(seat,other)).toBe(false)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    if (width === 390 && height === 667) await page.screenshot({path:".superpowers/sdd/2026-11-01-poker-light-ui/390-667-settlement.png"})
  } finally { await screen.unmount() }
})

it("窄屏房间和会话无需横向滚动即可继续游戏", async () => {
  await page.viewport(390,844)
  const onOpen = vi.fn(), onRoom = vi.fn()
  const screen = await render(<div className="p-4"><MySessions sessions={[{game:"poker",gameName:"德州扑克",roomCode:"1234",funding:"practice",status:"active",seatNo:0,needsAction:true,deadlineMs:20000}]} onOpen={onOpen} /><RoomList rooms={[{roomCode:"1234",name:"很长的房间名称",mode:"practice",ownerUserId:"owner",maxSeats:4,players:2,status:"running",buyIn:1000,smallBlind:5,bigBlind:10}]} userId="owner" myRoomCodes={["1234"]} onRoom={onRoom} onConnect={() => {}} onClose={() => {}} /></div>)
  try {
    await stable()
    const button = document.querySelector<HTMLButtonElement>(".game-session-table button")!
    expect(rect(button).right).toBeLessThanOrEqual(390)
    expect(rect(button).left).toBeGreaterThanOrEqual(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.getByRole("button",{name:"继续游戏 #1234"}).click()
    expect(onOpen).toHaveBeenCalledOnce()
    await page.getByRole("button",{name:"很长的房间名称"}).click()
    expect(onRoom).toHaveBeenCalledExactlyOnceWith("1234")
    await page.screenshot({path:".superpowers/sdd/2026-11-01-poker-light-ui/compact-lists.png"})
  } finally { await screen.unmount() }
})

it("窄屏50条记录选中立即进入详情，返回恢复滚动和焦点", async () => {
  await page.viewport(390,844)
  api.detail.mockResolvedValue({roomCode:"1234",handNo:5,board:[],seats:[],actions:[],mode:"practice"})
  const screen = await render(<div className="game-center h-dvh overflow-y-auto"><HandRecord /></div>)
  try {
    await expect.element(page.getByRole("button",{name:/#1234 · 第 5 手/})).toBeVisible()
    const scroller = document.querySelector<HTMLElement>(".game-center")!
    scroller.scrollTop = 280
    const before = scroller.scrollTop
    await page.getByRole("button",{name:/#1234 · 第 5 手/}).click()
    await expect.element(page.getByRole("heading",{name:"#1234 · 第 5 手 · 陪练"})).toBeVisible()
    expect(scroller.scrollTop).toBe(0)
    expect(getComputedStyle(document.querySelector(".poker-record-list")!).display).toBe("none")
    await page.getByRole("button",{name:"返回记录列表"}).click()
    expect(scroller.scrollTop).toBe(before)
    expect(document.activeElement?.getAttribute("aria-pressed")).toBe("false")
  } finally { await screen.unmount() }
})

it("菜单首次单击、外部关闭后重开、键盘和触摸指针都只需一次，切换金额不出牌", async () => {
  await page.viewport(390,844)
  api.act.mockReset()
  const screen = await render(<div className="h-dvh"><Table table={fixture(4)} perspective="owner" onPerspective={() => {}} onBack={() => {}} /></div>)
  try {
    await expect.poll(() => document.querySelector(".poker-table")?.getAttribute("data-compact-controls")).toBe("true")
    const trigger = page.getByRole("button",{name:"更多牌桌操作"})
    await trigger.click()
    await expect.element(page.getByRole("dialog",{name:"更多操作"})).toBeVisible()
    await page.getByRole("button",{name:"加注",exact:true}).click()
    await expect.element(page.getByRole("dialog",{name:"加注",exact:true})).toBeVisible()
    expect(api.act).not.toHaveBeenCalled()
    await userEvent.keyboard("{Escape}")
    await trigger.click()
    await page.getByRole("button",{name:"日志",exact:true}).click()
    await expect.element(page.getByRole("dialog",{name:"更多操作"})).not.toBeInTheDocument()
    await page.getByRole("button",{name:"关闭日志"}).click()
    const native = document.querySelector<HTMLButtonElement>('[aria-label="更多牌桌操作"]')!
    native.focus()
    await userEvent.keyboard("{Enter}")
    await expect.element(page.getByRole("dialog",{name:"更多操作"})).toBeVisible()
    await userEvent.keyboard("{Escape}")
    const bounds = native.getBoundingClientRect()
    for (const type of ["pointerdown","pointerup"]) native.dispatchEvent(new PointerEvent(type,{ bubbles:true, pointerType:"touch", pointerId:1, isPrimary:true, button:0, clientX:bounds.x+bounds.width/2, clientY:bounds.y+bounds.height/2 }))
    await expect.element(page.getByRole("dialog",{name:"更多操作"})).toBeVisible()
    expect(api.act).not.toHaveBeenCalled()
  } finally { await screen.unmount() }
})

it("窄屏等待AI接入时全部直达操作保持在底栏内", async () => {
  await page.viewport(390,667)
  const screen = await render(<div className="h-dvh"><Table table={{...fixture(4),mySeatNo:null,controller:null,handoffPending:true}} perspective="public" onPerspective={()=>{}} onBack={()=>{}} /></div>)
  try {
    await stable()
    const footer=document.querySelector(".poker-controls-anchor")!
    for(const button of document.querySelectorAll(".poker-join-controls button")) {
      expect(rect(button).bottom).toBeLessThanOrEqual(rect(footer).bottom)
      expect(rect(button).right).toBeLessThanOrEqual(rect(footer).right)
    }
    await expect.element(page.getByRole("button",{name:"复制 AI 接入指令"})).toBeVisible()
    await expect.element(page.getByRole("button",{name:"取消 AI 接入"})).toBeVisible()
  } finally {await screen.unmount()}
})
