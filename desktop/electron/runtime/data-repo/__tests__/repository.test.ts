import { describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  JsonNamespace,
  NamespaceNotFoundError,
  coreConfigSchema,
  createDataRepository,
  type CoreConfigV1,
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
