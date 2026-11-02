import "@/styles/globals.css"
import "../../../styles/web.css"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "vitest-browser-react"
import { Table } from "../components/Table"
import { rollTable } from "./roll-visibility-fixtures"

vi.mock("../../../lib/api", () => ({ gameApi: () => ({ poker: { table: { state: vi.fn() } } }) }))
vi.mock("@/game-center/runtime/account", () => ({ useAccount: () => ({ state: { status: "authenticated", connectivity: "online", profile: { user: { id: "owner" } } } }) }))
const sizes = [[390,667],[390,844],[850,700],[1280,800]] as const
const rect = (element: Element) => element.getBoundingClientRect()
const overlap = (a: Element, b: Element) => { const x=rect(a), y=rect(b); return x.left<y.right-1 && x.right>y.left+1 && x.top<y.bottom-1 && x.bottom>y.top+1 }
const stable = () => new Promise(resolve => setTimeout(resolve, 400))
function dialogFits(width: number, height: number) {
  const dialog = document.querySelector('[role="dialog"]')!
  expect(rect(dialog).left).toBeGreaterThanOrEqual(0)
  expect(rect(dialog).right).toBeLessThanOrEqual(width)
  expect(rect(dialog).top).toBeGreaterThanOrEqual(0)
  expect(rect(dialog).bottom).toBeLessThanOrEqual(height)
  for (const button of dialog.querySelectorAll("button")) {
    expect(rect(button).left).toBeGreaterThanOrEqual(0)
    expect(rect(button).right).toBeLessThanOrEqual(width)
    expect(rect(button).bottom).toBeLessThanOrEqual(height)
  }
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  return dialog
}

