import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  userDataPath: "",
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => electronMock.userDataPath,
    getAppPath: () => electronMock.userDataPath,
  },
}))

import { configStore } from "../config-store"
import { DEFAULT_DOCK_MIGRATION_IDS } from "../../../src/modules/apps/dock"
import type { SynapseConfigPatch } from "../../../src/types/config"
import { createDefaultConfig } from "../../../src/lib/config"

describe("ConfigStore", () => {
  beforeEach(() => {
    Object.assign(configStore as unknown as {
      cachedConfig: null
      initialized: boolean
      namespace: null
    }, {
      cachedConfig: null,
      initialized: false,
      namespace: null,
    })
  })

  it("keeps the old config and retries when saving the rename fails", async () => {
    const original = createDefaultConfig()
    const legacy = { ...original, global: { ...original.global, dockAppIds: ["mail", "launcher"], dockMigrationIds: ["dock.mail-introduction.v1"] } }
    const setSingleton = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined)
    const namespace = { getSingleton: vi.fn().mockResolvedValue(legacy), setSingleton }
    Object.assign(configStore, { initialized: true, cachedConfig: null, namespace })
    await expect(configStore.load()).rejects.toThrow("disk full")
    expect(legacy.global.dockAppIds).toEqual(["mail", "launcher"])
    expect(legacy.global.dockMigrationIds).toEqual(["dock.mail-introduction.v1"])
    const result = await configStore.load()
    expect(result.global.dockAppIds).toEqual(["mail-internal", "launcher"])
    expect(result.global.dockMigrationIds).toContain("dock.mail-internal-rename.v1")
    expect(setSingleton).toHaveBeenCalledTimes(2)
  })

  it("normalizes existing persisted config before returning it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-store-"))
    electronMock.userDataPath = dir

    try {
      const dataDir = path.join(dir, "data-v1")
      const configPath = path.join(dataDir, "core.config.json")
      await mkdir(dataDir, { recursive: true })
      await writeFile(configPath, JSON.stringify({
        schemaVersion: 1,
        singleton: {
          activeRepoUuid: null,
          repositories: [],
          global: {
            themeMode: "light",
            projects: [],
            favorites: { rule: [], skill: [], prompt: [] },
            recentlyViewed: { rule: [], skill: [], prompt: [] },
            contentSortOrder: "modified-desc",
          },
        },
        items: {},
      }))

      const config = await configStore.load()
      const persisted = JSON.parse(await readFile(configPath, "utf8")) as {
        singleton?: { agent?: { defaultPermissionMode?: string } }
      }

      expect(config.agent.defaultPermissionMode).toBe("default")
      expect(persisted.singleton?.agent?.defaultPermissionMode).toBe("default")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("applies pending Dock migrations once and keeps user removals", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-store-dock-migration-"))
    electronMock.userDataPath = dir

    try {
      const dataDir = path.join(dir, "data-v1")
      const configPath = path.join(dataDir, "core.config.json")
      await mkdir(dataDir, { recursive: true })
      await writeFile(configPath, JSON.stringify({
        schemaVersion: 1,
        singleton: {
          activeRepoUuid: null,
          repositories: [],
          global: {
            themeMode: "light",
            projects: [],
            dockAppIds: ["agent", "launcher"],
          },
        },
        items: {},
      }))

      const migrated = await configStore.load()
      expect(migrated.global.dockAppIds).toEqual(["agent", "mail-internal", "launcher"])
      expect(migrated.global.dockMigrationIds).toEqual([...DEFAULT_DOCK_MIGRATION_IDS])

      await configStore.update({ global: { dockAppIds: ["agent", "launcher"] } })

      const afterRemoval = await configStore.load()
      expect(afterRemoval.global.dockAppIds).toEqual(["agent", "launcher"])
      expect(afterRemoval.global.dockMigrationIds).toEqual([...DEFAULT_DOCK_MIGRATION_IDS])

      const unsafePatch = { global: { dockMigrationIds: [] } } as unknown as SynapseConfigPatch
      await configStore.update(unsafePatch)

      const afterUnsafePatch = await configStore.load()
      expect(afterUnsafePatch.global.dockAppIds).toEqual(["agent", "launcher"])
      expect(afterUnsafePatch.global.dockMigrationIds).toEqual([...DEFAULT_DOCK_MIGRATION_IDS])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("backs up malformed core config JSON and persists defaults", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "synapse-config-store-"))
    electronMock.userDataPath = dir

    try {
      const dataDir = path.join(dir, "data-v1")
      const configPath = path.join(dataDir, "core.config.json")
      await mkdir(dataDir, { recursive: true })
      await writeFile(configPath, "{ bad json", "utf8")

      const config = await configStore.load()
      const persisted = JSON.parse(await readFile(configPath, "utf8")) as {
        singleton?: { agent?: { defaultPermissionMode?: string } }
      }

      expect(config.agent.defaultPermissionMode).toBe("default")
      expect(persisted.singleton?.agent?.defaultPermissionMode).toBe("default")
      const entries = await readdir(dataDir)
      expect(entries.some((entry) => /^core\.config\.invalid-.*\.json$/.test(entry))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
