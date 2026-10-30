/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Card } from "../components/Card"
import { Table } from "../components/Table"
import { projectTable } from "../lib/view"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const state: PokerTableView = {
  roomCode: "1234",
  name: null,
  status: "running",
  buyIn: 1000,
  maxSeats: 2,
  handId: "h",
  handNo: 1,
  street: "preflop",
  board: [],
  pot: 3,
  dealerSeat: 0,
  actionOnSeat: 0,
  deadlineMs: 600000,
  cursor: "1:0",
  mySeatNo: 0,
  seats: [
    {
      seatNo: 0,
      displayName: "我",
      stack: 999,
      status: "active",
      isMe: true,
      streetBet: 1,
      aiState: "online",
      hole: ["As", "Kh"],
    },
    {
      seatNo: 1,
      displayName: "对手",
      stack: 998,
      status: "active",
      isMe: false,
      streetBet: 2,
      aiState: "offline",
    },
  ],
  recentActions: [
    {
      seq: 1,
      seatNo: 0,
      street: "preflop",
      action: "call",
      amount: 1,
      potAfter: 4,
      isAuto: false,
      note: "私密判断",
      personaVersionId: "v",
    },
  ],
  persona: "私密风格",
  deckRemaining: 48,
}
describe("牌桌", () => {
  it("保留边缘提醒入口及原有时间和玩家视角限制", async () => {
    const host = document.createElement("div"), root = createRoot(host), onNudge = vi.fn()
    const render = async (table: PokerTableView, perspective: "owner" | "public" = "owner") =>
      act(async () => root.render(<Table table={table} perspective={perspective} onPerspective={() => {}} onBack={() => {}} onNudge={onNudge} />))
    const nudge = () => [...host.querySelectorAll("button")].find(b => b.textContent === "提醒玩家")
    const active = {...state, actionOnSeat: 1, deadlineMs: 540000}
    await render(active)
    expect(nudge()?.disabled).toBe(false)
    await act(async () => nudge()!.click())
    expect(onNudge).toHaveBeenCalledWith(1)
    await render({...active, deadlineMs: 540001})
    expect(nudge()?.disabled).toBe(true)
    for (const table of [
      {...active, mySeatNo: null},
      {...active, actionOnSeat: null},
      {...active, actionOnSeat: 0},
      {...active, status: "closed"},
      {...active, seats: state.seats.map(s => s.seatNo === 1 ? {...s, participantKind: "bot" as const} : s)},
    ]) {
      await render(table)
      expect(nudge()).toBeUndefined()
    }
    await render(active, "public")
    expect(nudge()).toBeUndefined()
    await act(async () => root.unmount())
  })
  it.each([null, "settled"])("已解散房间优先于%s街道显示结束状态，公开视角仍保护隐私", async (street) => {
    const host = document.createElement("div"), root = createRoot(host), onBack = vi.fn()
    const closed = { ...state, status: "closed", street, actionOnSeat: null, seats: [] }
    await act(async () => root.render(
      <Table table={closed} perspective="public" onPerspective={() => {}} onNudge={() => {}} onBack={onBack} />,
    ))
    expect(host.querySelector(".poker-street")?.textContent).toBe("房间已解散")
    expect(host.querySelector('[role="status"]')?.textContent).toContain("房间已解散")
    expect(host.textContent).not.toMatch(/等待开局|旁观中|私密判断|私密风格/)
    expect(host.querySelector("[data-card]")).toBeNull()
    const back = [...host.querySelectorAll("button")].find((button) => button.textContent === "返回房间")!
    await act(async () => back.click())
    expect(onBack).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })

  it("旁观投影保留服务端授权底牌和本人身份，移除判断、提示词和版本信息", () => {
    const view = projectTable(state, "public")
    expect(view.seats[0].hole).toEqual(["As", "Kh"])
    expect(view.mySeatNo).toBe(0)
    expect(view).not.toHaveProperty("persona")
    expect(view.recentActions[0]).not.toHaveProperty("note")
    expect(view.recentActions[0]).not.toHaveProperty("personaVersionId")
  })
  it("弃牌后始终保留显著文字，获准可见的底牌仍紧凑显示", async () => {
    const host=document.createElement("div"), root=createRoot(host)
    await act(async()=>root.render(<Table table={{...state,seats:[{...state.seats[0],status:"folded"}]}} perspective="public" onPerspective={()=>{}} onBack={()=>{}} />))
    const seat=host.querySelector('[data-folded="true"]')!
    expect(seat.querySelector(".poker-folded-label")?.textContent).toBe("已弃牌")
    expect(seat.querySelector(".poker-seat-cards")?.getAttribute("data-card-size")).toBe("xs")
    expect(seat.querySelector('[data-card="As"]')).not.toBeNull()
    await act(async()=>root.unmount())
  })
  it("未知底牌只渲染牌背，不制造占位牌值", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () => root.render(<Card faceUp={false} />))
    expect(host.querySelector('[data-face="down"]')).not.toBeNull()
    expect(host.querySelector("[data-card]")).toBeNull()
    expect(host.textContent).not.toContain("2")
    await act(async () => root.unmount())
  })
  it("窄窗日志入口可展开和收起，仍只提供观看操作", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () =>
      root.render(
        <Table
          table={state}
          perspective="owner"
          onPerspective={() => {}}
          onNudge={() => {}}
          onBack={() => {}}
        />,
      ),
    )
    const toggle = [...host.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-controls"),
    )!
    expect(toggle).toBeDefined()
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    await act(async () => toggle.click())
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector("aside")?.id).toBe(toggle.getAttribute("aria-controls"))
    await act(async () => toggle.click())
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    await act(async () => root.unmount())
  })
  it("旁观不显示出牌控件和私密判断，仍标记行动座位", async () => {
    const host = document.createElement("div"),
      root = createRoot(host)
    document.body.append(host)
    await act(async () =>
      root.render(
        <Table
          table={state}
          perspective="public"
          onPerspective={() => {}}
          onNudge={() => {}}
          onBack={() => {}}
        />,
      ),
    )
    expect(host.textContent).toContain("AI 操作")
    expect(host.textContent).not.toContain("私密判断")
    expect(host.querySelector('[aria-label="行动剩余时间"]')).not.toBeNull()
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        /^(弃牌|跟注|加注|全下|过牌|接管)$/.test(b.textContent ?? ""),
      ),
    ).toBe(false)
    expect(host.querySelector('input[type="range"]')).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })
})
