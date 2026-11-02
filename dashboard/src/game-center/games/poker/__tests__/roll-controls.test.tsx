/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { usePokerRoll } from "../hooks/usePokerRoll"
import { projectTable } from "../lib/view"
import { rollAmounts, rollEventLabel } from "../lib/roll-view"
import { tableMotion } from "../lib/table-motion"
import { pokerSoundCues } from "../lib/poker-sounds"
import { invested } from "../lib/settlement-view"
import { roomPreferencesStore } from "../../../runtime/preferences"
const api = vi.hoisted(() => ({start:vi.fn(),choose:vi.fn(),state:vi.fn()}))
vi.mock("../../../lib/api",()=>({gameApi:()=>({poker:{roll:{start:api.start,choose:api.choose},table:{state:api.state}}})}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const table:PokerTableView={roomCode:"1234",name:null,status:"running",buyIn:1000,maxSeats:2,handId:"h",handNo:1,street:"flop",board:[],pot:20,dealerSeat:0,actionOnSeat:0,deadlineMs:10000,cursor:"1:3",mySeatNo:0,seats:[{seatNo:0,isMe:true,displayName:"我",stack:100,status:"active",streetBet:2,aiState:"online"}],recentActions:[],deckRemaining:40,actionSeq:3,controlVersion:4,controller:"human",hole:["As","Kd"],roll:{enabled:true,count:0,normal:{fee:3,available:true},super:{fee:8,available:true},pending:null}}
let current:ReturnType<typeof usePokerRoll>
function Harness({value=table,identity="roll-user",refresh=vi.fn(),perspective="owner"}:{value?:PokerTableView;identity?:string;refresh?:()=>Promise<void>|void;perspective?:"owner"|"public"}){current=usePokerRoll(value,perspective,refresh,identity);return null}
afterEach(()=>{vi.resetAllMocks();localStorage.clear();sessionStorage.clear();document.body.replaceChildren()})
async function mount(value=table,identity="roll-user",refresh=vi.fn()){const host=document.createElement("div"),root=createRoot(host);document.body.append(host);await act(async()=>root.render(<Harness value={value} identity={identity} refresh={refresh}/>));return root}
describe("Roll决策与恢复",()=>{
 it("连续槽位只来自当前行动点确认的成功换牌，切换视角后不恢复旧选择",async()=>{
  api.start.mockResolvedValue({ok:true,actionSeq:4})
  const root=await mount(table,"continuation-boundary")
  await act(async()=>current.start("normal",1,3))
  expect(current.continuation).toBeNull()
  const value={...table,actionSeq:4,roll:{...table.roll!,count:1}}
  await act(async()=>root.render(<Harness value={value} identity="continuation-boundary"/>))
  expect(current.continuation).toMatchObject({kind:"normal",cardIndex:1})
  await act(async()=>root.render(<Harness value={value} identity="continuation-boundary" perspective="public"/>))
  await act(async()=>root.render(<Harness value={value} identity="continuation-boundary"/>))
  expect(current.continuation).toBeNull()
  expect(api.start).toHaveBeenCalledOnce()
  await act(async()=>root.unmount())
 })
 it("换牌序号推进不模拟普通下注、旧动作或筹码声音",()=>{
  const next={...table,actionSeq:4,hole:["2c","Kd"],seats:table.seats.map(seat=>({...seat,stack:92,rollPaid:8}))}
  expect(tableMotion(table,next)).toMatchObject({actions:[],transfers:[],turn:null})
  expect(pokerSoundCues(table,next,"owner")).toEqual([])
 })
 it("超级选择事件保留费用作审计但不再次记账",()=>{
  const start={kind:"super" as const,phase:"start" as const,fee:8,count:1,seatNo:0,displayName:"我",source:"human" as const,compensations:{"1":8}}
  const choose={...start,phase:"choose" as const}
  expect(rollAmounts([start,choose],0)).toEqual({paid:8,received:0})
  expect(rollAmounts([start,choose],1)).toEqual({paid:0,received:8})
  expect(rollEventLabel(choose)).not.toContain("支出")
  expect(rollAmounts(undefined,1)).toEqual({paid:0,received:0})
 })
 it("明确确认才提交当前报价和旧牌位置，同次未知写入重读后复用完整请求",async()=>{
  api.start.mockRejectedValueOnce(new Error("响应丢失")).mockResolvedValueOnce({ok:true});api.state.mockResolvedValue(table)
  const root=await mount(table,"retry-roll")
  expect(api.start).not.toHaveBeenCalled()
  await act(async()=>current.start("super",1,8));const input=api.start.mock.calls[0][0]
  expect(input).toMatchObject({kind:"super",cardIndex:1,expectedFee:8,handId:"h",street:"flop",expectedActionSeq:3,controlVersion:4})
  expect(current.blocked).toBe(true)
  await act(async()=>root.render(<Harness value={{...table,actionSeq:4,controlVersion:5}} identity="retry-roll"/>))
  await act(async()=>current.retry())
  expect(api.state).toHaveBeenCalledWith({roomCode:"1234"})
  expect(api.start.mock.calls[1][0]).toEqual(input)
  expect(current.blocked).toBe(false)
  await act(async()=>root.unmount())
 })
 it("费用改变拒绝后读取新报价，不自动改价重发",async()=>{
  api.start.mockRejectedValueOnce(Object.assign(new Error("费用变了"),{code:"POKER_ROLL_PRICE_CHANGED"}))
  const refresh=vi.fn(),root=await mount(table,"reprice-roll",refresh)
  await act(async()=>current.start("normal",0,3))
  expect(api.start).toHaveBeenCalledOnce();expect(refresh).toHaveBeenCalledOnce();expect(current.blocked).toBe(false)
  await act(async()=>root.unmount())
 })
 it("AI控制时不能重抽或选择；接管后选择携带原Roll身份",async()=>{
  const pending={rollId:"old-roll",cardIndex:1,candidates:["2c","3c","4c"]}
  const value={...table,roll:{...table.roll!,pending}}
  api.choose.mockResolvedValue({ok:true})
  const root=await mount({...value,controller:"ai"},"pending-roll")
  await act(async()=>{current.start("normal",0,3);current.choose(2)})
  expect(api.start).not.toHaveBeenCalled();expect(api.choose).not.toHaveBeenCalled()
  await act(async()=>root.render(<Harness value={{...value,controlVersion:5}} identity="pending-roll"/>))
  await act(async()=>current.choose(2))
  expect(api.choose).toHaveBeenCalledWith(expect.objectContaining({rollId:"old-roll",candidateIndex:2,controlVersion:5,expectedActionSeq:3}))
  await act(async()=>root.unmount())
 })
 it("账号/房间切换后旧响应不刷新新上下文，回到原房仍可核对原UUID",async()=>{
  let resolve!:(v:unknown)=>void
  api.start.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));const refresh=vi.fn(),root=await mount(table,"late-roll",refresh)
  await act(async()=>{void current.start("normal",0,3)})
  await act(async()=>root.render(<Harness identity="new-account" value={{...table,roomCode:"5678"}} refresh={refresh}/>))
  await act(async()=>resolve({ok:true}))
  expect(refresh).not.toHaveBeenCalled();expect(current.blocked).toBe(false)
  await act(async()=>root.unmount())
 })
 it.each(["hand","control","sequence"])("%s变化后迟到请求不刷新或报错到新行动点，未知意图仍可原UUID确认",async(change)=>{
  let reject!:(reason:Error)=>void
  api.start.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail})).mockResolvedValueOnce({ok:true});api.state.mockResolvedValue(table)
  const refresh=vi.fn(),identity=`epoch-${change}`,root=await mount(table,identity,refresh)
  await act(async()=>{void current.start("normal",0,3)})
  const original=api.start.mock.calls[0][0]
  const value={...table,...(change==="hand"?{handId:"new-hand"}:change==="control"?{controlVersion:5}:{actionSeq:4})}
  await act(async()=>root.render(<Harness value={value} identity={identity} refresh={refresh}/>))
  expect(current.busy).toBe(false)
  expect(current.blocked).toBe(true)
  await act(async()=>reject(new Error("旧响应丢失")))
  expect(current.error).toBeNull();expect(refresh).not.toHaveBeenCalled()
  await act(async()=>current.retry())
  expect(api.start.mock.calls[1][0]).toEqual(original)
  await act(async()=>root.unmount())
 })
 it("卸载再回同房后未知选择继续沿用原UUID，不重选",async()=>{
  api.choose.mockRejectedValueOnce(new Error("响应丢失")).mockResolvedValueOnce({ok:true});api.state.mockResolvedValue(table)
  const value={...table,roll:{...table.roll!,pending:{rollId:"restore-roll",cardIndex:0,candidates:["2c","3c","4c"]}}}
  const first=await mount(value,"restore-choice")
  await act(async()=>current.choose(1));const input=api.choose.mock.calls[0][0]
  await act(async()=>first.unmount())
  const second=await mount({...value,controlVersion:8},"restore-choice")
  expect(current.blocked).toBe(true)
  await act(async()=>current.retry())
  expect(api.choose.mock.calls[1][0]).toEqual(input)
  await act(async()=>second.unmount())
 })
 it.each(["hand","control","sequence"].flatMap(change=>["success","rejection"].map(outcome=>[change,outcome])))("%s变化后的旧%s立即同步解除恢复状态，不刷新新epoch",async(change,outcome)=>{
  let resolve!:(v:unknown)=>void,reject!:(reason:Error)=>void
  api.start.mockImplementationOnce(()=>new Promise((done,fail)=>{resolve=done;reject=fail}))
  const refresh=vi.fn(),identity=`stale-${outcome}-${change}`,root=await mount(table,identity,refresh)
  await act(async()=>{void current.start("normal",0,3)})
  const value={...table,...(change==="hand"?{handId:"new-hand"}:change==="control"?{controlVersion:5}:{actionSeq:4})}
  await act(async()=>root.render(<Harness value={value} identity={identity} refresh={refresh}/>))
  expect(current.uncertain).toBe(true)
  await act(async()=>outcome==="success"?resolve({ok:true}):reject(Object.assign(new Error("过期"),{code:"POKER_STALE_ACTION"})))
  expect(current.uncertain).toBe(false);expect(current.blocked).toBe(false)
  expect(refresh).not.toHaveBeenCalled()
  await act(async()=>root.unmount())
 })
 it("硬刷新后只读取原持久参数确认，新的手/控制/序号不改写原意图",async()=>{
  const identity="hard-reload-hook",input={roomCode:"1234",handId:"original-hand",street:"turn",expectedActionSeq:9,controlVersion:2,actionId:"8529bfca-a8e8-4de4-89da-162f516d2f04",kind:"super",cardIndex:1,expectedFee:17}
  const key=`synapse.game.poker-roll-intent.v1:${JSON.stringify([identity,"1234"])}`
  sessionStorage.setItem(key,JSON.stringify({version:1,identityKey:identity,roomCode:"1234",intent:{operation:"start",input}}))
  api.start.mockResolvedValue({ok:true});api.state.mockResolvedValue(table)
  const root=await mount({...table,handId:"new-hand",controlVersion:12,actionSeq:55},identity)
  expect(current.uncertain).toBe(true);expect(api.start).not.toHaveBeenCalled()
  await act(async()=>current.retry())
  expect(api.start).toHaveBeenCalledExactlyOnceWith(input)
  expect(sessionStorage.getItem(key)).toBeNull();expect(current.blocked).toBe(false)
  await act(async()=>root.unmount())
 })
 it("存储不可用时不发送需付费请求并显式提示",async()=>{
  const failure=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("denied")})
  const root=await mount(table,"storage-unavailable")
  await act(async()=>current.start("super",0,8))
  expect(api.start).not.toHaveBeenCalled();expect(current.error).toContain("恢复记录");expect(current.blocked).toBe(false)
  failure.mockRestore()
  await act(async()=>root.unmount())
 })
 it("公开本地视角抹除本人候选与报价",()=>{
  const publicView=projectTable({...table,roll:{...table.roll!,pending:{rollId:"r",cardIndex:0,candidates:["2c","3c","4c"]},pendingSeatNo:0}},"public")
  expect(publicView.roll).toEqual({enabled:true,pendingSeatNo:0})
 })
 it("普通投入不把Roll成本重复算作下注",()=>{
  expect(invested({seatNo:0,displayName:"我",participantKind:"human",isMe:true,folded:false,delta:12,payout:40,endingStack:112,rollPaid:8,rollReceived:10,pokerDelta:10})).toBe(30)
 })
 it("建房Roll偏好按账号隔离，旧记录默认关闭",async()=>{
  const base={mode:"points" as const,variant:"standard52" as const,blindPreset:"1/2" as const,maxSeats:6,buyIn:1000}
  localStorage.setItem("synapse.game.poker-room-preferences.v1:old",JSON.stringify(base))
  expect(await roomPreferencesStore.get("old")).toMatchObject({roll:false})
  await roomPreferencesStore.update("one",{...base,roll:true})
  expect(await roomPreferencesStore.get("one")).toMatchObject({roll:true});expect(await roomPreferencesStore.get("two")).toBeNull()
 })
})
