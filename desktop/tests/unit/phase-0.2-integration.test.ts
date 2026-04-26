/**
 * Phase 0.2 — Integration test.
 *
 * SPEC §5 verification:
 *   - "临时 userData 模拟 v0 config，启动后自动迁到 v1 无丢失"
 *   - "备份脱敏、合并导入、加密失败" 各路径覆盖
 *
 * Uses real on-disk JSON / JSONL / SQLite backends; mocks safeStorage.
 */

import { describe, expect, it } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  EncryptedJsonNamespace,
  JsonLinesNamespace,
  JsonNamespace,
  SqliteNamespace,
  auditSchema,
  conversationsSchema,
  coreConfigSchema,
  createDataRepository,
  isLegacyCoreConfigV0,
  openSqliteDatabase,
  secretsSchema,
  type AuditEntryV1,
  type ConversationEntryV1,
  type CoreConfigV1,
  type JsonFileEnvelope,
  type SafeStorage,
  type SecretEntryV1,
} from "../../electron/runtime/data-repo"

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-phase02-"))

const fakeSafeStorage = (available = true): SafeStorage => ({
  isEncryptionAvailable: () => available,
  encryptString(s) {
    const buf = Buffer.from(s, "utf8")
    const out = Buffer.alloc(buf.length)
    for (let i = 0; i < buf.length; i++) out[i] = buf[i]! ^ 0x42
    return out
  },
  decryptString(c) {
    const out = Buffer.alloc(c.length)
    for (let i = 0; i < c.length; i++) out[i] = c[i]! ^ 0x42
    return out.toString("utf8")
  },
})

