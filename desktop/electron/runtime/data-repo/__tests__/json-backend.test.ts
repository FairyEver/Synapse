import { describe, expect, it } from "vitest"
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { JsonNamespace, type JsonFileEnvelope } from "../backends/json"
import { writeJsonFileAtomic, fileExists, copyToTimestampedBackup } from "../atomic-io"
import { InvalidNamespaceDataError } from "../errors"

interface User extends Record<string, unknown> {
  id: string
  name: string
  role?: "admin" | "user"
}

const isUser = (value: unknown): value is User => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === "string" && typeof v.name === "string"
}

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "synapse-repo-data-"))
}

describe("atomic-io (T2.2)", () => {
  it("writeJsonFileAtomic writes a fresh file with trailing newline", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "config.json")
      await writeJsonFileAtomic(file, { x: 1 })
      const content = await readFile(file, "utf8")
      expect(content.endsWith("\n")).toBe(true)
      expect(JSON.parse(content)).toEqual({ x: 1 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("writeJsonFileAtomic does not leave .tmp-* files behind on success", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "config.json")
      await writeJsonFileAtomic(file, { x: 1 })
      await writeJsonFileAtomic(file, { x: 2 })
      const entries = await readdir(dir)
      expect(entries.filter((e) => e.includes(".tmp"))).toEqual([])
      expect(entries).toContain("config.json")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("writeJsonFileAtomic preserves the original file when value can serialize", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "config.json")
      await writeJsonFileAtomic(file, { v: "first" })
      await writeJsonFileAtomic(file, { v: "second" })
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ v: "second" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("fileExists returns false for missing path", async () => {
    expect(await fileExists("/nonexistent/synapse-test/abc.json")).toBe(false)
  })

  it("copyToTimestampedBackup creates a sibling file with .invalid- prefix", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "config.json")
      await writeFile(file, "{}", "utf8")
      const backup = await copyToTimestampedBackup(file)
      expect(backup).not.toBeNull()
      expect(path.basename(backup!)).toMatch(/^config\.invalid-/)
      expect(await fileExists(backup!)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("readJsonFile backs up malformed JSON and lets namespaces recover as empty", async () => {
    const dir = await tempDir()
    try {
      const file = path.join(dir, "config.json")
      await writeFile(file, "{ bad json", "utf8")
      const ns = new JsonNamespace<User>({
        name: "config",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })

      expect(await ns.getSingleton()).toBeNull()
      const entries = await readdir(dir)
      const backupName = entries.find((entry) => /^config\.invalid-.*\.json$/.test(entry))

      expect(backupName).toBeTruthy()
      expect(await readFile(path.join(dir, backupName!), "utf8")).toBe("{ bad json")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("JsonNamespace (T2.2)", () => {
  it("returns null for getSingleton on a fresh namespace", async () => {
    const dir = await tempDir()
    try {
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: path.join(dir, "users.json"),
      })
      expect(await ns.getSingleton()).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("singleton roundtrip persists across reload", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "config.json")
    try {
      const a = new JsonNamespace<User>({
        name: "config",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      await a.setSingleton({ id: "1", name: "Ada" })

      const b = new JsonNamespace<User>({
        name: "config",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      expect(await b.getSingleton()).toEqual({ id: "1", name: "Ada" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("upsert/list/remove roundtrip emits change events", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")
    try {
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      const events: string[] = []
      ns.onChange((e) => events.push(`${e.kind}:${e.id ?? ""}`))

      await ns.upsert({ id: "u1", name: "Ada" })
      await ns.upsert({ id: "u2", name: "Bob", role: "admin" })
      expect(await ns.list()).toHaveLength(2)
      expect(await ns.list({ role: "admin" })).toEqual([{ id: "u2", name: "Bob", role: "admin" }])
      expect(await ns.get("u1")).toEqual({ id: "u1", name: "Ada" })
      await ns.remove("u1")
      expect(await ns.get("u1")).toBeNull()
      expect(events).toEqual(["upsert:u1", "upsert:u2", "remove:u1"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("serializes concurrent upserts so later writes do not drop earlier items", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")

    class DelayedPersistJsonNamespace extends JsonNamespace<User> {
      override async persist(envelope: JsonFileEnvelope<User>): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        await super.persist(envelope)
      }
    }

    try {
      const ns = new DelayedPersistJsonNamespace({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })

      await Promise.all([
        ns.upsert({ id: "u1", name: "Ada" }),
        ns.upsert({ id: "u2", name: "Bob" }),
      ])

      expect(await ns.list()).toEqual([
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Bob" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rejects a conditional upsert when the source file changed", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")
    try {
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      await ns.upsert({ id: "u1", name: "Ada" })
      const expectedSource = await readFile(file)
      const externalEnvelope = {
        schemaVersion: 1,
        singleton: null,
        items: {
          u1: { id: "u1", name: "External update" },
          u3: { id: "u3", name: "Grace" },
        },
      }
      await writeJsonFileAtomic(file, externalEnvelope)

      await expect(ns.upsertIfFileUnchanged(
        { id: "u2", name: "Bob" },
        expectedSource,
      )).rejects.toThrow("File changed before atomic replacement.")

      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(externalEnvelope)
      expect(await ns.get("u2")).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("keeps cached collection state unchanged when upsert persistence fails", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")
    try {
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      await ns.upsert({ id: "u1", name: "Ada" })
      const circular = { id: "u2", name: "Bad" } as User & { self?: unknown }
      circular.self = circular

      await expect(ns.upsert(circular)).rejects.toThrow()

      expect(await ns.get("u2")).toBeNull()
      expect(await ns.list()).toEqual([{ id: "u1", name: "Ada" }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("keeps cached singleton state unchanged when setSingleton persistence fails", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "config.json")
    try {
      const ns = new JsonNamespace<User>({
        name: "config",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      await ns.setSingleton({ id: "u1", name: "Ada" })
      const circular = { id: "u2", name: "Bad" } as User & { self?: unknown }
      circular.self = circular

      await expect(ns.setSingleton(circular)).rejects.toThrow()

      expect(await ns.getSingleton()).toEqual({ id: "u1", name: "Ada" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("persisted file uses envelope shape with schemaVersion", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")
    try {
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 2,
        backend: "json",
        filePath: file,
      })
      await ns.upsert({ id: "u1", name: "Ada" })
      const persisted = JSON.parse(await readFile(file, "utf8")) as JsonFileEnvelope<User>
      expect(persisted.schemaVersion).toBe(2)
      expect(persisted.singleton).toBeNull()
      expect(persisted.items["u1"]?.name).toBe("Ada")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("validate hook rejects bad data on read", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")
    try {
      const bad: JsonFileEnvelope<unknown> = {
        schemaVersion: 1,
        singleton: { id: "1" }, // missing name
        items: {},
      }
      await writeFile(file, JSON.stringify(bad), "utf8")

      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
        validate: isUser,
      })
      await expect(ns.getSingleton()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rejects non-envelope JSON shapes", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")
    try {
      await writeFile(file, JSON.stringify({ random: "shape" }), "utf8")
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      await expect(ns.list()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("reviveEnvelope hook can transform legacy shapes", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "users.json")
    try {
      // Legacy v0 shape: just an array of users.
      await writeFile(file, JSON.stringify([{ id: "u1", name: "Ada" }]), "utf8")
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
        reviveEnvelope(raw) {
          if (Array.isArray(raw)) {
            const items: Record<string, User> = {}
            for (const u of raw as User[]) items[u.id] = u
            return { schemaVersion: 1, singleton: null, items }
          }
          return null
        },
      })
      expect(await ns.list()).toEqual([{ id: "u1", name: "Ada" }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("creates nested directories on first write", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "deeply", "nested", "users.json")
    try {
      const ns = new JsonNamespace<User>({
        name: "users",
        schemaVersion: 1,
        backend: "json",
        filePath: file,
      })
      await ns.upsert({ id: "u1", name: "Ada" })
      expect(await fileExists(file)).toBe(true)
      const fileStat = await stat(file)
      expect(fileStat.isFile()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
