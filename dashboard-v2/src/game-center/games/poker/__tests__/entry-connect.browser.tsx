import "@/styles/globals.css"
import "../../../styles/web.css"
import { beforeEach, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import { PokerAIConnectDialog } from "../components/PokerAIConnectDialog"
import { Table } from "../components/Table"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"

const api=vi.hoisted(()=>({state:vi.fn(),control:vi.fn(),copy:vi.fn(),join:vi.fn()}))
vi.mock("@/game-center/runtime/account",()=>({useAccount:()=>({state:{status:"authenticated",connectivity:"online",profile:{user:{id:"entry-browser"}}}})}))
vi.mock("../../../lib/api",()=>({gameApi:()=>({hall:{overview:async()=>({points:{available:1000000},sessions:[]})},poker:{table:{state:api.state},control:{set:api.control},seat:{join:api.join}}})}))
const fixture={...tableResponse,mode:"points" as const,handNo:0,handId:null,status:"waiting",street:null,seats:[],mySeatNo:null,controller:null,controlVersion:0,handoffPending:false,legalActions:[]}
beforeEach(()=>{vi.resetAllMocks();api.copy.mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:api.copy}})})
it.each([[390,667],[390,844],[1280,800]])("%s×%s 统一接入面板可展开完整指令、授权、重复复制、取消及关闭重进",async(width,height)=>{
 await page.viewport(width,height)
 let current={...fixture}
 api.state.mockImplementation(async()=>current)
 api.control.mockImplementation(async({action,controlVersion})=>{current={...current,controlVersion:controlVersion+1,handoffPending:action==="request_ai"};return current})
 let screen=await render(<PokerAIConnectDialog open onOpenChange={vi.fn()} roomCode="4821" onChanged={vi.fn()} />)
 try{
  const authorize=page.getByRole("button",{name:"允许 AI 接入并复制指令",exact:true})
  await expect.element(authorize).toBeEnabled()
  expect(api.control).not.toHaveBeenCalled()
  await page.getByRole("button",{name:"查看完整接入指令",exact:true}).click()
  await authorize.element().scrollIntoView({block:"nearest"})
  const bounds=authorize.element().getBoundingClientRect()
  expect(bounds.bottom).toBeLessThanOrEqual(height);expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  await page.screenshot({path:`.superpowers/sdd/2026-11-01-poker-entry-connect/${width}-${height}-expanded.png`})
  await authorize.click()
  await expect.element(page.getByText("等待你的 AI 入座",{exact:true})).toBeVisible()
  await page.getByRole("button",{name:"复制接入指令",exact:true}).click()
  expect(api.control).toHaveBeenCalledTimes(1);expect(api.copy).toHaveBeenCalledTimes(2)
  await screen.unmount()
  screen=await render(<PokerAIConnectDialog open onOpenChange={vi.fn()} roomCode="4821" onChanged={vi.fn()} />)
  await expect.element(page.getByRole("button",{name:"取消 AI 接入",exact:true})).toBeEnabled()
  await page.getByRole("button",{name:"取消 AI 接入",exact:true}).click()
  await expect.element(page.getByText("尚未授权 AI 接入",{exact:true})).toBeVisible()
  expect(api.control).toHaveBeenLastCalledWith({roomCode:"4821",action:"cancel_ai",controlVersion:1})
 }finally{await screen.unmount()}
})
it.each([390,1280])("%s 点数入座提示、等待邀请与统一入口可操作",async width=>{
 await page.viewport(width,667)
 const screen=await render(<div className="h-dvh"><Table table={fixture} perspective="owner" onPerspective={vi.fn()} onBack={vi.fn()} /></div>)
 try{
  await expect.element(page.getByText("可用 1,000,000 点",{exact:true})).toBeVisible()
  await expect.element(page.getByRole("button",{name:"带入 1,000 点入座",exact:true})).toBeEnabled()
  expect(page.getByRole("button",{name:"邀请玩家",exact:true}).element().getBoundingClientRect().bottom).toBeLessThanOrEqual(667)
  expect(document.querySelector(".poker-edge-controls")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
  await page.getByRole("button",{name:"邀请玩家",exact:true}).click()
  expect(api.copy).toHaveBeenCalledWith(expect.stringContaining("/game/poker/4821"));expect(api.join).not.toHaveBeenCalled()
  await page.getByRole("button",{name:"接入 AI",exact:true}).click()
  await expect.element(page.getByRole("dialog",{name:"AI 接入 · #4821"})).toBeVisible()
  expect(api.control).not.toHaveBeenCalled()
  await page.getByRole("button",{name:"关闭 AI 接入",exact:true}).click()
  await expect.element(page.getByRole("button",{name:"接入 AI",exact:true})).toHaveFocus()
  await page.screenshot({path:`.superpowers/sdd/2026-11-01-poker-entry-connect/${width}-waiting.png`})
 }finally{await screen.unmount()}
})