describe("Phase 0.2 integration (T2.14)", () => {
  it("v0 config on disk → DataRepository sees v1 envelope after first read+save", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "core.config.json")
      // Pre-existing v0 (legacy SynapseConfig, no schemaVersion).
      const v0 = {
        activeRepoUuid: "uuid-1",
        repositories: [{ uuid: "uuid-1", name: "demo" }],
        global: { theme: "system" },
      }
      await writeFile(file, JSON.stringify(v0, null, 2), "utf8")

      const ns = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: coreConfigSchema.currentVersion,
        backend: "json",
        filePath: file,
        validate: coreConfigSchema.validate,
        reviveEnvelope(raw): JsonFileEnvelope<CoreConfigV1> | null {
          if (isLegacyCoreConfigV0(raw)) {
            return {
              schemaVersion: 1,
              singleton: {
                schemaVersion: 1,
                activeRepoUuid: (raw as { activeRepoUuid: string | null }).activeRepoUuid,
                repositories: (raw as { repositories: CoreConfigV1["repositories"] }).repositories,
                global: (raw as { global: Record<string, unknown> }).global,
              },
              items: {},
            }
          }
          return null
        },
      })

      const repo = createDataRepository()
      repo.register(coreConfigSchema, ns)

      const config = await ns.getSingleton()
      expect(config?.schemaVersion).toBe(1)
      // Persist (the v0 file gets rewritten as v1 envelope).
      await ns.setSingleton(config!)

      // Re-open and confirm the persisted file is v1 envelope.
      const ns2 = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: 1,
        backend: "json",
        filePath: file,
        validate: coreConfigSchema.validate,
      })
      const reload = await ns2.getSingleton()
      expect(reload?.activeRepoUuid).toBe("uuid-1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("backup export/import round-trips JSON + JSONL + SQLite + encrypted namespaces", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()

      const configNs = new JsonNamespace<CoreConfigV1>({
        name: coreConfigSchema.name,
        schemaVersion: 1,
        backend: "json",
        filePath: path.join(dir, "core.config.json"),
      })
      repo.register(coreConfigSchema, configNs)

      const auditNs = new JsonLinesNamespace<AuditEntryV1>({
        name: auditSchema.name,
        schemaVersion: 1,
        backend: "jsonl",
        filePath: path.join(dir, "audit.jsonl"),
      })
      repo.register(auditSchema, auditNs)

      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const convNs = new SqliteNamespace<ConversationEntryV1>({
        name: conversationsSchema.name,
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      repo.register(conversationsSchema, convNs)

      const secretsNs = new EncryptedJsonNamespace<SecretEntryV1>({
        name: secretsSchema.name,
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: path.join(dir, "secrets.bin"),
        safeStorage: fakeSafeStorage(),
      })
      repo.register(secretsSchema, secretsNs)

      // Seed data across all backends.
      await configNs.setSingleton({
        schemaVersion: 1,
        activeRepoUuid: "abc",
        repositories: [{ uuid: "abc", name: "demo" }],
        global: { theme: "dark" },
      })
      await auditNs.upsert({
        id: "evt-1",
        schemaVersion: 1,
        action: "fs.write",
        actor: { kind: "user" },
        resource: { type: "file", id: "/tmp/x", projectId: "proj-1" },
        outcome: "allowed",
        timestamp: "2026-04-25T00:00:00Z",
      })
      await convNs.upsert({
        id: "conv-1",
        schemaVersion: 1,
        projectId: "proj-1",
        sessionKey: "local:user",
        history: [
          { role: "user", content: "hello", timestamp: "2026-04-25T00:00:00Z" },
        ],
        active: true,
        createdAt: "2026-04-25T00:00:00Z",
        updatedAt: "2026-04-25T00:00:00Z",
      })
      await secretsNs.upsert({
        id: "sec-1",
        schemaVersion: 1,
        kind: "api-key",
        description: "Anthropic primary key",
      })

      // Export WITHOUT secrets (the default for share-friendly backups).
      const sharedPayload = await repo.exportAll()
      const sharedSecrets = sharedPayload.namespaces.find((n) => n.name === "secrets")
      expect(sharedSecrets?.encrypted).toBe(true)
      expect(sharedSecrets?.data).toBeNull()
      const sharedAudit = sharedPayload.namespaces.find((n) => n.name === "audit")
      expect(sharedAudit?.data).not.toBeNull()

      // Export WITH secrets for full migration.
      const fullPayload = await repo.exportAll({ includeSecrets: true })
      const fullSecrets = fullPayload.namespaces.find((n) => n.name === "secrets")
      expect(fullSecrets?.data).not.toBeNull()

      // New empty repository: import the full backup, expect everything back.
      const dir2 = await tempDir()
      try {
        const repo2 = createDataRepository()
        const configNs2 = new JsonNamespace<CoreConfigV1>({
          name: coreConfigSchema.name,
          schemaVersion: 1,
          backend: "json",
          filePath: path.join(dir2, "core.config.json"),
        })
        repo2.register(coreConfigSchema, configNs2)

        const auditNs2 = new JsonLinesNamespace<AuditEntryV1>({
          name: auditSchema.name,
          schemaVersion: 1,
          backend: "jsonl",
          filePath: path.join(dir2, "audit.jsonl"),
        })
        repo2.register(auditSchema, auditNs2)

        const db2 = openSqliteDatabase(path.join(dir2, "data.db"))
        const convNs2 = new SqliteNamespace<ConversationEntryV1>({
          name: conversationsSchema.name,
          schemaVersion: 1,
          backend: "sqlite",
          database: db2,
        })
        repo2.register(conversationsSchema, convNs2)

        const secretsNs2 = new EncryptedJsonNamespace<SecretEntryV1>({
          name: secretsSchema.name,
          schemaVersion: 1,
          backend: "encrypted-json",
          filePath: path.join(dir2, "secrets.bin"),
          safeStorage: fakeSafeStorage(),
        })
        repo2.register(secretsSchema, secretsNs2)

        await repo2.importAll(fullPayload)

        expect((await configNs2.getSingleton())?.activeRepoUuid).toBe("abc")
        expect(await auditNs2.list()).toHaveLength(1)
        expect(await convNs2.list()).toHaveLength(1)
        expect(await secretsNs2.get("sec-1")).toEqual({
          id: "sec-1",
          schemaVersion: 1,
          kind: "api-key",
          description: "Anthropic primary key",
        })

        db2.close()
      } finally {
        await rm(dir2, { recursive: true, force: true })
      }

      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("encrypted namespace fails fast when safeStorage reports unavailable (Linux no-keyring)", async () => {
    const dir = await tempDir()
    try {
      const ns = new EncryptedJsonNamespace<SecretEntryV1>({
        name: secretsSchema.name,
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: path.join(dir, "secrets.bin"),
        safeStorage: fakeSafeStorage(false),
      })
      await expect(
        ns.upsert({ id: "sec-1", schemaVersion: 1, kind: "api-key" }),
      ).rejects.toMatchObject({ name: "EncryptionUnavailableError" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("merge import keeps existing items intact and adds new ones", async () => {
    const dir = await tempDir()
    try {
      const repo = createDataRepository()
      const ns = new JsonLinesNamespace<AuditEntryV1>({
        name: auditSchema.name,
        schemaVersion: 1,
        backend: "jsonl",
        filePath: path.join(dir, "audit.jsonl"),
      })
      repo.register(auditSchema, ns)

      await ns.upsert({
        id: "evt-existing",
        schemaVersion: 1,
        action: "x",
        actor: { kind: "user" },
        resource: { type: "file", id: "/r" },
        outcome: "allowed",
        timestamp: "2026-04-25T00:00:00Z",
      })

      await repo.importAll(
        {
          format: "synapse-backup-v1",
          exportedAt: "2026-04-25T00:00:00Z",
          namespaces: [
            {
              name: "audit",
              schemaVersion: 1,
              encrypted: false,
              data: {
                items: [
                  {
                    id: "evt-imported",
                    schemaVersion: 1,
                    action: "y",
                    actor: { kind: "user" },
                    resource: { type: "file", id: "/r" },
                    outcome: "denied",
                    timestamp: "2026-04-25T00:00:01Z",
                  },
                ],
              },
            },
          ],
        },
        { merge: true },
      )

      const items = await ns.list()
      expect(items.map((e) => e.id).sort()).toEqual(["evt-existing", "evt-imported"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
