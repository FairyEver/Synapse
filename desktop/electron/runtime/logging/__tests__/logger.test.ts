import { describe, expect, it } from "vitest"
import { ArraySink, LogRotator, createLogger, LOG_LEVELS } from "../index"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

describe("StructuredLogger (T6.1)", () => {
  it("emits records to the sink with the canonical fields", () => {
    const sink = new ArraySink()
    const logger = createLogger({ module: "test", sink, minLevel: "trace" })
    logger.info("hello", { user: "ada" })
    expect(sink.records).toHaveLength(1)
    const record = sink.records[0]!
    expect(record.level).toBe("info")
    expect(record.module).toBe("test")
    expect(record.message).toBe("hello")
    expect(record.context).toEqual({ user: "ada" })
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("respects minLevel and drops below-threshold records", () => {
    const sink = new ArraySink()
    const logger = createLogger({ module: "test", sink, minLevel: "warn" })
    logger.info("nope")
    logger.warn("maybe")
    logger.error("yep")
    expect(sink.records.map((r) => r.level)).toEqual(["warn", "error"])
  })

  it("child() inherits sink, minLevel, and bindings", () => {
    const sink = new ArraySink()
    const root = createLogger({
      module: "root",
      sink,
      minLevel: "info",
      bindings: { app: "synapse" },
    })
    const child = root.child("module-a", { route: "/home" })
    child.info("hit")
    const record = sink.records[0]!
    expect(record.module).toBe("root.module-a")
    expect(record.context).toEqual({ app: "synapse", route: "/home" })
  })

  it("Error context is preserved as a structured `error` field", () => {
    const sink = new ArraySink()
    const logger = createLogger({ module: "test", sink, minLevel: "trace" })
    const err = new Error("boom")
    logger.error("op failed", err)
    expect(sink.records[0]?.error?.name).toBe("Error")
    expect(sink.records[0]?.error?.message).toBe("boom")
    expect(sink.records[0]?.error?.stack).toBeDefined()
  })

  it("non-object context is wrapped under `value`", () => {
    const sink = new ArraySink()
    const logger = createLogger({ module: "test", sink, minLevel: "trace" })
    logger.info("got value", 42)
    expect(sink.records[0]?.context).toEqual({ value: 42 })
  })

  it("LOG_LEVELS exposes all 6 canonical levels in order", () => {
    expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error", "fatal"])
  })
})

describe("LogRotator (T6.1)", () => {
  it("shouldRotate returns false when the file does not exist", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "synapse-rot-"))
    try {
      const rotator = new LogRotator({ logDir: dir, baseName: "synapse" })
      expect(rotator.shouldRotate(path.join(dir, "missing.log"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("shouldRotate returns true when the file exceeds the size threshold", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "synapse-rot-"))
    try {
      const file = path.join(dir, "synapse.log")
      writeFileSync(file, "x".repeat(1024))
      const rotator = new LogRotator({ logDir: dir, baseName: "synapse", maxSizeBytes: 100 })
      expect(rotator.shouldRotate(file)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("nextFilePath produces a timestamped filename in logDir", () => {
    const logDir = path.join(tmpdir(), "synapse-rotator-test")
    const rotator = new LogRotator({ logDir, baseName: "synapse" })
    const next = rotator.nextFilePath()
    expect(next.startsWith(path.join(logDir, "synapse-"))).toBe(true)
    expect(next.endsWith(".log")).toBe(true)
  })
})
