import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auditSink: {},
  eventBus: {
    emit: vi.fn(),
  },
  installStatusCacheService: {
    getAll: vi.fn(),
    refresh: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
  },
  permissionGuard: {},
  scanAll: vi.fn(),
  trashScanItem: vi.fn(),
}))

vi.mock("../../../services/install-status-cache-service", () => ({
  installStatusCacheService: mocks.installStatusCacheService,
}))

vi.mock("../../../services/editor-scan-service", () => ({
  scanAll: mocks.scanAll,
  trashScanItem: mocks.trashScanItem,
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

function createContext() {
  return {
    moduleId: "install-status",
    resolve: vi.fn((id: string) => {
      if (id === "core.event-bus") {
        return mocks.eventBus
      }
      if (id === "core.audit-sink") {
        return mocks.auditSink
      }
      if (id === "core.permission-guard") {
        return mocks.permissionGuard
      }
      throw new Error(`Unexpected service id: ${id}`)
    }),
  }
}

describe("installStatusIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.installStatusCacheService.getAll.mockReturnValue({})
    mocks.installStatusCacheService.refresh.mockResolvedValue([{
      editorId: "codex",
      scope: "global",
      status: "not_installed",
    }])
    mocks.scanAll.mockResolvedValue({
      global: [{
        editorId: "codex",
        rules: [],
        skills: [{
          name: "Skill",
          path: "/editor/skills/skill",
          synapseContentId: "skill-1",
          trash: { supported: true },
        }],
      }],
      projects: [],
    })
    mocks.trashScanItem.mockResolvedValue(undefined)
  })

  it("keeps uninstall success when install status refresh fails", async () => {
    const { installStatusIpcModule } = await import("../ipc")
    mocks.installStatusCacheService.refresh.mockRejectedValueOnce(new Error("scan failed"))

    await expect(installStatusIpcModule.methods.uninstall.handler(createContext() as never, {
      contentId: "skill-1",
      editorId: "codex",
    })).resolves.toBeUndefined()

    expect(mocks.trashScanItem).toHaveBeenCalled()
    expect(mocks.installStatusCacheService.refresh).toHaveBeenCalledWith("skill-1")
    expect(mocks.eventBus.emit).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to refresh install status after uninstall.",
      expect.objectContaining({ contentId: "skill-1", editorId: "codex" }),
    )
  })
})
