import { describe, expect, it, vi } from "vitest"
vi.mock("electron", () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("../../../../electron/services/log-store", () => ({ createMainLogger: () => ({ warn: vi.fn(), info: vi.fn() }) }))
import { shell } from "electron"
import { createGameProtocolHandlers } from "../protocol-handler"
describe("游戏历史深链浏览器交接", () => {
  it("经过权限检查与审计打开同站房间，不创建桌面游戏窗口", async () => {
    const guard = { check: vi.fn().mockResolvedValue({ allowed: true }) }, audit = { record: vi.fn() }
    const registry = { get: vi.fn((id: string) => {
      if (id === "core.permission-guard") return guard
      if (id === "core.audit-sink") return audit
      throw new Error("不应请求桌面窗口服务")
    }) }
    await createGameProtocolHandlers(registry as never)["game-hall.open"]({ entry:"/poker",roomCode:"4821" })
    expect(shell.openExternal).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\/[^/]+\/game\/poker\/4821$/))
    expect(guard.check).toHaveBeenCalledOnce()
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({outcome:"allowed"}))
  })
})
