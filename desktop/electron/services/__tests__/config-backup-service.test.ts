import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { dialog } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CONFIG_BACKUP_IMPORT_MAX_BYTES } from "../../../config"
import type { SynapseConfig } from "../../../src/types/config"
import { createDefaultConfig } from "../../../src/lib/config"
import { SYNAPSE_APP_VERSION } from "../../../src/lib/app-version"

const mocks = vi.hoisted(() => ({
  configStore: {
    load: vi.fn(),
    replace: vi.fn(),
  },
  identity: {
    exportIdentity: vi.fn(),
    importIdentity: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}))

vi.mock("../config-store", () => ({
  configStore: mocks.configStore,
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

vi.mock("../user-identity-service", () => ({
  normalizeUserId: (value: string) => (/^[0-9a-f]{32}$/i.test(value) ? value.toLowerCase() : null),
  userIdentityService: mocks.identity,
}))

import { configStore } from "../config-store"
import {
  configBackupService,
  createConfigBackupPayload,
  setConfigBackupDataRepository,
} from "../config-backup-service"
import { userIdentityService } from "../user-identity-service"

describe("ConfigBackupService quick inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(configStore.load).mockResolvedValue(createDefaultConfig())
    vi.mocked(configStore.replace).mockResolvedValue(createDefaultConfig())
    vi.mocked(userIdentityService.exportIdentity).mockResolvedValue(createIdentity())
    vi.mocked(userIdentityService.importIdentity).mockResolvedValue({
      status: "ready",
      identity: createIdentity(),
    })
    setConfigBackupDataRepository(null)
  })

  it("preserves valid multi-line quick inputs when importing a backup", async () => {
    const filePath = await writeBackupFile({
      quickInputs: [{ id: "quick-1", content: "第一行\n第二行", directSend: true }],
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        global: expect.objectContaining({
          quickInputs: [{ id: "quick-1", content: "第一行\n第二行", directSend: true }],
        }),
      }))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("imports legacy backups without quick inputs as an empty list", async () => {
    const filePath = await writeBackupFile({}, { includeQuickInputs: false })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        global: expect.objectContaining({
          quickInputs: [],
        }),
      }))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("imports legacy quick inputs without direct send as insert snippets", async () => {
    const filePath = await writeBackupFile({
      quickInputs: [{ id: "quick-1", content: "第一行\n第二行" }],
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        global: expect.objectContaining({
          quickInputs: [{ id: "quick-1", content: "第一行\n第二行", directSend: false }],
        }),
      }))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("keeps the current machine knowledge base storage root when importing a backup", async () => {
    const currentConfig: SynapseConfig = {
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        knowledgeBaseStorage: { mode: "custom", rootPath: "/current-machine/kb-root" },
      },
    }
    vi.mocked(configStore.load).mockResolvedValue(currentConfig)
    const filePath = await writeBackupFile({
      knowledgeBaseStorage: { mode: "custom", rootPath: "/backup-machine/kb-root" },
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        global: expect.objectContaining({
          knowledgeBaseStorage: { mode: "custom", rootPath: "/current-machine/kb-root" },
        }),
      }))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("keeps current same-name variable values when importing a redacted backup", async () => {
    const currentConfig: SynapseConfig = {
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        variables: [
          { name: "API_TOKEN", value: "sk-current-token", description: "Current token" },
          { name: "EMPTY_VALUE", value: "", description: "Already empty" },
        ],
      },
    }
    vi.mocked(configStore.load).mockResolvedValue(currentConfig)
    const filePath = await writeBackupFile({
      variables: [
        { name: "API_TOKEN", value: "", description: "Backup token" },
        { name: "BACKUP_VALUE", value: "from-backup", description: "Backup value" },
        { name: "EMPTY_VALUE", value: "", description: "Backup empty" },
      ],
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        global: expect.objectContaining({
          variables: [
            { name: "API_TOKEN", value: "sk-current-token", description: "Backup token" },
            { name: "BACKUP_VALUE", value: "from-backup", description: "Backup value" },
            { name: "EMPTY_VALUE", value: "", description: "Backup empty" },
          ],
        }),
      }))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("migrates legacy repository variables and preserves custom directories global lists sort order and agent defaults when importing a backup", async () => {
    const filePath = await writeBackupFile({
      favorites: { rule: ["rule-1"], skill: ["skill-1"], prompt: ["prompt-1"] },
      recentlyViewed: { rule: ["rule-2"], skill: ["skill-2"], prompt: ["prompt-2"] },
      contentSortOrder: "name-asc",
      defaultQuickInputsSeededVersion: "0.2.238",
    }, {
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo",
        localPath: "/repo",
        contentDirs: { rule: "rules", skill: "skills", prompt: "prompts" },
        rulesDir: "custom-rules",
        skillsDir: "custom-skills",
        variables: [{ name: "API_HOST", value: "https://example.test", description: "API" }],
      }],
      agent: {
        defaultPermissionMode: "bypassPermissions",
        defaultProviderModel: { providerId: "provider-1", modelTier: "sonnet" },
        conversationRolloverPrompt: {
          costThresholdCny: 18,
          tokenThreshold: 6_000_000,
        },
      },
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        activeRepoUuid: "repo-1",
        repositories: [expect.objectContaining({
          uuid: "repo-1",
          rulesDir: "custom-rules",
          skillsDir: "custom-skills",
        })],
        global: expect.objectContaining({
          variables: [{ name: "API_HOST", value: "https://example.test", description: "API" }],
          favorites: { rule: ["rule-1"], skill: ["skill-1"], prompt: ["prompt-1"] },
          recentlyViewed: { rule: ["rule-2"], skill: ["skill-2"], prompt: ["prompt-2"] },
          contentSortOrder: "name-asc",
          defaultQuickInputsSeededVersion: "0.2.238",
        }),
      agent: {
        defaultPermissionMode: "bypassPermissions",
        defaultProviderModel: { providerId: "provider-1", modelTier: "sonnet" },
      },
    }))
      const importedConfig = vi.mocked(configStore.replace).mock.calls[0]?.[0] as SynapseConfig | undefined
      expect(importedConfig?.repositories[0]).not.toHaveProperty("variables")
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("rejects malformed quick inputs when importing a backup", async () => {
    const filePath = await writeBackupFile({
      quickInputs: [{ id: "quick-1", content: "   " }],
    })

    try {
      await expect(configBackupService.readImport(filePath)).rejects.toThrow(
        "config.global.quickInputs[0].content 必须是非空字符串。",
      )
      expect(configStore.replace).not.toHaveBeenCalled()
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("rejects malformed quick input seed versions when importing a backup", async () => {
    const filePath = await writeBackupFile({
      defaultQuickInputsSeededVersion: 123,
    })

    try {
      await expect(configBackupService.readImport(filePath)).rejects.toThrow(
        "config.global.defaultQuickInputsSeededVersion 必须是字符串或 null。",
      )
      expect(configStore.replace).not.toHaveBeenCalled()
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("ignores legacy Agent conversation rollover prompt thresholds when importing a backup", async () => {
    const filePath = await writeBackupFile({}, {
      agent: {
        defaultPermissionMode: "default",
        defaultProviderModel: null,
        conversationRolloverPrompt: {
          costThresholdCny: 12.5,
          tokenThreshold: 8_000_000,
        },
      },
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        agent: {
          defaultPermissionMode: "default",
          defaultProviderModel: null,
        },
      }))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("does not reject invalid legacy Agent conversation rollover prompt thresholds when importing a backup", async () => {
    const filePath = await writeBackupFile({}, {
      agent: {
        defaultPermissionMode: "default",
        defaultProviderModel: null,
        conversationRolloverPrompt: {
          costThresholdCny: -1,
          tokenThreshold: 1.5,
        },
      },
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        agent: {
          defaultPermissionMode: "default",
          defaultProviderModel: null,
        },
      }))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("rejects oversized imports before replacing config or identity", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-backup-large-"))
    const filePath = path.join(dir, "backup.json")
    await writeFile(filePath, "{", "utf8")
    await truncate(filePath, CONFIG_BACKUP_IMPORT_MAX_BYTES + 1)

    try {
      await expect(configBackupService.readImport(filePath)).rejects.toThrow("备份文件超过")

      expect(configStore.replace).not.toHaveBeenCalled()
      expect(userIdentityService.importIdentity).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("preserves configured quick inputs in export payloads", async () => {
    const config: SynapseConfig = {
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        quickInputs: [{ id: "quick-1", content: "第一行\n第二行", directSend: true }],
      },
    }
    vi.mocked(configStore.load).mockResolvedValue(config)

    const backup = await createConfigBackupPayload(new Date("2026-05-25T00:00:00.000Z"))

    expect(backup.config.global.quickInputs).toEqual([
      { id: "quick-1", content: "第一行\n第二行", directSend: true },
    ])
    expect(backup.config.global.defaultQuickInputsSeededVersion).toBe(SYNAPSE_APP_VERSION)
  })

  it("exports DataRepository namespaces without secret values", async () => {
    const exportAll = vi.fn(async (options?: { includeSecrets?: boolean }) => ({
      format: "synapse-backup-v1" as const,
      exportedAt: "2026-06-25T00:00:00.000Z",
      namespaces: [
        {
          name: "app.quick-input.items",
          schemaVersion: 1,
          encrypted: false,
          data: {
            items: [{
              id: "quick-1",
              schemaVersion: 1,
              content: "快捷输入",
              sortOrder: 10,
              createdAt: "2026-06-25T00:00:00.000Z",
              updatedAt: "2026-06-25T00:00:00.000Z",
            }],
          },
        },
        {
          name: "app.secrets.items",
          schemaVersion: 1,
          encrypted: true,
          data: options?.includeSecrets === true
            ? {
                items: [{
                  id: "secret-1",
                  schemaVersion: 1,
                  name: "API_TOKEN",
                  value: "sk-secret-value",
                  description: "api",
                  createdAt: "2026-07-09T00:00:00.000Z",
                  updatedAt: "2026-07-09T00:00:00.000Z",
                }],
              }
            : null,
        },
      ],
    }))
    setConfigBackupDataRepository({
      exportAll,
      importAll: vi.fn(async () => undefined),
    })

    const backup = await createConfigBackupPayload(new Date("2026-06-25T00:00:00.000Z"))

    expect(exportAll).toHaveBeenCalledWith({ includeSecrets: false })
    expect(backup.dataRepository?.namespaces.map((namespace) => namespace.name))
      .toContain("app.quick-input.items")
    expect(backup.dataRepository?.namespaces.map((namespace) => namespace.name))
      .toContain("app.secrets.items")
    expect(backup.dataRepository?.namespaces.find((namespace) => namespace.name === "app.secrets.items"))
      .toMatchObject({ encrypted: true, data: null })
    expect(JSON.stringify(backup)).not.toContain("sk-secret-value")
  })

  it("imports DataRepository payloads from backups", async () => {
    const importAll = vi.fn(async () => undefined)
    setConfigBackupDataRepository({
      exportAll: vi.fn(async () => ({ format: "synapse-backup-v1" as const, exportedAt: new Date().toISOString(), namespaces: [] })),
      importAll,
    })
    const dataRepository = {
      format: "synapse-backup-v1" as const,
      exportedAt: "2026-06-25T00:00:00.000Z",
      namespaces: [{
        name: "app.quick-input.items",
        schemaVersion: 1,
        encrypted: false,
        data: {
          items: [{
            id: "quick-1",
            schemaVersion: 1,
            content: "快捷输入",
            sortOrder: 10,
            createdAt: "2026-06-25T00:00:00.000Z",
            updatedAt: "2026-06-25T00:00:00.000Z",
          }],
        },
      }],
    }
    const filePath = await writeBackupFile({}, { dataRepository })

    try {
      await configBackupService.readImport(filePath)

      expect(importAll).toHaveBeenCalledWith(dataRepository)
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("preserves user variable definitions without exporting secret values", async () => {
    const repository = {
      uuid: "repo-1",
      name: "Repo",
      localPath: "/repo",
      contentDirs: { rule: "rules", skill: "skills", prompt: "prompts" },
      rulesDir: "custom-rules",
      skillsDir: "custom-skills",
    }
    const config: SynapseConfig = {
      ...createDefaultConfig(),
      activeRepoUuid: "repo-1",
      repositories: [repository],
      global: {
        ...createDefaultConfig().global,
        variables: [{ name: "API_HOST", value: "sk-secret-host", description: "API" }],
      },
    }
    vi.mocked(configStore.load).mockResolvedValue(config)

    const backup = await createConfigBackupPayload(new Date("2026-05-25T00:00:00.000Z"))

    expect(backup.config.repositories).toEqual([repository])
    expect(backup.config.global.variables).toEqual([
      { name: "API_HOST", value: "", description: "API" },
    ])
    expect(JSON.stringify(backup)).not.toContain("sk-secret-host")
  })

  it("redacts selected backup paths in import and export logs", async () => {
    const exportDir = await mkdtemp(path.join(tmpdir(), "synapse-config-backup-export-"))
    const exportPath = path.join(exportDir, "private-backup.json")
    const importPath = await writeBackupFile({})

    try {
      await configBackupService.writeExport(exportPath)
      await configBackupService.readImport(importPath)

      expect(mocks.logger.info).toHaveBeenCalledWith("Config backup exported.", { filePath: "[path]" })
      expect(mocks.logger.info).toHaveBeenCalledWith("Config backup imported.", { filePath: "[path]" })
      expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(exportDir)
      expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(path.dirname(importPath))
    } finally {
      await rm(exportDir, { recursive: true, force: true })
      await rm(path.dirname(importPath), { recursive: true, force: true })
    }
  })

  it("redacts selected backup paths in rollback logs", async () => {
    const filePath = await writeBackupFile({})
    vi.mocked(userIdentityService.importIdentity).mockRejectedValueOnce(new Error("identity failed"))

    try {
      await expect(configBackupService.readImport(filePath)).rejects.toThrow("identity failed")

      expect(mocks.logger.warn).toHaveBeenCalledWith("Identity import failed, rolling back config.", { filePath: "[path]" })
      expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain(path.dirname(filePath))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("surfaces and logs rollback failures after identity import fails", async () => {
    const filePath = await writeBackupFile({})
    vi.mocked(userIdentityService.importIdentity).mockRejectedValueOnce(new Error("identity failed"))
    vi.mocked(configStore.replace)
      .mockResolvedValueOnce(createDefaultConfig())
      .mockRejectedValueOnce(new Error("rollback failed"))

    try {
      await expect(configBackupService.readImport(filePath)).rejects.toThrow("旧配置恢复也失败")

      expect(mocks.logger.warn).toHaveBeenCalledWith("Identity import failed, rolling back config.", { filePath: "[path]" })
      expect(mocks.logger.error).toHaveBeenCalledWith("Config backup import rollback failed.", expect.objectContaining({
        filePath: "[path]",
        identityErrorName: "Error",
        rollbackErrorName: "Error",
      }))
      expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(path.dirname(filePath))
    } finally {
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })

  it("imports dialog-selected backups through readImport", async () => {
    const filePath = await writeBackupFile({})
    const readImportSpy = vi.spyOn(configBackupService, "readImport")
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [filePath],
    } as Electron.OpenDialogReturnValue)

    try {
      await expect(configBackupService.importBackup()).resolves.toEqual({ filePath })

      expect(readImportSpy).toHaveBeenCalledTimes(1)
      expect(readImportSpy).toHaveBeenCalledWith(filePath)
    } finally {
      readImportSpy.mockRestore()
      await rm(path.dirname(filePath), { recursive: true, force: true })
    }
  })
})

function createIdentity() {
  return {
    schemaVersion: 2 as const,
    userId: "0123456789abcdef0123456789abcdef",
    generatedAt: "2026-05-25T00:00:00.000Z",
  }
}

async function writeBackupFile(
  globalOverrides: Record<string, unknown>,
  options: {
    includeQuickInputs?: boolean
    activeRepoUuid?: unknown
    repositories?: unknown[]
    agent?: unknown
    dataRepository?: unknown
  } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-backup-"))
  const filePath = path.join(dir, "backup.json")
  await writeFile(filePath, JSON.stringify(createBackup(globalOverrides, options)), "utf8")
  return filePath
}

function createBackup(
  globalOverrides: Record<string, unknown>,
  options: {
    includeQuickInputs?: boolean
    activeRepoUuid?: unknown
    repositories?: unknown[]
    agent?: unknown
    dataRepository?: unknown
  },
): Record<string, unknown> {
  const globalConfig: Record<string, unknown> = {
    themeMode: "light",
    projects: [],
    favorites: { rule: [], skill: [], prompt: [] },
    recentlyViewed: { rule: [], skill: [], prompt: [] },
    contentSortOrder: "modified-desc",
    defaultQuickInputsSeededVersion: null,
    ...globalOverrides,
  }

  if (options.includeQuickInputs !== false && !("quickInputs" in globalConfig)) {
    globalConfig.quickInputs = []
  }

  return {
    schemaVersion: 1,
    exportedAt: "2026-05-25T00:00:00.000Z",
    config: {
      activeRepoUuid: options.activeRepoUuid ?? null,
      repositories: options.repositories ?? [],
      global: globalConfig,
      ...(options.agent !== undefined ? { agent: options.agent } : undefined),
    },
    identity: createIdentity(),
    ...(options.dataRepository !== undefined ? { dataRepository: options.dataRepository } : undefined),
  }
}
