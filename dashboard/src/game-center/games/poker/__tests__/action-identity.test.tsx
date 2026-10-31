/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { SidePanel } from "../components/SidePanel"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
describe("牌桌日志行动人", () => {
  it.each(["旧玩家", undefined])("快照为%s时不使用当前座位占用者名字", async (displayName) => {
    const table: PokerTableView = {
      roomCode: "1234",
      name: null,
      status: "running",
      buyIn: 1000,
      maxSeats: 3,
      handId: "hand",
      handNo: 2,
      street: "preflop",
      board: [],
      pot: 3,
      dealerSeat: 1,
      actionOnSeat: 2,
      deadlineMs: 600000,
      cursor: "2:1",
      mySeatNo: null,
      seats: [
        {
          seatNo: 1,
          displayName: "新玩家",
          stack: 1000,
          status: "waiting",
          isMe: false,
          streetBet: 0,
          aiState: "online",
        },
      ],
      recentActions: [
        {
          seq: 1,
          seatNo: 1,
          street: "preflop",
          action: "fold",
          amount: 0,
          potAfter: 3,
          isAuto: true,
          ...(displayName ? { displayName } : {}),
        },
      ],
      deckRemaining: 46,
    }
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () => root.render(<SidePanel table={table} perspective="public" />))
    expect(host.querySelector(".poker-action-player > span")?.textContent).toBe(
      displayName ?? "座位 2",
    )
    expect(host.textContent).not.toContain("新玩家")
    await act(async () => root.unmount())
  })
})
