import { describe, expect, it } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  JsonNamespace,
  JsonLinesNamespace,
  NamespaceNotFoundError,
  coreConfigSchema,
  createDataRepository,
  type CoreConfigV1,
  type DataNamespace,
} from "../index"

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-repo-"))

describe("DataRepositoryImpl (T2.13)", () => {
  it("namespace() throws NamespaceNotFoundError for unregistered names", () => {
    const repo = createDataRepository()
    expect(() => repo.namespace("ghost")).toThrowError(NamespaceNotFoundError)
  })

  it("namespace() returns the registered handle", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
      })
      repo.register(coreConfigSchema, handle)
      expect(repo.namespace("core.config")).toBe(handle)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("inspect() lists every registered namespace with schemaVersion + backend", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
      })
      repo.register(coreConfigSchema, handle)
      const summary = repo.inspect()
      expect(summary).toHaveLength(1)
      expect(summary[0]).toEqual({
        namespace: "core.config",
        backend: "json",
        schemaVersion: 1,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("exportAll() returns synapse-backup-v1 with singleton + items per namespace", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
      })
      repo.register(coreConfigSchema, handle)
      await handle.setSingleton({
        schemaVersion: 1,
        activeRepoUuid: "abc",
        repositories: [],
        global: {},
      })

      const payload = await repo.exportAll()
      expect(payload.format).toBe("synapse-backup-v1")
      expect(typeof payload.exportedAt).toBe("string")
      expect(payload.namespaces).toHaveLength(1)
      expect(payload.namespaces[0]?.name).toBe("core.config")
      expect(payload.namespaces[0]?.schemaVersion).toBe(1)
      expect(payload.namespaces[0]?.encrypted).toBe(false)
      const data = payload.namespaces[0]?.data as { singleton?: CoreConfigV1; items?: unknown[] }
      expect(data.singleton?.activeRepoUuid).toBe("abc")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("skips excluded namespaces before reading their service-owned files", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const filePath = path.join(dir, "core.config.json")
      await writeFile(filePath, JSON.stringify({
        schemaVersion: 1,
        singleton: {
          activeRepoUuid: null,
          repositories: [],
          global: {},
        },
        items: {},
      }), "utf8")
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath,
        validate: coreConfigSchema.validate,
      })
      repo.register(coreConfigSchema, handle)

      await expect(repo.exportAll({ excludeNamespaces: ["core.config"] }))
        .resolves.toMatchObject({ namespaces: [] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("exports empty namespace entries without reading omitted backup bodies", async () => {
    const failRead = async (): Promise<never> => {
      throw new Error("namespace body should not be read")
    }
    const repo = createDataRepository()
    const handle: DataNamespace<CoreConfigV1> = {
      name: coreConfigSchema.name,
      schemaVersion: coreConfigSchema.currentVersion,
      backend: "json",
      getSingleton: failRead,
      setSingleton: async () => {},
      list: failRead,
      get: failRead,
      upsert: async () => {},
      remove: async () => {},
      onChange: () => () => {},
    }
    repo.register(coreConfigSchema, handle)

    await expect(repo.exportAll({ emptyNamespaces: ["core.config"] }))
      .resolves.toMatchObject({
        namespaces: [{
          name: "core.config",
          schemaVersion: 1,
          encrypted: false,
          data: { items: [] },
        }],
      })
  })

  it("exportAll() omits encrypted namespace data unless includeSecrets is true", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
      })
      repo.register(coreConfigSchema, handle)

      // Synthetic encrypted-flagged schema for this test.
      const fakeSecretsSchema = {
        name: "secrets",
        backend: "encrypted-json" as const,
        currentVersion: 1,
        migrations: [],
        encrypted: true,
        validate: (v: unknown): v is { id: string } & Record<string, unknown> =>
          typeof v === "object" && v !== null && typeof (v as { id?: string }).id === "string",
      }
      const secretsHandle = new JsonNamespace<{ id: string } & Record<string, unknown>>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: path.join(dir, "secrets.bin"),
      })
      repo.register(fakeSecretsSchema, secretsHandle)

      const payload = await repo.exportAll()
      const secretsEntry = payload.namespaces.find((n) => n.name === "secrets")
      expect(secretsEntry?.encrypted).toBe(true)
      expect(secretsEntry?.data).toBeNull()

      const payloadWithSecrets = await repo.exportAll({ includeSecrets: true })
      const includedSecrets = payloadWithSecrets.namespaces.find((n) => n.name === "secrets")
      expect(includedSecrets?.encrypted).toBe(true)
      expect(includedSecrets?.data).not.toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("importAll(payload) replaces namespace contents (default mode)", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
      })
      repo.register(coreConfigSchema, handle)
      await handle.setSingleton({
        schemaVersion: 1,
        activeRepoUuid: "old",
        repositories: [],
        global: {},
      })

      await repo.importAll({
        format: "synapse-backup-v1",
        exportedAt: "2026-04-25T00:00:00Z",
        namespaces: [
          {
            name: "core.config",
            schemaVersion: 1,
            encrypted: false,
            data: {
              singleton: {
                schemaVersion: 1,
                activeRepoUuid: "new",
                repositories: [],
                global: { theme: "dark" },
              },
              items: [],
            },
          },
        ],
      })

      const result = await handle.getSingleton()
      expect(result?.activeRepoUuid).toBe("new")
      expect(result?.global).toEqual({ theme: "dark" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("importAll() replace mode clears an existing singleton when the backup omits it", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
      })
      repo.register(coreConfigSchema, handle)
      await handle.setSingleton({
        schemaVersion: 1,
        activeRepoUuid: "old",
        repositories: [],
        global: {},
      })

      await repo.importAll({
        format: "synapse-backup-v1",
        exportedAt: "2026-04-25T00:00:00Z",
        namespaces: [
          {
            name: "core.config",
            schemaVersion: 1,
            encrypted: false,
            data: {
              items: [],
            },
          },
        ],
      })

      await expect(handle.getSingleton()).resolves.toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("importAll() merge mode keeps existing items intact", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const fakeSchema = {
        name: "projects",
        backend: "json" as const,
        currentVersion: 1,
        migrations: [],
        validate: (v: unknown): v is { id: string } & Record<string, unknown> =>
          typeof v === "object" && v !== null && typeof (v as { id?: string }).id === "string",
      }
      const handle = new JsonNamespace<{ id: string } & Record<string, unknown>>({
        name: "projects",
        schemaVersion: 1,
        backend: "json",
        filePath: path.join(dir, "projects.json"),
      })
      repo.register(fakeSchema, handle)
      await handle.upsert({ id: "p1", name: "old-project" })

      await repo.importAll(
        {
          format: "synapse-backup-v1",
          exportedAt: "2026-04-25T00:00:00Z",
          namespaces: [
            {
              name: "projects",
              schemaVersion: 1,
              encrypted: false,
              data: {
                items: [{ id: "p2", name: "imported-project" }],
              },
            },
          ],
        },
        { merge: true },
      )

      const list = await handle.list()
      expect(list.map((p) => p.id).sort()).toEqual(["p1", "p2"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("importAll() replace mode rewrites removable JSONL namespaces", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const fakeSchema = {
        name: "outbox",
        backend: "jsonl" as const,
        currentVersion: 1,
        migrations: [],
        validate: (v: unknown): v is { id: string; name: string } & Record<string, unknown> =>
          typeof v === "object"
          && v !== null
          && typeof (v as { id?: string }).id === "string"
          && typeof (v as { name?: string }).name === "string",
      }
      const filePath = path.join(dir, "outbox.jsonl")
      const handle = new JsonLinesNamespace<{ id: string; name: string } & Record<string, unknown>>({
        name: "outbox",
        schemaVersion: 1,
        backend: "jsonl",
        filePath,
        allowRemove: true,
        validate: fakeSchema.validate,
      })
      repo.register(fakeSchema, handle)
      await handle.upsert({ id: "p1", name: "old-project" })
      await handle.upsert({ id: "p2", name: "stale-project" })

      await repo.importAll({
        format: "synapse-backup-v1",
        exportedAt: "2026-04-25T00:00:00Z",
        namespaces: [{
          name: "outbox",
          schemaVersion: 1,
          encrypted: false,
          data: {
            items: [{ id: "p1", name: "imported-project" }],
          },
        }],
      })

      expect(await handle.list()).toEqual([{ id: "p1", name: "imported-project" }])
      const lines = (await readFile(filePath, "utf8")).trim().split("\n")
      expect(lines).toHaveLength(2)
      expect(lines[1]).toContain("imported-project")
      expect(lines.join("\n")).not.toContain("stale-project")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("importAll() replace mode rejects append-only JSONL namespaces", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const fakeSchema = {
        name: "audit",
        backend: "jsonl" as const,
        currentVersion: 1,
        migrations: [],
        validate: (v: unknown): v is { id: string; action: string } & Record<string, unknown> =>
          typeof v === "object"
          && v !== null
          && typeof (v as { id?: string }).id === "string"
          && typeof (v as { action?: string }).action === "string",
      }
      const handle = new JsonLinesNamespace<{ id: string; action: string } & Record<string, unknown>>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: path.join(dir, "audit.jsonl"),
        validate: fakeSchema.validate,
      })
      repo.register(fakeSchema, handle)
      await handle.upsert({ id: "e1", action: "old" })

      await expect(repo.importAll({
        format: "synapse-backup-v1",
        exportedAt: "2026-04-25T00:00:00Z",
        namespaces: [{
          name: "audit",
          schemaVersion: 1,
          encrypted: false,
          data: {
            items: [{ id: "e2", action: "imported" }],
          },
        }],
      })).rejects.toThrow(/remove is not supported/)

      expect(await handle.list()).toEqual([{ id: "e1", action: "old" }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("importAll() restores removed items when replace deletion fails midway", async () => {
    type TestItem = { id: string; name: string }
    const repo = createDataRepository()
    const fakeSchema = {
      name: "replace-test",
      backend: "json" as const,
      currentVersion: 1,
      migrations: [],
      validate: (v: unknown): v is TestItem =>
        typeof v === "object"
        && v !== null
        && typeof (v as { id?: string }).id === "string"
        && typeof (v as { name?: string }).name === "string",
    }
    const handle = createMidwayRemoveFailureHandle<TestItem>([
      { id: "old-1", name: "Old 1" },
      { id: "old-2", name: "Old 2" },
    ], "old-2")
    repo.register(fakeSchema, handle)

    await expect(repo.importAll({
      format: "synapse-backup-v1",
      exportedAt: "2026-04-25T00:00:00Z",
      namespaces: [{
        name: "replace-test",
        schemaVersion: 1,
        encrypted: false,
        data: {
          items: [{ id: "new-1", name: "New 1" }],
        },
      }],
    })).rejects.toThrow("remove failed")

    expect((await handle.list()).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: "old-1", name: "Old 1" },
      { id: "old-2", name: "Old 2" },
    ])
  })

  it("importAll() removes partially imported items when replace import fails midway", async () => {
    type TestItem = { id: string; name: string }
    const repo = createDataRepository()
    const fakeSchema = {
      name: "replace-test",
      backend: "json" as const,
      currentVersion: 1,
      migrations: [],
      validate: (v: unknown): v is TestItem =>
        typeof v === "object"
        && v !== null
        && typeof (v as { id?: string }).id === "string"
        && typeof (v as { name?: string }).name === "string",
    }
    const handle = createMidwayUpsertFailureHandle<TestItem>([
      { id: "old-1", name: "Old 1" },
    ], "new-2")
    repo.register(fakeSchema, handle)

    await expect(repo.importAll({
      format: "synapse-backup-v1",
      exportedAt: "2026-04-25T00:00:00Z",
      namespaces: [{
        name: "replace-test",
        schemaVersion: 1,
        encrypted: false,
        data: {
          items: [
            { id: "new-1", name: "New 1" },
            { id: "new-2", name: "New 2" },
          ],
        },
      }],
    })).rejects.toThrow("upsert failed")

    expect(await handle.list()).toEqual([
      { id: "old-1", name: "Old 1" },
    ])
  })

  it("register() rejects duplicates", () => {
    const repo = createDataRepository()
    const fakeSchema = {
      name: "x",
      backend: "json" as const,
      currentVersion: 1,
      migrations: [],
      validate: (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null,
    }
    const fakeHandle = {
      name: "x",
      schemaVersion: 1,
      backend: "json" as const,
      getSingleton: async () => null,
      setSingleton: async () => {},
      list: async () => [],
      get: async () => null,
      upsert: async () => {},
      remove: async () => {},
      onChange: () => () => {},
    }
    repo.register(fakeSchema, fakeHandle)
    expect(() => repo.register(fakeSchema, fakeHandle)).toThrow(/already registered/)
  })

  it("importAll() rejects non-v1 format", async () => {
    const repo = createDataRepository()
    await expect(
      repo.importAll({
        format: "wrong" as unknown as "synapse-backup-v1",
        exportedAt: "2026-04-25T00:00:00Z",
        namespaces: [],
      }),
    ).rejects.toThrow(/Unexpected backup format/)
  })

  it("importAll() drops items that fail the schema validate() — does not corrupt the namespace", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const handle = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
        validate: coreConfigSchema.validate,
      })
      repo.register(coreConfigSchema, handle)

      // Seed with a valid singleton.
      await handle.setSingleton({
        schemaVersion: 1,
        activeRepoUuid: "old",
        repositories: [],
        global: {},
      })

      // Import payload contains a malformed singleton (missing required fields).
      // Without schema validation the cast `as never` would happily call
      // setSingleton with garbage and corrupt the namespace.
      await repo.importAll({
        format: "synapse-backup-v1",
        exportedAt: "2026-04-25T00:00:00Z",
        namespaces: [
          {
            name: coreConfigSchema.name,
            schemaVersion: 1,
            encrypted: false,
            data: {
              singleton: { activeRepoUuid: "no-schema-version-marker" },
              items: [],
            },
          },
        ],
      })

      // The malformed singleton was rejected by validate(), so the namespace
      // still holds the original "old" singleton (no corruption).
      const result = await handle.getSingleton()
      expect(result?.activeRepoUuid).toBe("old")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function createMidwayRemoveFailureHandle<T extends { id: string }>(
  initialItems: T[],
  failRemoveId: string,
): DataNamespace<T> {
  let items = [...initialItems]
  return {
    name: "replace-test",
    schemaVersion: 1,
    backend: "json",
    getSingleton: async () => null,
    setSingleton: async () => {},
    list: async () => [...items],
    get: async (id) => items.find((item) => item.id === id) ?? null,
    upsert: async (item) => {
      items = items.filter((existing) => existing.id !== item.id)
      items.push(item)
    },
    remove: async (id) => {
      if (id === failRemoveId) throw new Error("remove failed")
      items = items.filter((item) => item.id !== id)
    },
    onChange: () => () => {},
  }
}

function createMidwayUpsertFailureHandle<T extends { id: string }>(
  initialItems: T[],
  failUpsertId: string,
): DataNamespace<T> {
  let items = [...initialItems]
  return {
    name: "replace-test",
    schemaVersion: 1,
    backend: "json",
    getSingleton: async () => null,
    setSingleton: async () => {},
    list: async () => [...items],
    get: async (id) => items.find((item) => item.id === id) ?? null,
    upsert: async (item) => {
      if (item.id === failUpsertId) throw new Error("upsert failed")
      items = items.filter((existing) => existing.id !== item.id)
      items.push(item)
    },
    remove: async (id) => {
      items = items.filter((item) => item.id !== id)
    },
    onChange: () => () => {},
  }
}
