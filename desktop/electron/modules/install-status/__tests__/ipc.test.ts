import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auditSink: {},
  eventBus: {
    emit: vi.fn(),
  },
  installStatusCacheService: {
    getAll: vi.fn(),
    removeGlobalEntry: vi.fn(),
    refreshGlobal: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
  },
  permissionGuard: {},
  scanGlobalEditorById: vi.fn(),
  skillUninstallerService: {
    uninstall: vi.fn(),
  },
  trashScanItem: vi.fn(),
}))

vi.mock("../../../../app-capabilities/skill-uninstaller/main/service", () => ({
  skillUninstallerService: mocks.skillUninstallerService,
}))

vi.mock("../../../services/install-status-cache-service", () => ({
  installStatusCacheService: mocks.installStatusCacheService,
}))

vi.mock("../../../services/editor-scan-service", () => ({
  scanGlobalEditorById: mocks.scanGlobalEditorById,
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
    mocks.installStatusCacheService.removeGlobalEntry.mockReturnValue([])
    mocks.installStatusCacheService.refreshGlobal.mockResolvedValue([{
      editorId: "codex",
      scope: "global",
      status: "not_installed",
    }])
    mocks.scanGlobalEditorById.mockResolvedValue({
      editorId: "codex",
      rules: [],
      skills: [{
        name: "Skill",
        path: "/editor/skills/skill",
        synapseContentId: "skill-1",
        trash: { supported: true },
      }],
    })
    mocks.skillUninstallerService.uninstall.mockImplementation(async (
      _targets: unknown,
      _security: unknown,
      hooks: { onTrashedContentId?: (contentId: string) => Promise<void> },
    ) => {
      try {
        await hooks.onTrashedContentId?.("skill-1")
        return { results: [{ path: "/editor/skills/skill", status: "trashed" }] }
      } catch {
        return {
          results: [{
            path: "/editor/skills/skill",
            status: "trashed",
            warning: "已移到废纸篓，安装状态刷新失败。",
          }],
        }
      }
    })
    mocks.trashScanItem.mockResolvedValue(undefined)
  })

  it("routes Skill uninstall through the shared Skill Uninstaller service", async () => {
    const { installStatusIpcModule } = await import("../ipc")
    mocks.installStatusCacheService.refreshGlobal.mockRejectedValueOnce(new Error("scan failed"))

    await expect(installStatusIpcModule.methods.uninstall.handler(createContext() as never, {
      contentId: "skill-1",
      editorId: "codex",
    })).resolves.toEqual({ warning: "已移到废纸篓，安装状态刷新失败。" })

    expect(mocks.skillUninstallerService.uninstall).toHaveBeenCalledWith(
      [{ path: "/editor/skills/skill", query: { name: "Skill" } }],
      {
        actor: { kind: "user" },
        auditSink: mocks.auditSink,
        permissionGuard: mocks.permissionGuard,
      },
      { onTrashedContentId: expect.any(Function) },
    )
    expect(mocks.trashScanItem).not.toHaveBeenCalled()
    expect(mocks.scanGlobalEditorById).toHaveBeenCalledWith("codex")
    expect(mocks.installStatusCacheService.refreshGlobal).toHaveBeenCalledWith("skill-1", "codex")
    expect(mocks.installStatusCacheService.removeGlobalEntry).toHaveBeenCalledWith("skill-1", "codex")
    expect(mocks.eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "install-status",
      type: "install-status.changed",
      payload: { contentId: "skill-1", entries: [] },
    }))
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Failed to refresh install status after uninstall.",
      expect.objectContaining({ contentId: "skill-1", editorId: "codex" }),
    )
  })

  it("keeps Rule uninstall on the editor scan trash path", async () => {
    const { installStatusIpcModule } = await import("../ipc")
    mocks.scanGlobalEditorById.mockResolvedValueOnce({
      editorId: "codex",
      rules: [{
        name: "Rule",
        path: "/editor/AGENTS.md",
        synapseContentId: "rule-1",
        trash: { mode: "rule-section", ruleId: "rule-1" },
      }],
      skills: [],
    })

    await installStatusIpcModule.methods.uninstall.handler(createContext() as never, {
      contentId: "rule-1",
      editorId: "codex",
    })

    expect(mocks.skillUninstallerService.uninstall).not.toHaveBeenCalled()
    expect(mocks.trashScanItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemType: "rule", itemPath: "/editor/AGENTS.md" }),
      expect.objectContaining({ actor: { kind: "user" } }),
    )
  })
})
