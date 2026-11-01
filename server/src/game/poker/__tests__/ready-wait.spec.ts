import { describe, expect, it } from "vitest"
import { PokerWaitService } from "../poker-wait.service"
import type { PokerActionService } from "../poker-action.service"

function fixture(ready = false, controller = "ai") {
  const seat = { id: "seat", userId: "me", controller, controlVersion: 2 }
  const context = { room: { id: "room", status: "paused" }, seats: [seat], tx: {
    gamePokerSeat: { update: async () => {} }, gameSession: { findUnique: async () => null },
  } }
  return new PokerWaitService({ poker: { subscribe: () => () => {}, withRoom: async (_: string, work: (c: unknown) => unknown) => work(context) },
    view: async () => ({ awaitingReady: true, handId: "hand", handNo: 4, controlVersion: 2, cursor: "4:5", actionOnSeat: null, mySeatNo: 0,
      seats: [{ isMe: true, nextHandEligible: true, readyForNextHand: ready }] }),
  } as unknown as PokerActionService)
}
describe("AI显式准备信号", () => {
  it("空游标重连也能发现待准备，不依赖重新收到hand_result", async () => {
    const wait = fixture()
    try { expect(await wait.wait("me", "1234", "", 0)).toMatchObject({ status: "ready_required", handId: "hand", controlVersion: 2, cursor: "4:2147483647" }) }
    finally { wait.onModuleDestroy() }
  })
  it("已准备只等待，真人控制优先返回control_released", async () => {
    const ready = fixture(true), human = fixture(false, "human")
    try {
      expect(await ready.wait("me", "1234", "", 0)).toMatchObject({ status: "waiting" })
      expect(await human.wait("me", "1234", "", 0)).toMatchObject({ status: "control_released" })
    } finally { ready.onModuleDestroy(); human.onModuleDestroy() }
  })
})
