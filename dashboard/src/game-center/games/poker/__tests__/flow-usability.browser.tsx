import "@/styles/globals.css"
import "../../../styles/web.css"
import { expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { Table } from "../components/Table"
import { PracticePreparation } from "../components/PracticePreparation"
import { PracticeBots } from "../components/PracticeBots"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"

const api = vi.hoisted(() => ({ state: vi.fn(), add: vi.fn(), join: vi.fn(), control: vi.fn(), act: vi.fn() }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "owner" } } } }) }))
vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { table: { state: api.state }, bot: { add: api.add }, seat: { join: api.join }, control: { set: api.control }, action: { act: api.act } } }) }))
const table = { ...tableResponse, mode: "practice" as const, ownerUserId: "owner", controller: "human" as const, controlVersion: 2, mySeatNo: 0, actionOnSeat: 0, actionSeq: 1, board: ["2s", "3h", "4d"], legalActions: ["fold", "call", "raise", "allin"], minRaiseTo: 10, maxRaiseTo: 1000, toCall: 4,
  seats: [{ ...tableResponse.seats[0], seatNo: 0, isMe: true, hole: ["As", "Kh"], stack: 1000, controller: "human" as const, inCurrentHand: true }] }
const dimensions = [[320,568],[390,667],[390,844],[850,700],[851,700],[1280,800]] as const

it.each(dimensions)("%s×%s 常用档位外露，自定义在按钮上方就近展开且不挤压画布", async (width,height) => {
  await page.viewport(width,height)
  const screen = await render(<div className="h-dvh"><Table table={table} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} /></div>)
  try {
    api.act.mockClear()
    const canvas = document.querySelector<HTMLElement>(".poker-canvas")!
    await expect.poll(()=>document.querySelector(".poker-table")?.getAttribute("data-compact-controls")).toBe(String(width<=850))
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    const transform = canvas.style.transform
    const footer = document.querySelector(".poker-controls-anchor")!
    const before = footer.getBoundingClientRect()
    const custom = page.getByRole("button",{name:"自定义",exact:true})
    for (const label of ["最小", "半池", "一池"]) await expect.element(page.getByRole("button",{name:label,exact:true})).toBeVisible()
    await page.getByRole("button",{name:"半池",exact:true}).click()
    expect(api.act).not.toHaveBeenCalled()
    expect(document.querySelector('input[type="number"]')).toBeNull()
    await custom.click()
    const panel = document.querySelector('[role="dialog"][aria-label="加注"]')!.closest(".poker-system-popover")!
    await expect.poll(() => panel.getBoundingClientRect().height > 0).toBe(true)
    const bounds = panel.getBoundingClientRect(), anchor = custom.element().getBoundingClientRect()
    expect(bounds.bottom).toBeLessThanOrEqual(anchor.top)
    expect(anchor.top - bounds.bottom).toBeLessThanOrEqual(16)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(document.querySelector('[aria-label="下注决策信息"]')).toBeNull()
    expect(canvas.style.transform).toBe(transform)
    expect(footer.getBoundingClientRect().height).toBe(before.height)
    const input = page.getByRole("spinbutton",{name:"加注到"})
    await input.fill("18")
    const confirm = page.getByRole("button",{name:"确认加注 18",exact:true})
    await confirm.element().scrollIntoView({block:"nearest"})
    const confirmBounds = confirm.element().getBoundingClientRect()
    expect(confirmBounds.top).toBeGreaterThanOrEqual(0)
    expect(confirmBounds.bottom).toBeLessThanOrEqual(height)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(confirm.element().closest('[role="dialog"]')).toBeNull()
    for (const node of footer.querySelectorAll('button')) {
      const rect=node.getBoundingClientRect()
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(width)
      expect(rect.top).toBeGreaterThanOrEqual(before.top)
      expect(rect.bottom).toBeLessThanOrEqual(height)
    }
    await page.screenshot({path:`.superpowers/sdd/2026-11-01-poker-flow-usability/${width}-${height}-bet.png`})
    await userEvent.keyboard("{Escape}")
    await expect.poll(() => document.activeElement?.textContent).toBe("自定义")
    expect(api.act).not.toHaveBeenCalled()
  } finally { await screen.unmount() }
})

it.each([390,1280])("%s 成员管理可连续增删、内容可滚动、焦点回到入口", async width => {
  await page.viewport(width,667)
  const remove = vi.fn(), add = vi.fn()
  const bots = Array.from({length:9},(_,index)=>({...table.seats[0],seatNo:index+1,isMe:false,participantKind:"bot" as const,botId:`b${index}`,displayName:"陪练".repeat(20)}))
  const fixture={...table,maxSeats:10,seats:[table.seats[0],...bots]}
  const controls={canManage:true,busy:false,full:true,retrying:false,bots,add,remove}
  const screen=await render(<div className="h-dvh"><Table table={fixture} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} members={<PracticeBots controls={controls} table={fixture} />} /></div>)
  try {
    await page.getByRole("button",{name:"成员管理",exact:true}).click()
    const last=page.getByRole("button",{name:`移除 ${bots[0].displayName}`,exact:true}).last()
    await last.click()
    expect(remove).toHaveBeenCalledExactlyOnceWith("b8")
    expect(document.querySelector('[aria-label="房间成员"]')).not.toBeNull()
    await page.screenshot({path:`.superpowers/sdd/2026-11-01-poker-flow-usability/${width}-members.png`})
    await page.getByRole("button",{name:"关闭成员管理",exact:true}).click()
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("成员管理")
  } finally { await screen.unmount() }
})

it.each([390,1280])("%s 陪练准备可调整人数，先配齐阵容再入座", async width => {
  vi.clearAllMocks()
  await page.viewport(width,667)
  const snapshot={...table,handId:null,handNo:0,status:"waiting",mySeatNo:null,seats:[],controller:null,controlVersion:0,board:[],maxSeats:4}
  api.state.mockImplementation(async()=>({...snapshot,seats:[...snapshot.seats]}))
  api.add.mockImplementation(async()=>{const seatNo=snapshot.seats.length;snapshot.seats.push({...table.seats[0],seatNo,isMe:false,participantKind:"bot",botId:`b${seatNo}`});return {botId:`b${seatNo}`,seatNo}})
  api.join.mockResolvedValue({seatNo:3})
  const screen=await render(<div className="h-dvh"><PracticePreparation table={snapshot} onRefresh={vi.fn()} onBack={vi.fn()} /></div>)
  try {
    await page.getByRole("button",{name:/^减少机器人/}).click()
    await page.getByRole("button",{name:/^增加机器人/}).click()
    await page.screenshot({path:`.superpowers/sdd/2026-11-01-poker-flow-usability/${width}-preparation.png`})
    await page.getByRole("button",{name:"入座并开始陪练",exact:true}).click()
    await expect.poll(()=>api.join.mock.calls.length).toBe(1)
    expect(api.add).toHaveBeenCalledTimes(3)
    expect(api.add.mock.invocationCallOrder.at(-1)).toBeLessThan(api.join.mock.invocationCallOrder[0])
  } finally { await screen.unmount() }
})
