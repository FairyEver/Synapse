import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collectJsonlFiles, fingerprintFile } from "../scan"

describe("usage analysis scan utilities", () => {
  it("collects jsonl files recursively", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-scan-"))
    try {
      fs.mkdirSync(path.join(dir, "nested"))
      fs.writeFileSync(path.join(dir, "a.jsonl"), "{}\n")
      fs.writeFileSync(path.join(dir, "nested", "b.jsonl"), "{}\n")
      fs.writeFileSync(path.join(dir, "skip.txt"), "")

      expect(collectJsonlFiles([dir]).map((file) => path.basename(file)).sort()).toEqual(["a.jsonl", "b.jsonl"])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("collects only jsonl files modified after the requested timestamp", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-scan-"))
    try {
      const oldFile = path.join(dir, "old.jsonl")
      const todayFile = path.join(dir, "today.jsonl")
      fs.writeFileSync(oldFile, "{}\n")
      fs.writeFileSync(todayFile, "{}\n")
      const todayStartMs = new Date("2026-06-12T00:00:00").getTime()
      fs.utimesSync(oldFile, new Date(todayStartMs - 60_000), new Date(todayStartMs - 60_000))
      fs.utimesSync(todayFile, new Date(todayStartMs + 60_000), new Date(todayStartMs + 60_000))

      expect(collectJsonlFiles([dir], { modifiedSinceMs: todayStartMs }).map((file) => path.basename(file))).toEqual([
        "today.jsonl",
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("does not silently ignore unreadable scan directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-scan-"))
    try {
      const originalReaddirSync = fs.readdirSync
      vi.spyOn(fs, "readdirSync").mockImplementation(((target: fs.PathLike, options?: fs.ObjectEncodingOptions) => {
        if (target === dir) {
          const error = new Error(`EACCES: permission denied, scandir '${dir}'`) as NodeJS.ErrnoException
          error.code = "EACCES"
          throw error
        }
        return originalReaddirSync(target, options as never)
      }) as typeof fs.readdirSync)

      expect(() => collectJsonlFiles([dir])).toThrow("Unable to read usage analysis directory")
    } finally {
      vi.restoreAllMocks()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("keeps missing scan directories empty", () => {
    expect(collectJsonlFiles([path.join(os.tmpdir(), "synapse-missing-usage-root")])).toEqual([])
  })

  it("creates file fingerprints", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-fp-"))
    try {
      const file = path.join(dir, "a.jsonl")
      fs.writeFileSync(file, "{}\n")
      const fp = fingerprintFile(file)
      expect(fp.filePath).toBe(file)
      expect(fp.size).toBeGreaterThan(0)
      expect(fp.mtimeMs).toBeGreaterThan(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
