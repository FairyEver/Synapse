import { describe, expect, it } from "vitest"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import { GAME_UI_OPERATIONS } from "@synapse/shared/game-ui"
import { GAME_RESPONSE_SCHEMAS } from "../response-schemas"
describe("陪练客户端协议", () => {
  it("机器人管理与人工出牌入座可从UI调用，等待仍仅Agent使用", () => {
    const ids = GAME_UI_OPERATIONS.map((m) => m.id)
    expect(ids).toHaveLength(30)
    expect(ids).toContain("app.game.poker.bot.add")
    expect(ids).toContain("app.game.poker.bot.remove")
    for (const action of ["action.act", "seat.join"]) expect(ids).toContain(`app.game.poker.${action}`)
    expect(ids).not.toContain("app.game.poker.table.wait")
  })
  it("两个管理操作成功/失败输入按既有响应边界校验", () => {
    expect(GAME_TOOLS.filter((t) => t.id.startsWith("app.game.poker.bot."))).toHaveLength(2)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.bot.add"]?.safeParse({ botId: "bot-id", seatNo: 0 }).success).toBe(true)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.bot.add"]?.safeParse({ botId: "bot-id", seatNo: "坏数据" }).success).toBe(false)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.bot.remove"]?.safeParse({ pending: true }).success).toBe(true)
  })
})
