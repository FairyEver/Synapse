import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FileConversionResult } from "../../file-conversion"
import type { FetchUrl } from "../../source-acquisition/url-source"
import { scanKnowledgeBaseSources } from "../source-scan"
import { stageKnowledgeBaseSources, stageKnowledgeBaseUrlSource } from "../source-staging"

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

  it("stages URL sources into the dated raw web directory", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/articles/alpha?utm_source=test",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><article><h1>Alpha</h1><p>Body</p></article></body></html>",
    })

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/articles/alpha?utm_source=test",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: "https://example.com/articles/alpha?utm_source=test",
      relativePath: ".raw/web/2026/05/24/alpha.md",
      name: "alpha.md",
    })])
    expect(result.skipped).toEqual([])
    await expect(readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "alpha.md"), "utf8"))
      .resolves.toContain('source_format: "url"')
    await expect(access(path.join(projectPath, "wiki"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps URL acquisition failures visible as skipped read errors", async () => {
    const projectPath = await tempDir()
    const fetchUrl = vi.fn<FetchUrl>()

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "javascript:alert(1)",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toEqual({
      uploaded: [],
      skipped: [{ path: "javascript:alert(1)", reason: "read-error" }],
    })
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("resolves URL source filename collisions", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/articles/alpha",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><h1>Alpha</h1></body></html>",
    })
    const input = {
      projectPath,
      url: "https://example.com/articles/alpha",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }

    const first = await stageKnowledgeBaseUrlSource(input)
    const second = await stageKnowledgeBaseUrlSource(input)

    expect(first.uploaded[0]).toMatchObject({ relativePath: ".raw/web/2026/05/24/alpha.md" })
    expect(second.uploaded[0]).toMatchObject({ relativePath: ".raw/web/2026/05/24/alpha-2.md" })
  })
})
