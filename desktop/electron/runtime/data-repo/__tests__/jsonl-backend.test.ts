import { describe, expect, it } from "vitest"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { JsonLinesNamespace } from "../backends/jsonl"
import { DataRepositoryError, InvalidNamespaceDataError } from "../errors"

interface AuditEvent extends Record<string, unknown> {
  id: string
  action: string
  outcome: "allowed" | "denied"
}

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-jsonl-"))

describe("JsonLinesNamespace (T2.4)", () => {
  it("upsert appends a JSON line; reload picks it back up", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })
      await ns.upsert({ id: "e1", action: "fs.write", outcome: "allowed" })
      await ns.upsert({ id: "e2", action: "shell.exec", outcome: "denied" })

      const ns2 = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })
      expect((await ns2.list()).map((e) => e.id).sort()).toEqual(["e1", "e2"])
      expect(await ns2.size()).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("file format: header line + one JSON object per upsert", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 7,
        backend: "jsonl",
        filePath: file,
      })
      await ns.upsert({ id: "e1", action: "x", outcome: "allowed" })
      const text = await readFile(file, "utf8")
      const lines = text.trim().split("\n")
      expect(lines.length).toBe(2)
      expect(JSON.parse(lines[0]!)).toEqual({ __synapse_jsonl__: 1, schemaVersion: 7 })
      expect(JSON.parse(lines[1]!)).toEqual({ id: "e1", action: "x", outcome: "allowed" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("keeps cached collection state unchanged when append persistence fails", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })
      await ns.upsert({ id: "e1", action: "x", outcome: "allowed" })
      const circular = { id: "e2", action: "y", outcome: "denied" } as AuditEvent & { self?: unknown }
      circular.self = circular

      await expect(ns.upsert(circular)).rejects.toThrow()

      expect(await ns.get("e2")).toBeNull()
      expect(await ns.list()).toEqual([{ id: "e1", action: "x", outcome: "allowed" }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("remove() throws by default (audit semantics)", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })
      await ns.upsert({ id: "e1", action: "x", outcome: "allowed" })
      await expect(ns.remove("e1")).rejects.toBeInstanceOf(DataRepositoryError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("setSingleton() throws by default", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })
      await expect(
        ns.setSingleton({ id: "e1", action: "x", outcome: "allowed" }),
      ).rejects.toBeInstanceOf(DataRepositoryError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("allowRemove=true enables remove() and rewrites the file", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "outbox.jsonl")
    try {
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "outbox",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
        allowRemove: true,
      })
      await ns.upsert({ id: "e1", action: "x", outcome: "allowed" })
      await ns.upsert({ id: "e2", action: "y", outcome: "denied" })
      await ns.remove("e1")
      expect(await ns.get("e1")).toBeNull()
      expect((await ns.list()).map((e) => e.id)).toEqual(["e2"])
      const text = await readFile(file, "utf8")
      expect(text).not.toContain('"id":"e1"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("compact() rewrites the file (only when allowRemove)", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "outbox.jsonl")
    try {
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "outbox",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
        allowRemove: true,
      })
      await ns.upsert({ id: "e1", action: "x", outcome: "allowed" })
      await expect(ns.compact()).resolves.toBeUndefined()

      const audit = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: path.join(dir, "audit.jsonl"),
      })
      await expect(audit.compact()).rejects.toBeInstanceOf(DataRepositoryError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("invalid JSON line throws InvalidNamespaceDataError on read", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      await writeFile(
        file,
        '{"__synapse_jsonl__":1,"schemaVersion":1}\n{"id":"good","action":"x","outcome":"allowed"}\nNOT_JSON\n',
        "utf8",
      )
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })
      await expect(ns.list()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("recovers a malformed trailing line before appending new records", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      await writeFile(
        file,
        '{"__synapse_jsonl__":1,"schemaVersion":1}\n{"id":"good","action":"x","outcome":"allowed"}\n{"id":"partial"',
        "utf8",
      )
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })

      await ns.upsert({ id: "new", action: "y", outcome: "denied" })

      expect((await ns.list()).map((event) => event.id)).toEqual(["good", "new"])
      const text = await readFile(file, "utf8")
      expect(text).not.toContain("partial")
      expect(text.trim().split("\n").map((line) => JSON.parse(line) as unknown)).toEqual([
        { __synapse_jsonl__: 1, schemaVersion: 1 },
        { id: "good", action: "x", outcome: "allowed" },
        { id: "new", action: "y", outcome: "denied" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("appends without parsing existing history", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      await writeFile(
        file,
        '{"__synapse_jsonl__":1,"schemaVersion":1}\nNOT_JSON\n',
        "utf8",
      )
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })

      await expect(ns.upsert({ id: "new", action: "y", outcome: "denied" }))
        .resolves.toBeUndefined()
      await expect(ns.list()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("missing id field on a non-header line is rejected", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      await writeFile(
        file,
        '{"__synapse_jsonl__":1,"schemaVersion":1}\n{"action":"no-id"}\n',
        "utf8",
      )
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
      })
      await expect(ns.list()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("validate hook rejects items that fail the type guard", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "audit.jsonl")
    try {
      await writeFile(
        file,
        '{"__synapse_jsonl__":1,"schemaVersion":1}\n{"id":"e1","action":"x"}\n',
        "utf8",
      )
      const ns = new JsonLinesNamespace<AuditEvent>({
        name: "audit",
        schemaVersion: 1,
        backend: "jsonl",
        filePath: file,
        validate: (v): v is AuditEvent => {
          if (typeof v !== "object" || v === null) return false
          const e = v as AuditEvent
          return typeof e.id === "string" && typeof e.outcome === "string"
        },
      })
      await expect(ns.list()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
