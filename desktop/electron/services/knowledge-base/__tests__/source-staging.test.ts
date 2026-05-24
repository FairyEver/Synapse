import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { FileConversionResult } from "../../file-conversion"
import { scanKnowledgeBaseSources } from "../source-scan"
import { stageKnowledgeBaseSources } from "../source-staging"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-stage-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base source staging", () => {
  it("archives convertible originals and writes generated markdown into raw", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "report.docx")
    await writeFile(sourcePath, "binary")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async (): Promise<FileConversionResult> => ({
          sourcePath,
          format: "docx",
          kind: "document",
          title: "report.docx",
          markdown: "# report.docx\n\nBody\n",
          text: "Body",
          metadata: {},
          warnings: [],
        }),
      },
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: sourcePath,
      relativePath: ".raw/documents/2026/05/23/report.md",
      originalRelativePath: "_attachments/originals/2026/05/23/report.docx",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "documents", "2026", "05", "23", "report.md"), "utf8"))
      .resolves.toContain('source_format: "docx"')
    await expect(readFile(path.join(projectPath, "_attachments", "originals", "2026", "05", "23", "report.docx"), "utf8"))
      .resolves.toBe("binary")

    const scan = await scanKnowledgeBaseSources(projectPath)
    expect(scan.sources).toEqual([expect.objectContaining({
      relativePath: ".raw/documents/2026/05/23/report.md",
      state: "new",
    })])
  })

  it("keeps existing text uploads in the dated raw inbox", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "note.md")
    await writeFile(sourcePath, "alpha\n")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error("converter should not handle text sources")
        },
      },
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: sourcePath,
      relativePath: ".raw/2026/05/23/note.md",
    })])
    expect(result.uploaded[0]).not.toHaveProperty("originalRelativePath")
    await expect(readFile(path.join(projectPath, ".raw", "2026", "05", "23", "note.md"), "utf8"))
      .resolves.toBe("alpha\n")
  })
})
