import { describe, expect, it } from "vitest"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import { gameIpcModule } from "../../main/ipc"
import { GAME_RESPONSE_SCHEMAS } from "../response-schemas"
describe("陪练客户端协议", () => {
  it("机器人管理可从UI调用，真人出牌/入座/等待仍不进入IPC", () => {
    const ids = Object.values(gameIpcModule.methods).map((m) => m.operationId)
    expect(ids).toHaveLength(20)
    expect(ids).toContain("app.game.poker.bot.add")
    expect(ids).toContain("app.game.poker.bot.remove")
    for (const action of ["action.act", "seat.join", "table.wait"]) expect(ids).not.toContain(`app.game.poker.${action}`)
  })
  it("两个管理操作成功/失败输入按既有响应边界校验", () => {
    expect(GAME_TOOLS.filter((t) => t.id.startsWith("app.game.poker.bot."))).toHaveLength(2)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.bot.add"]?.safeParse({ botId: "bot-id", seatNo: 0 }).success).toBe(true)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.bot.add"]?.safeParse({ botId: "bot-id", seatNo: "坏数据" }).success).toBe(false)
    expect(GAME_RESPONSE_SCHEMAS["app.game.poker.bot.remove"]?.safeParse({ pending: true }).success).toBe(true)
  })
})
