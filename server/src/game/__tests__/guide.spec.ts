import { describe, expect, it } from "vitest"
import { GameApiService } from "../game-api.service"
import type { HallService } from "../hall/hall.service"
import type { PokerService } from "../poker/poker.service"
import type { PokerActionService } from "../poker/poker-action.service"
import type { PokerWaitService } from "../poker/poker-wait.service"
import type { PokerReadService } from "../poker/poker-read.service"
import type { PokerNudgeService } from "../poker/poker-nudge.service"

describe("扑克接入指南", () => {
  it("明确暂离恢复及异常响应后保留写入标识", async () => {
    const api = new GameApiService(
      {} as HallService,
      {} as PokerService,
      {} as PokerActionService,
      {} as PokerWaitService,
      {} as PokerReadService,
      {} as PokerNudgeService,
    )
    const guide = (await api.run("user", "app.game.poker.guide", {})) as {
      loop: string
      errors: Record<string, string>
    }
    expect(guide.loop).toContain("sitting_out")
    expect(guide.loop).toContain("seat_sit(false)")
    expect(guide.loop).toContain("用户明确要求继续")
    expect(guide.loop).toContain("不自动回座")
    expect(guide.loop).toContain("pending=true")
    expect(guide.loop).toContain("600秒超时离桌")
    expect(guide.errors.GAME_INVALID_RESPONSE).toContain("写结果未知")
    expect(guide.errors.GAME_INVALID_RESPONSE).toContain("actionId")
    expect(guide.errors.GAME_INVALID_RESPONSE).toContain("creationId")
  })
})
