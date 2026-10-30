/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { PokerSettlementView, PokerTableEventsView } from "@synapse/shared/game-contracts"
import { Settlement } from "../components/Settlement"
import { usePokerEvents } from "../hooks/usePokerEvents"
const query = vi.hoisted(() => ({ data: null as PokerTableEventsView | null, error: null as string | null, read: null as (() => Promise<PokerTableEventsView>) | null }))
const api = vi.hoisted(() => ({events:vi.fn()}))
vi.mock("../../../hooks/useGameQuery", () => ({ useGameQuery: (read: () => Promise<PokerTableEventsView>) => { query.read = read; return query } }))
vi.mock("../../../lib/api", () => ({gameApi: () => ({poker:{table:{events:api.events}}})}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const settlement: PokerSettlementView = {
  handId: "h1", handNo: 1, board: ["Ah","As","7c","8d","Td"],
  rules: { variant: "short32", smallBlind: 2, bigBlind: 4 }, mixedControl: true,
  seats: [{seatNo:0,displayName:"玩家",participantKind:"human",isMe:true,folded:false,hole:["Ac","Ad"],delta:30,payout:50,endingStack:1030,handName:"四条"},{seatNo:1,displayName:"另一玩家",participantKind:"human",isMe:false,folded:true,delta:-30,payout:0,endingStack:970}],
  pots: [{amount:40,eligible:[0],winners:[0],shares:{0:40},refund:false},{amount:10,eligible:[0],winners:[],shares:{0:10},refund:true}],
}
function Harness({identity="one",perspective="owner"}: {identity?:string;perspective?:"owner"|"public"}) {
  const state=usePokerEvents("1234",perspective,true,identity)
  return <output data-events={state.events.length} data-animate={state.animate.length}>{state.events.map(e=>e.settlement?.seats[0].hole?.join(",")).join("|")}</output>
}
describe("实时事件与结果",()=>{
  it.each(["owner", "public"] as const)("事件查询显式携带%s视角，隔离教学牌面", async (perspective) => {
    query.data = null
    query.error = null
    api.events.mockReset().mockResolvedValue({events:[],cursor:"empty",hasMore:false})
    const host = document.createElement("div"), root = createRoot(host)
    await act(async () => root.render(<Harness perspective={perspective} />))
    await query.read!()
    expect(api.events).toHaveBeenCalledWith({roomCode:"1234",cursor:undefined,limit:100,perspective})
    await act(async () => root.unmount())
  })
  it("首次载入和断线恢复不播放旧动画，同事件只保留一次且账号切换清空历史",async()=>{
    const host=document.createElement("div"),root=createRoot(host)
    const first={kind:"settlement" as const,handId:"h1",handNo:1,seq:3,settlement}
    query.data={events:[first],cursor:"first",hasMore:false};query.error=null
    await act(async()=>root.render(<Harness />))
    expect(host.querySelector("output")?.dataset).toMatchObject({events:"1",animate:"0"})
    query.data={events:[first,{kind:"action",handId:"h2",handNo:2,seq:1}],cursor:"second",hasMore:false}
    await act(async()=>root.render(<Harness />))
    expect(host.querySelector("output")?.dataset).toMatchObject({events:"2",animate:"1"})
    query.error="连接断开"
    await act(async()=>root.render(<Harness />))
    query.error=null;query.data={events:[{kind:"action",handId:"h2",handNo:2,seq:2}],cursor:"third",hasMore:false}
    await act(async()=>root.render(<Harness />))
    expect(host.querySelector("output")?.dataset).toMatchObject({events:"3",animate:"0"})
    await act(async()=>root.render(<Harness identity="two" />))
    expect(host.querySelector("output")?.dataset.events).toBe("0")
    expect(host.textContent).not.toContain("Ac")
    await act(async()=>root.unmount())
  })
  it("结算展示牌型、净盈亏、返还并保留服务端授权牌面",async()=>{
    const host=document.createElement("div"),root=createRoot(host)
    await act(async()=>root.render(<Settlement settlement={settlement} />))
    expect(host.textContent).toContain("四条")
    expect(host.textContent).toContain("+30")
    expect(host.textContent).toContain("-30")
    expect(host.textContent).toContain("主池 40")
    expect(host.textContent).toContain("未跟注返还 10")
    expect(host.textContent).toContain("人机混合")
    expect(host.querySelector('[data-card="Ac"]')).not.toBeNull()
    await act(async()=>root.unmount())
  })
})
