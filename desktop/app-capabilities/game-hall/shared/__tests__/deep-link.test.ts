import { describe, expect, it } from "vitest"
import { parseDeclaredAppDeepLink } from "../../../../electron/bootstrap/app-deep-link"
describe("游戏大厅声明式深链", () => {
  it("大厅与牌桌路由只打开观看窗口", () => {
    expect(parseDeclaredAppDeepLink("synapse://app/game-hall")).toMatchObject({
      appId: "game-hall",
      mainHandlerId: "game-hall.open",
      params: {},
    })
    expect(parseDeclaredAppDeepLink("synapse://app/game-hall/poker/4821")).toMatchObject({
      appId: "game-hall",
      mainHandlerId: "game-hall.open",
      params: { entry: "/poker", roomCode: "4821" },
    })
  })
  it.each([
    "synapse://app/game-hall/poker/%2f",
    "synapse://app/game-hall/poker/4821/act",
    "synapse://app/game-hall/poker/4821?act=fold",
    "synapse://app/game-hall/../poker/4821",
  ])("拒绝无效路由%s", (url) => expect(() => parseDeclaredAppDeepLink(url)).toThrow())
})
