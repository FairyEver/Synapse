import { describe, expect, it } from "vitest"
import { GameApiService } from "../game-api.service"
import type { HallService } from "../hall/hall.service"
import type { PokerService } from "../poker/poker.service"
import type { PokerActionService } from "../poker/poker-action.service"
import type { PokerWaitService } from "../poker/poker-wait.service"
import type { PokerReadService } from "../poker/poker-read.service"
import type { PokerNudgeService } from "../poker/poker-nudge.service"

describe("扑克接入指南", () => {
  it("明确暂离座位须经继续指令回座，不能只循环wait", async () => {
    const api = new GameApiService(
      {} as HallService,
      {} as PokerService,
      {} as PokerActionService,
      {} as PokerWaitService,
      {} as PokerReadService,
      {} as PokerNudgeService,
    )
    const guide = (await api.run("user", "app.game.poker.guide", {})) as { loop: string }
    expect(guide.loop).toContain("sitting_out")
    expect(guide.loop).toContain("seat_sit(false)")
    expect(guide.loop).toContain("用户明确要求继续")
    expect(guide.loop).toContain("不自动回座")
  })
})
