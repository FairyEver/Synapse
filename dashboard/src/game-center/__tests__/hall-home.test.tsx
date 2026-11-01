/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { HallHome } from "../components/HallHome"
import type { HallOverview } from "@synapse/shared/game-contracts"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const overview: HallOverview = {
  points: { total: 1000250, available: 998000, inPlay: 2250, netProfit: 250 },
  games: [
    { id: "poker", name: "德州扑克", entry: "/poker", icon: "spade", status: "available" },
    { id: "another", name: "另一个游戏", entry: "/another", icon: "game", status: "available" },
  ],
  sessions: [
    {
      game: "another",
      gameName: "另一个游戏",
      roomCode: "8072",
      seatNo: null,
      status: "active",
      needsAction: true,
      deadlineMs: 90000,
    },
  ],
  next: null,
}
describe("游戏中心入口", () => {
  it("不同游戏使用注册的入口与画面，继续观看保留会话身份，不假定扑克座位", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    const onEnter = vi.fn(),
      onSession = vi.fn()
    await act(async () =>
      root.render(
        <HallHome
          overview={overview}
          previews={{ "/poker": () => null, "/another": () => null }}
          artwork={{ "/another": () => <span>另一款游戏画面</span> }}
          onEnter={onEnter}
          onSession={onSession}
          onGrant={() => {}}
        />,
      ),
    )
    const buttons = [...host.querySelectorAll("button")]
    await act(async () =>
      buttons
        .find(
          (button) =>
            button.textContent?.includes("进入游戏") && button.textContent?.includes("另一个游戏"),
        )!
        .click(),
    )
    expect(onEnter).toHaveBeenCalledExactlyOnceWith("/another")
    await act(async () => buttons.find((button) => button.textContent?.includes("8072"))!.click())
    expect(onSession).toHaveBeenCalledExactlyOnceWith(overview.sessions[0])
    expect(host.textContent).toContain("另一款游戏画面")
    expect(host.textContent).not.toContain("座位 1")
    expect(host.textContent).toContain("1,000,250")
    expect(host.textContent).toContain("1:30")
    await act(async () => root.unmount())
  })
  it("待结算点数有独立数值且阻止补助，旧响应缺字段按零展示",async()=>{
    const host=document.createElement("div"),root=createRoot(host)
    const render=async(pending?:number)=>act(async()=>root.render(<HallHome overview={{...overview,points:{total:pending??0,available:0,inPlay:0,netProfit:0,...(pending===undefined?{}:{pending})},sessions:[]}} previews={{}} onEnter={()=>{}} onSession={()=>{}} onGrant={()=>{}}/>))
    await render(31)
    const metrics=[...host.querySelectorAll('section[aria-label="我的点数"] > div')]
    expect(metrics.find(node=>node.textContent?.includes("待结算"))?.textContent).toContain("31")
    expect(host.textContent).not.toContain("领取每日补助")
    await render()
    expect(host.textContent).toContain("领取每日补助")
    expect(host.textContent).toContain("待结算0")
    await act(async()=>root.unmount())
  })
  it("只有可用点数为零且没有进行中会话时才提供补助", async () => {
    const host = document.createElement("div"),
      root = createRoot(host),
      onGrant = vi.fn()
    const render = async (data: HallOverview) =>
      act(async () =>
        root.render(
          <HallHome
            overview={data}
            previews={{}}
            onEnter={() => {}}
            onSession={() => {}}
            onGrant={onGrant}
          />,
        ),
      )
    const zero = {
      ...overview,
      points: { total: 0, available: 0, inPlay: 0, netProfit: -1000000 },
      sessions: [],
    }
    await render(zero)
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("领取每日补助"))!
        .click(),
    )
    expect(onGrant).toHaveBeenCalledOnce()
    await render({ ...zero, sessions: overview.sessions })
    expect(host.textContent).not.toContain("领取每日补助")
    await act(async () => root.unmount())
  })
})
