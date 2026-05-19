import { describe, expect, it } from "vitest"
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
