import { describe, expect, it, vi } from "vitest"
import { createCcConversationWindowService } from "../usage-analysis/cc-conversation-window-service"

vi.mock("../log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

describe("createCcConversationWindowService", () => {
  it("opens one window per session and focuses duplicates", async () => {
    const webContents = { on: vi.fn() }
    const window = {
      webContents,
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      once: vi.fn(),
      on: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
    }
    const createWindow = vi.fn(() => window as never)
    const loadWindow = vi.fn(async () => undefined)
    const service = createCcConversationWindowService({
      createWindow,
      createHealthService: vi.fn(() => ({ attach: vi.fn(), detach: vi.fn() })),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      loadWindow,
    })

    await service.openConversationWindow({ sessionId: "s1", title: "对话" })
    await service.openConversationWindow({ sessionId: "s1", title: "对话" })

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(loadWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
