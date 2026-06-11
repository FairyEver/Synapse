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
  it("blocks opening while migration is active", async () => {
    const service = createKnowledgeBaseSourceManagerWindowService({
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

    service.setMigrationBlocked(true)

    await expect(service.open({ projectId: "kb-1", projectName: "Knowledge" }))
      .rejects.toThrow("知识库存储迁移正在进行。")
  })
})
