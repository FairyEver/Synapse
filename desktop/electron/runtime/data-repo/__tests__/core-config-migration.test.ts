import { describe, expect, it } from "vitest"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  JsonNamespace,
  coreConfigSchema,
  isLegacyCoreConfigV0,
  runMigrations,
  type CoreConfigV1,
  type JsonFileEnvelope,
} from "../index"

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-cfg-mig-"))

describe("core.config schema (T2.7)", () => {
  it("isLegacyCoreConfigV0 detects pre-v1 SynapseConfig payloads", () => {
    expect(
      isLegacyCoreConfigV0({
        activeRepoUuid: null,
        repositories: [],
        global: {},
      }),
    ).toBe(true)
    expect(
      isLegacyCoreConfigV0({
        schemaVersion: 1,
        activeRepoUuid: null,
        repositories: [],
        global: {},
      }),
    ).toBe(false)
    expect(isLegacyCoreConfigV0(null)).toBe(false)
    expect(isLegacyCoreConfigV0("string")).toBe(false)
    expect(isLegacyCoreConfigV0({ random: 1 })).toBe(false)
  })

  it("v0 -> v1 migration adds schemaVersion and preserves required fields", async () => {
    const v0 = {
      activeRepoUuid: "abc",
      repositories: [{ uuid: "abc", name: "demo" }],
      global: { theme: "dark" },
    }
    const result = await runMigrations<typeof v0, CoreConfigV1>({
      currentVersion: 0,
      targetVersion: coreConfigSchema.currentVersion,
      migrations: coreConfigSchema.migrations,
      namespace: coreConfigSchema.name,
      data: v0,
    })
    expect(result.schemaVersion).toBe(1)
    expect(result.activeRepoUuid).toBe("abc")
    expect(result.repositories).toHaveLength(1)
    expect(result.global).toEqual({ theme: "dark" })
    expect(coreConfigSchema.validate(result)).toBe(true)
  })

  it("validate rejects malformed v1 payloads", () => {
    expect(coreConfigSchema.validate({})).toBe(false)
    expect(
      coreConfigSchema.validate({
        schemaVersion: 1,
        activeRepoUuid: null,
        repositories: "not-an-array",
        global: {},
      }),
    ).toBe(false)
    expect(
      coreConfigSchema.validate({
        schemaVersion: 1,
        activeRepoUuid: null,
        repositories: [],
        global: null,
      }),
    ).toBe(false)
  })

  it("integration: legacy file on disk → JsonNamespace + reviveEnvelope adapts it", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "config.json")
    try {
      // Existing user file: v0 SynapseConfig.
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
            const promoted: CoreConfigV1 = {
              schemaVersion: 1,
              activeRepoUuid:
                typeof (raw as Record<string, unknown>).activeRepoUuid === "string"
                || (raw as Record<string, unknown>).activeRepoUuid === null
                  ? ((raw as Record<string, unknown>).activeRepoUuid as string | null)
                  : null,
              repositories: ((raw as Record<string, unknown>).repositories as CoreConfigV1["repositories"]) ?? [],
              global: ((raw as Record<string, unknown>).global as Record<string, unknown>) ?? {},
            }
            return { schemaVersion: 1, singleton: promoted, items: {} }
          }
          return null
        },
      })

      const config = await ns.getSingleton()
      expect(config?.schemaVersion).toBe(1)
      expect(config?.activeRepoUuid).toBe("uuid-1")
      expect(config?.repositories).toHaveLength(1)

      // Persist + re-read: the on-disk file should now be in v1 envelope shape.
      await ns.setSingleton(config!)
      const onDisk = JSON.parse(await readFile(file, "utf8"))
      expect(onDisk.schemaVersion).toBe(1)
      expect(onDisk.singleton?.schemaVersion).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("v1 idempotency: running migrations against v1 data is a no-op", async () => {
    const v1: CoreConfigV1 = {
      schemaVersion: 1,
      activeRepoUuid: null,
      repositories: [],
      global: {},
    }
    const result = await runMigrations<CoreConfigV1, CoreConfigV1>({
      currentVersion: 1,
      targetVersion: 1,
      migrations: coreConfigSchema.migrations,
      namespace: coreConfigSchema.name,
      data: v1,
    })
    expect(result).toEqual(v1)
  })
})
