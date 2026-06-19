import { describe, expect, it, vi } from "vitest"
import { createKnowledgeBaseSourceManagerWindowService } from "../source-manager-window-service"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe("createKnowledgeBaseSourceManagerWindowService", () => {
  function createService() {
    return createKnowledgeBaseSourceManagerWindowService({
      createWindow: vi.fn(),
      createHealthService: vi.fn(),
      getAppPath: () => "/app",
      getIconPath: () => null,
      getPreloadPath: () => "/preload.js",
      logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    } as never)
  }

  it("blocks opening while migration is active", async () => {
    const service = createService()

    service.setMigrationBlocked(true)

    await expect(service.open({ projectId: "kb-1", projectName: "Knowledge" }))
      .rejects.toThrow("知识库存储迁移正在进行。")
  })

  it("reports active mutations until the tracked operation settles", async () => {
    const service = createService()
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })

    const operation = service.trackMutation(async () => {
      await pending
      return "done"
    })

    expect(service.hasActiveMutation()).toBe(true)

    finish()

    await expect(operation).resolves.toBe("done")
    expect(service.hasActiveMutation()).toBe(false)
  })
})
