import { describe, expect, it } from "vitest"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  BackupFormatError,
  InMemoryBackupRegistry,
  InMemoryExporterRegistry,
  InMemoryLayeredConfig,
  LocalArchiveStrategy,
  csvExporterFor,
  jsonExporterFor,
  type BackupPayload,
} from "../index"

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-extras-"))

const samplePayload = (): BackupPayload => ({
  format: "synapse-backup-v1",
  exportedAt: "2026-04-25T11:00:00.000Z",
  namespaces: [
    {
      name: "core.config",
      schemaVersion: 1,
      encrypted: false,
      data: {
        schemaVersion: 1,
        activeRepoUuid: null,
        repositories: [],
        global: {},
      },
    },
  ],
})

describe("InMemoryBackupRegistry + LocalArchiveStrategy (T2.10)", () => {
  it("registry rejects duplicate ids", () => {
    const reg = new InMemoryBackupRegistry()
    reg.register(new LocalArchiveStrategy({ backupRoot: "/tmp/x", id: "local-zip" }))
    expect(() =>
      reg.register(new LocalArchiveStrategy({ backupRoot: "/tmp/y", id: "local-zip" })),
    ).toThrow(/already registered/)
  })

  it("LocalArchiveStrategy snapshot writes payload + restore round-trips", async () => {
    const dir = await tempDir()
    try {
      const strat = new LocalArchiveStrategy({ backupRoot: dir })
      const reg = new InMemoryBackupRegistry()
      reg.register(strat)
      expect(reg.get("local-zip")).toBe(strat)
      expect(reg.list()).toHaveLength(1)

      const payload = samplePayload()
      const artifact = await strat.snapshot(payload)
      expect(artifact.id).toMatch(/^\d{4}-/)
      expect(artifact.bytes).toBeGreaterThan(0)
      expect(artifact.path).toContain(dir)

      const text = await readFile(artifact.path!, "utf8")
      expect(JSON.parse(text)).toEqual(payload)

      const restored = await strat.restore(artifact)
      expect(restored).toEqual(payload)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("LocalArchiveStrategy.list returns artifacts sorted by id", async () => {
    const dir = await tempDir()
    try {
      const strat = new LocalArchiveStrategy({ backupRoot: dir })
      await strat.snapshot(samplePayload())
      await new Promise((r) => setTimeout(r, 5))
      await strat.snapshot(samplePayload())
      const list = await strat.list()
      expect(list.length).toBeGreaterThanOrEqual(1)
      // Sorted ascending by id (timestamp).
      const ids = list.map((a) => a.id)
      expect(ids).toEqual([...ids].sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("snapshot rejects payloads with the wrong format string", async () => {
    const dir = await tempDir()
    try {
      const strat = new LocalArchiveStrategy({ backupRoot: dir })
      await expect(
        strat.snapshot({
          format: "wrong" as unknown as "synapse-backup-v1",
          exportedAt: "2026-04-25T00:00:00Z",
          namespaces: [],
        }),
      ).rejects.toBeInstanceOf(BackupFormatError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("list returns [] when backupRoot does not exist yet", async () => {
    const strat = new LocalArchiveStrategy({ backupRoot: "/tmp/synapse-no-such-dir" + Date.now() })
    expect(await strat.list()).toEqual([])
  })
})

describe("InMemoryExporterRegistry (T2.11)", () => {
  it("registers and retrieves an exporter", async () => {
    const reg = new InMemoryExporterRegistry()
    reg.register(jsonExporterFor("conversations"))
    const out = await reg.exportAs("conversations", "json", [{ id: "c1" }])
    expect(typeof out).toBe("string")
    expect(JSON.parse(out as string)).toEqual([{ id: "c1" }])
  })

  it("rejects duplicate (namespace, format)", () => {
    const reg = new InMemoryExporterRegistry()
    reg.register(jsonExporterFor("conversations"))
    expect(() => reg.register(jsonExporterFor("conversations"))).toThrow(/already registered/)
  })

  it("throws BackupFormatError for unknown exporter", async () => {
    const reg = new InMemoryExporterRegistry()
    await expect(reg.exportAs("conversations", "csv", [])).rejects.toBeInstanceOf(BackupFormatError)
  })

  it("csv exporter writes headers + escapes newlines and commas", async () => {
    const csv = await csvExporterFor<{ id: string; note: string }>("notes").export([
      { id: "1", note: "hello" },
      { id: "2", note: 'has,"comma" and\nnewline' },
    ])
    const text = csv as string
    const lines = text.trim().split("\n")
    expect(lines[0]).toBe("id,note")
    expect(lines[1]).toBe("1,hello")
    // Escaped quoted cell preserved on line 2 (no naive split — single line).
    expect(text).toContain('"has,""comma"" and')
  })
})

describe("InMemoryLayeredConfig (T2.12)", () => {
  interface Setting extends Record<string, unknown> {
    theme: "light" | "dark" | "system"
    fontSize: number
  }

  it("defaults are returned when no layers are set", async () => {
    const cfg = new InMemoryLayeredConfig<Setting>({ theme: "system", fontSize: 14 })
    expect(await cfg.resolveFor({})).toEqual({ theme: "system", fontSize: 14 })
  })

  it("global layer overrides default", async () => {
    const cfg = new InMemoryLayeredConfig<Setting>({ theme: "system", fontSize: 14 })
    await cfg.setAt({}, { theme: "dark" })
    expect(await cfg.resolveFor({})).toEqual({ theme: "dark", fontSize: 14 })
  })

  it("repository overrides global", async () => {
    const cfg = new InMemoryLayeredConfig<Setting>({ theme: "system", fontSize: 14 })
    await cfg.setAt({}, { theme: "dark" })
    await cfg.setAt({ repositoryId: "r1" }, { theme: "light" })
    expect(await cfg.resolveFor({ repositoryId: "r1" })).toEqual({ theme: "light", fontSize: 14 })
    expect(await cfg.resolveFor({ repositoryId: "r2" })).toEqual({ theme: "dark", fontSize: 14 })
  })

  it("project overrides repository, session overrides project", async () => {
    const cfg = new InMemoryLayeredConfig<Setting>({ theme: "system", fontSize: 14 })
    await cfg.setAt({ repositoryId: "r1" }, { theme: "light", fontSize: 12 })
    await cfg.setAt({ projectId: "p1" }, { fontSize: 16 })
    await cfg.setAt({ sessionId: "s1" }, { fontSize: 18 })
    expect(
      await cfg.resolveFor({ repositoryId: "r1", projectId: "p1", sessionId: "s1" }),
    ).toEqual({ theme: "light", fontSize: 18 })
  })

  it("watchResolved fires on overlapping mutations", async () => {
    const cfg = new InMemoryLayeredConfig<Setting>({ theme: "system", fontSize: 14 })
    const seen: Setting[] = []
    cfg.watchResolved({ projectId: "p1" }, (v) => seen.push(v))
    await cfg.setAt({ projectId: "p1" }, { theme: "dark" })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.theme).toBe("dark")
  })

  it("global mutations notify all watchers", async () => {
    const cfg = new InMemoryLayeredConfig<Setting>({ theme: "system", fontSize: 14 })
    let count = 0
    cfg.watchResolved({ projectId: "p1" }, () => count++)
    cfg.watchResolved({ sessionId: "s1" }, () => count++)
    await cfg.setAt({}, { theme: "dark" })
    expect(count).toBe(2)
  })
})
