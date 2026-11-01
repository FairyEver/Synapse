/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { HumanControls } from "../components/HumanControls"
import { RoomList } from "../components/RoomList"
import { actionState } from "../lib/action-view"
import { tableResponse } from "../../../../../../shared/test/game-response-fixtures"

const api=vi.hoisted(()=>({state:vi.fn(),control:vi.fn(),join:vi.fn(),overview:vi.fn()}))
vi.mock("@/game-center/runtime/account",()=>({useAccount:()=>({state:{status:"authenticated",connectivity:"online",profile:{user:{id:"entry-user"}}}})}))
vi.mock("../../../lib/api",()=>({gameApi:()=>({poker:{table:{state:api.state},control:{set:api.control},seat:{join:api.join}},hall:{overview:api.overview}})}))
vi.stubGlobal("ResizeObserver",class {observe(){} unobserve(){} disconnect(){}})
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const table={...tableResponse,roomCode:"2222",mode:"points" as const,status:"waiting",handId:null,handNo:0,street:null,board:[],mySeatNo:null,controller:null,controlVersion:0,handoffPending:false,seats:[],legalActions:[]}
const roots:ReturnType<typeof createRoot>[]=[]
afterEach(async()=>{for(const root of roots) await act(async()=>root.unmount());roots.length=0;document.body.replaceChildren();vi.resetAllMocks()})
async function mount(node:React.ReactNode){const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);await act(async()=>root.render(node));return {host,root}}
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===label)!
it("点数入座前显示占用及可用点数，邀请只复制链接不入座",async()=>{
 api.overview.mockResolvedValue({points:{available:9000},sessions:[]});api.join.mockResolvedValue({})
 const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}})
 const {host}=await mount(<HumanControls table={table} perspective="owner" onRefresh={vi.fn()} />)
 expect(host.textContent).toContain("点数房");expect(host.textContent).toContain("可用 9,000 点")
 expect(button("带入 1,000 点入座")).toBeDefined()
 await act(async()=>button("邀请玩家").click())
 expect(copy).toHaveBeenCalledWith(expect.stringContaining("/game/poker/2222"));expect(api.join).not.toHaveBeenCalled()
 await act(async()=>button("带入 1,000 点入座").click());expect(api.join).toHaveBeenCalledWith({roomCode:"2222"})
})
it("首局等待不误报下一手，已有进行中手牌仍正确显示下一手加入",()=>{
 const seat={...tableResponse.seats[0],seatNo:0,status:"waiting",stack:1000,inCurrentHand:false}
 expect(actionState({...table,mySeatNo:0,seats:[seat]},false,false)).toContain("还需 1 人")
 expect(actionState({...table,status:"running",handId:"h",handNo:1,mySeatNo:0,seats:[seat]},false,false)).toContain("下一手加入")
})
it("列表显示无座位的服务端等待状态，入口支持查看和取消",async()=>{
 const room={roomCode:"2222",name:"点数房",mode:"points" as const,ownerUserId:"entry-user",maxSeats:4,buyIn:1000,status:"waiting",smallBlind:1,bigBlind:2,players:0,myControl:{seatNo:null,controller:null,controlVersion:2,handoffPending:true}}
 const open=vi.fn()
 const {host}=await mount(<RoomList rooms={[room]} myRoomCodes={[]} userId="entry-user" onRoom={vi.fn()} onConnect={open} onClose={vi.fn()} />)
 expect(host.textContent).toContain("等待你的 AI 接入")
 await act(async()=>button("查看接入 / 取消").click());expect(open).toHaveBeenCalledWith("2222")
})
