import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseConfig } from "../../../src/types/config"
import { createDefaultConfig } from "../../../src/lib/config"

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
import { configBackupService, createConfigBackupPayload } from "../config-backup-service"
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
  })

  it("preserves valid multi-line quick inputs when importing a backup", async () => {
    const filePath = await writeBackupFile({
      quickInputs: [{ id: "quick-1", content: "第一行\n第二行" }],
    })

    try {
      await configBackupService.readImport(filePath)

      expect(configStore.replace).toHaveBeenCalledWith(expect.objectContaining({
        global: expect.objectContaining({
          quickInputs: [{ id: "quick-1", content: "第一行\n第二行" }],
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

  it("preserves configured quick inputs in export payloads", async () => {
    const config: SynapseConfig = {
      ...createDefaultConfig(),
      global: {
        ...createDefaultConfig().global,
        quickInputs: [{ id: "quick-1", content: "第一行\n第二行" }],
      },
    }
    vi.mocked(configStore.load).mockResolvedValue(config)

    const backup = await createConfigBackupPayload(new Date("2026-05-25T00:00:00.000Z"))

    expect(backup.config.global.quickInputs).toEqual([
      { id: "quick-1", content: "第一行\n第二行" },
    ])
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
  options: { includeQuickInputs?: boolean } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-backup-"))
  const filePath = path.join(dir, "backup.json")
  await writeFile(filePath, JSON.stringify(createBackup(globalOverrides, options)), "utf8")
  return filePath
}

function createBackup(
  globalOverrides: Record<string, unknown>,
  options: { includeQuickInputs?: boolean },
): Record<string, unknown> {
  const globalConfig: Record<string, unknown> = {
    themeMode: "light",
    projects: [],
    favorites: { rule: [], skill: [], prompt: [] },
    recentlyViewed: { rule: [], skill: [], prompt: [] },
    contentSortOrder: "modified-desc",
    ...globalOverrides,
  }

  if (options.includeQuickInputs !== false && !("quickInputs" in globalConfig)) {
    globalConfig.quickInputs = []
  }

  return {
    schemaVersion: 1,
    exportedAt: "2026-05-25T00:00:00.000Z",
    config: {
      activeRepoUuid: null,
      repositories: [],
      global: globalConfig,
    },
    identity: createIdentity(),
  }
}
