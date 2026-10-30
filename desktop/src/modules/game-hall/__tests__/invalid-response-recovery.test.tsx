/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { AccountService } from "../../../../electron/services/account-service"
import { GameHallService } from "../../../../app-capabilities/game-hall/main/service"
import { hallResponse } from "../../../../app-capabilities/game-hall/main/__tests__/response-fixtures"
import { GameHallApp } from "../GameHallApp"

const wire = vi.hoisted(() => ({ overview: vi.fn() }))
vi.mock("@/app-shell/account", () => ({
  useAccount: () => ({
    state: {
      status: "authenticated",
      connectivity: "online",
      profile: { user: { id: "user" } },
    },
  }),
}))
vi.mock("../lib/api", () => ({ gameApi: () => ({ hall: { overview: wire.overview } }) }))
vi.mock("../game-registry", () => ({ GAME_RENDERERS: {} }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("畸形大厅响应恢复", () => {
  it("坏overview显示错误而非无限加载，重试正常数据后恢复大厅", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: null }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: hallResponse }))
    const service = new GameHallService({
      getState: () => ({ status: "authenticated", profile: { user: { id: "user" } } }),
      onBeforeIdentityChange: () => () => {},
      fetchAuthenticated: fetch,
    } as unknown as AccountService)
    wire.overview.mockImplementation(() => service.callFromUi("app.game.hall.overview", {}))
    const host = document.createElement("div"),
      root = createRoot(host)
    try {
      await act(async () => root.render(<GameHallApp />))
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("游戏响应")
      const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!
      expect(retry.textContent).toBe("重试")
      await act(async () => retry.click())
      expect(host.querySelector('[role="alert"]')).toBeNull()
      expect(host.textContent).toContain("游戏中心")
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      service.dispose()
    }
  })
})
