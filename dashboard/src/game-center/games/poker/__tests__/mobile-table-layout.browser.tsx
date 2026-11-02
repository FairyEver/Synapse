import "@/styles/globals.css"
import "../../../styles/web.css"
import { expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { Table } from "../components/Table"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"
import { rollTable } from "./roll-visibility-fixtures"

vi.mock("../../../lib/api", () => ({gameApi:()=>({poker:{action:{act:vi.fn()}}})}))
const sizes = [[320,568],[390,667],[390,844],[568,320],[667,320],[844,390],[850,700],[851,700],[1280,800]] as const
const fixture = {...tableResponse,roll:rollTable.roll,ruleOptions:rollTable.ruleOptions,mySeatNo:0,controller:"human" as const,controlVersion:2,actionOnSeat:0,maxSeats:10,legalActions:["fold","call","raise","allin"],minRaiseTo:10,maxRaiseTo:1000,toCall:4,
  seats:Array.from({length:10},(_,i)=>({seatNo:i,displayName:i?"玩家姓名":"本人",isMe:i===0,stack:1000,streetBet:10,status:"active",participantKind:i?"bot" as const:"human" as const,controller:"human" as const,aiState:"bot",inCurrentHand:true,...(i===0?{hole:["As","Kh"]}:{})}))}

it.each(sizes)("%s×%s 牌桌与实际展开的金额面板可读、无横向裁切", async (width,height)=>{
  await page.viewport(width,height)
  const screen=await render(<div className="h-dvh"><Table table={fixture} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} members={<div>成员</div>}/></div>)
  try {
    const canvas=document.querySelector<HTMLElement>(".poker-canvas")!
    await expect.poll(()=>canvas.getBoundingClientRect().width<=width && canvas.getBoundingClientRect().width>0).toBe(true)
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    await page.screenshot({path:`.superpowers/poker-mobile/table-${width}-${height}.png`})
    const scale=canvas.getBoundingClientRect().width/canvas.offsetWidth
    expect(parseFloat(getComputedStyle(document.querySelector(".poker-pot-label")!).fontSize)*scale).toBeGreaterThanOrEqual(11.99)
    expect(parseFloat(getComputedStyle(document.querySelector(".poker-stack")!).fontSize)*scale).toBeGreaterThanOrEqual(13.99)
    if(height>420) expect(document.querySelector('.poker-controls-anchor')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(144)
    for(const node of document.querySelectorAll('.poker-edge-controls button,.poker-controls-anchor button')) {
      const bounds=node.getBoundingClientRect()
      if(!bounds.width) continue
      expect(bounds.left,node.textContent??"").toBeGreaterThanOrEqual(0)
      expect(bounds.right,node.textContent??"").toBeLessThanOrEqual(width)
      expect(bounds.top,node.textContent??"").toBeGreaterThanOrEqual(0)
      expect(bounds.bottom,node.textContent??"").toBeLessThanOrEqual(height)
    }
    await page.getByRole("button",{name:"自定义",exact:true}).click()
    await expect.element(page.getByRole("dialog",{name:"加注",exact:true})).toBeVisible()
    const panel=document.querySelector(".poker-system-popover")!.getBoundingClientRect()
    expect(panel.left).toBeGreaterThanOrEqual(0)
    expect(panel.right).toBeLessThanOrEqual(width)
    expect(panel.top).toBeGreaterThanOrEqual(0)
    expect(panel.bottom).toBeLessThanOrEqual(height)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    await page.getByRole("button",{name:"全下",exact:true}).click()
    const confirmation=page.getByRole("alertdialog",{name:"确认全下"})
    await expect.element(confirmation).toBeVisible()
    for(const node of confirmation.element().querySelectorAll('button')) {
      const bounds=node.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(width)
      expect(bounds.bottom).toBeLessThanOrEqual(height)
    }
    await confirmation.getByRole("button",{name:"取消",exact:true}).click()
    await page.getByRole("button",{name:"收起加注设置"}).click()
    const main=document.querySelector(".poker-table-main")!
    for(const stack of document.querySelectorAll('.poker-stack')) {
      stack.scrollIntoView({block:"nearest",inline:"nearest"})
      const bounds=stack.getBoundingClientRect(), visible=main.getBoundingClientRect()
      expect(bounds.top).toBeGreaterThanOrEqual(visible.top-1)
      expect(bounds.bottom).toBeLessThanOrEqual(visible.bottom+1)
    }
    const transform=canvas.style.transform
    await page.getByRole("button",{name:"对局信息",exact:true}).click()
    for(const name of ["总览","AI","日志"]) await page.getByRole("tab",{name,exact:true}).click()
    const drawer=document.querySelector('.poker-information-drawer')!.getBoundingClientRect()
    expect(drawer.top).toBeGreaterThanOrEqual(0)
    expect(drawer.bottom).toBeLessThanOrEqual(document.querySelector('.poker-controls-anchor')!.getBoundingClientRect().top+1)
    await page.getByRole("button",{name:"关闭对局信息"}).click()
    expect(document.querySelector('.poker-canvas')).toBe(canvas)
    expect(canvas.style.transform).toBe(transform)
  } finally {await screen.unmount()}
})