describe("Roll实际展开布局", () => {
  it.each(sizes)("%s×%s 的两行摘要、点击玩家查看统计和换牌面板", async (width,height) => {
    await page.viewport(width,height)
    const table = rollTable
    const screen = await render(<div className="h-dvh"><Table table={table} identityKey={`roll-${width}-${height}`} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} /></div>)
    try {
      await stable()
      await page.screenshot({ path: `.superpowers/sdd/2026-11-02-poker-roll-visibility/${width}-${height}-table.png` })
      const canvas=document.querySelector<HTMLElement>(".poker-canvas")!, viewport=document.querySelector(".poker-canvas-viewport")!, footer=document.querySelector(".poker-controls-anchor")!
      expect(document.querySelector(".poker-roll-summary-slot")).toBeNull()
      expect(document.querySelector(".poker-seat-roll")).toBeNull()
      expect(document.body.textContent).not.toContain("房间累计")
      expect(rect(footer).height).toBe(144)
      const transform=canvas.style.transform
      const scale=new DOMMatrix(getComputedStyle(canvas).transform).a
      for (const seat of document.querySelectorAll(".poker-seat")) {
        expect(rect(seat).top).toBeGreaterThanOrEqual(rect(viewport).top-1)
        expect(rect(seat).bottom).toBeLessThanOrEqual(rect(viewport).bottom+1)
        expect(overlap(seat,document.querySelector(".poker-board")!)).toBe(false)
        const label=seat.querySelector(".poker-seat-meta")!
        if(canvas.dataset.tableShape!=="landscape") expect(parseFloat(getComputedStyle(label).fontSize)*scale).toBeGreaterThanOrEqual(12)
        for (const other of document.querySelectorAll(".poker-seat")) if (other!==seat) expect(overlap(seat,other),`座位${seat.getAttribute("data-position")}/${other.getAttribute("data-position")}：${JSON.stringify([rect(seat).toJSON(),rect(other).toJSON()])}`).toBe(false)
      }
      await page.getByRole("button",{name:"查看你的玩家信息",exact:true}).click()
      await stable()
      const info=dialogFits(width,height)
      expect(info.querySelector('[aria-label="玩家换牌统计"]')?.textContent).toContain("支出 60 筹码")
      expect(canvas.style.transform).toBe(transform)
      await page.screenshot({ path: `.superpowers/sdd/2026-11-02-poker-roll-visibility/${width}-${height}-stats.png` })
      await userEvent.keyboard("{Escape}")
      await expect.element(page.getByRole("button",{name:"查看你的玩家信息",exact:true})).toHaveFocus()
      await page.getByRole("button",{name:"Roll 换牌",exact:true}).click()
      await stable()
      const dialog=dialogFits(width,height)
      expect(dialog.querySelector('[aria-label="公共牌"] [data-card="Ks"]')).not.toBeNull()
      expect(dialog.textContent).toContain("已支出 22 筹码")
      expect(dialog.textContent).toContain("支付 6 筹码换牌")
      expect(canvas.style.transform).toBe(transform)
      await page.screenshot({ path: `.superpowers/sdd/2026-11-02-poker-roll-visibility/${width}-${height}-roll.png` })
    } finally { await screen.unmount() }
  })
  it.each(sizes)("%s×%s 的超级三选一同屏保留公共牌、手牌和候选", async(width,height)=>{
    await page.viewport(width,height)
    const table={...rollTable,roll:{...rollTable.roll!,pendingSeatNo:0,pending:{rollId:"pending",cardIndex:1,candidates:["2c","3c","4c"]}}}
    const screen=await render(<div className="h-dvh"><Table table={table} identityKey={`pending-${width}`} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} /></div>)
    try {
      await stable()
      if(!document.querySelector('[role="dialog"]')) await page.getByRole("button",{name:"完成换牌",exact:true}).click()
      await stable()
      await page.screenshot({path:`.superpowers/sdd/2026-11-02-poker-roll-visibility/${width}-${height}-super.png`})
      const dialog=dialogFits(width,height), board=dialog.querySelector('[aria-label="公共牌"]')!, hole=dialog.querySelector('[aria-label="当前手牌"]')!, candidates=dialog.querySelector('[role="radiogroup"]')!
      for(const element of [board,hole,candidates]) {
        expect(rect(element).top).toBeGreaterThanOrEqual(rect(dialog).top)
        expect(rect(element).bottom).toBeLessThanOrEqual(rect(dialog.querySelector(".modal__footer")!).top)
      }
      expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(3)
      expect(dialog.textContent).not.toContain("支付 6")
      await page.screenshot({path:`.superpowers/sdd/2026-11-02-poker-roll-visibility/${width}-${height}-super.png`})
    } finally {await screen.unmount()}
  })
  it("窄屏玩家长姓名和大额支出只滚正文，操作完整",async()=>{
    await page.viewport(390,667)
    const name="VeryLongUnbrokenPlayerName".repeat(20)
    const table={...rollTable,mode:"points" as const,seats:rollTable.seats.map((seat,i)=>i===1?{...seat,displayName:name}:seat),rollStats:{...rollTable.rollStats!,seats:rollTable.rollStats!.seats.map(entry=>entry.seatNo===1?{...entry,hand:{count:2000,paid:2147483647},room:{count:1000000,paid:99999999999}}:entry)}}
    const screen=await render(<div className="h-dvh"><Table table={table} perspective="owner" onPerspective={()=>{}} onBack={()=>{}} /></div>)
    try{
      await stable()
      await page.getByRole("button",{name:`查看${name}的玩家信息`,exact:true}).click()
      await stable()
      const dialog=dialogFits(390,667),body=dialog.querySelector(".modal__body")!,footer=dialog.querySelector(".modal__footer")!
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
      expect(rect(body).bottom).toBeLessThanOrEqual(rect(footer).top+1)
      expect(dialog.textContent).toContain("99,999,999,999 点数")
      await page.screenshot({path:".superpowers/sdd/2026-11-02-poker-roll-visibility/390-667-player-long.png"})
    }finally{await screen.unmount()}
  })
})
