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
