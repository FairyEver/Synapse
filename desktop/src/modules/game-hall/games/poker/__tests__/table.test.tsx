/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
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
describe("只读牌桌", () => {
  it("旁观投影移除自己的底牌、判断、提示词和版本信息", () => {
    const view = projectTable(state, "public")
    expect(view.seats.every((s) => !s.hole)).toBe(true)
    expect(view).not.toHaveProperty("persona")
    expect(view.recentActions[0]).not.toHaveProperty("note")
    expect(view.recentActions[0]).not.toHaveProperty("personaVersionId")
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
  it("桌面只有观看与提醒入口，没有出牌控件；旁观状态不显示私密判断", async () => {
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
    expect(host.textContent).toContain("旁观中")
    expect(host.textContent).not.toContain("私密判断")
    expect(host.querySelector('[aria-label="行动剩余时间"]')).toBeNull()
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
