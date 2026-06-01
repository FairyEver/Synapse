import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { knowledgeBaseLogger } from "../logging"
import { KnowledgeBaseRawFileManager } from "../raw-file-manager"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-raw-manager-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseRawFileManager", () => {
  it("logs skipped uploads without raw absolute paths", async () => {
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const rawRoot = await tempDir()
    const inputDir = await tempDir()
    const missingPath = path.join(inputDir, "missing.md")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
    })

    const result = await manager.uploadFiles(rawRoot, "", [missingPath])

    expect(result).toEqual({
      entries: [],
      skipped: [{ path: missingPath, reason: "read-error" }],
    })
    expect(warn).toHaveBeenCalledWith("Knowledge Base raw file upload skipped.", expect.objectContaining({
      fileName: "missing.md",
      reason: "read-error",
    }))
    expect(String((warn.mock.calls[0]?.[1] as { error?: unknown } | undefined)?.error)).not.toContain(inputDir)
  })

  it("keeps concurrent uploads with the same basename as separate files", async () => {
    const rawRoot = await tempDir()
    const firstInputDir = await tempDir()
    const secondInputDir = await tempDir()
    const firstSource = path.join(firstInputDir, "brief.md")
    const secondSource = path.join(secondInputDir, "brief.md")
    await writeFile(firstSource, "alpha\n", "utf8")
    await writeFile(secondSource, "bravo\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
    })

    const [firstResult, secondResult] = await Promise.all([
      manager.uploadFiles(rawRoot, "", [firstSource]),
      manager.uploadFiles(rawRoot, "", [secondSource]),
    ])

    const uploaded = [...firstResult.entries, ...secondResult.entries]
    expect(uploaded.map((entry) => entry.name).sort()).toEqual(["brief-2.md", "brief.md"])
    await expect(Promise.all(uploaded.map((entry) =>
      readFile(path.join(rawRoot, entry.relativePath), "utf8")
    ))).resolves.toEqual(expect.arrayContaining(["alpha\n", "bravo\n"]))
  })
})
