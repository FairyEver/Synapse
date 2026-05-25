import { mkdtemp, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { resolveUniqueMarkdownOutputPath } from "../file-conversion-output"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-tools-output-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("resolveUniqueMarkdownOutputPath", () => {
  it("uses the source basename with markdown extension", async () => {
    const root = await tempDir()

    await expect(resolveUniqueMarkdownOutputPath(root, "/tmp/report.docx"))
      .resolves.toBe(path.join(root, "report.md"))
  })

  it("adds numeric suffixes for existing and reserved outputs", async () => {
    const root = await tempDir()
    await writeFile(path.join(root, "report.md"), "# Existing\n")
    await writeFile(path.join(root, "report-2.md"), "# Existing\n")

    await expect(resolveUniqueMarkdownOutputPath(
      root,
      "/tmp/report.pdf",
      new Set([path.join(root, "report-3.md")]),
    )).resolves.toBe(path.join(root, "report-4.md"))
  })
})
