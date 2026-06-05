import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FileConversionResult } from "../../file-conversion"
import type { FetchUrl } from "../../source-acquisition/url-source"
import { knowledgeBaseLogger } from "../logging"
import { scanKnowledgeBaseSources } from "../source-scan"
import { stageKnowledgeBaseSources, stageKnowledgeBaseUrlSource } from "../source-staging"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-stage-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base source staging", () => {
  it("archives convertible originals and writes generated markdown into raw", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "report.docx")
    await writeFile(sourcePath, "binary")
    const convert = vi.fn(async (): Promise<FileConversionResult> => ({
      sourcePath,
      format: "docx",
      kind: "document",
      title: "report.docx",
      markdown: "# report.docx\n\nBody\n",
      text: "Body",
      metadata: {},
      warnings: [],
    }))

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: { convert },
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
    expect(convert).toHaveBeenCalledWith({
      filePath: sourcePath,
      ocr: { enabled: true },
      imageHandling: { mode: "omit" },
    })

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

  it("skips unsupported binary files instead of copying them into raw", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "archive.zip")
    await writeFile(sourcePath, "binary")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error("converter should not handle unsupported sources")
        },
      },
    })

    expect(result.uploaded).toEqual([])
    expect(result.skipped).toEqual([{ path: sourcePath, reason: "unsupported" }])
    await expect(access(path.join(projectPath, ".raw", "2026", "05", "23", "archive.zip")))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps concurrent text uploads with the same basename as separate sources", async () => {
    const projectPath = await tempDir()
    const firstInputDir = await tempDir()
    const secondInputDir = await tempDir()
    const firstSource = path.join(firstInputDir, "note.md")
    const secondSource = path.join(secondInputDir, "note.md")
    await writeFile(firstSource, "alpha\n")
    await writeFile(secondSource, "bravo\n")
    const input = {
      projectPath,
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error("converter should not handle text sources")
        },
      },
    }

    const [first, second] = await Promise.all([
      stageKnowledgeBaseSources({ ...input, filePaths: [firstSource] }),
      stageKnowledgeBaseSources({ ...input, filePaths: [secondSource] }),
    ])

    const uploaded = [...first.uploaded, ...second.uploaded]
    expect(uploaded.map((entry) => entry.relativePath).sort()).toEqual([
      ".raw/2026/05/23/note-2.md",
      ".raw/2026/05/23/note.md",
    ])
    await expect(Promise.all(uploaded.map((entry) =>
      readFile(path.join(projectPath, entry.relativePath), "utf8")
    ))).resolves.toEqual(expect.arrayContaining(["alpha\n", "bravo\n"]))
  })

  it("logs conversion failures without raw absolute paths", async () => {
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "report.pdf")
    await writeFile(sourcePath, "binary")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error(`failed to convert ${sourcePath} token=secret-value`)
        },
      },
    })

    expect(result.skipped).toEqual([{ path: sourcePath, reason: "conversion-error" }])
    expect(warn).toHaveBeenCalledWith("Knowledge Base source conversion failed.", expect.objectContaining({
      error: expect.not.stringContaining(sourcePath),
      fileName: "report.pdf",
    }))
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      error: expect.stringContaining("[path]"),
    })
    expect(String((warn.mock.calls[0]?.[1] as { error?: unknown } | undefined)?.error)).not.toContain("secret-value")
  })

  it("removes archived originals when conversion fails", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "failed.docx")
    await writeFile(sourcePath, "binary")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error("conversion failed")
        },
      },
    })

    expect(result).toEqual({
      uploaded: [],
      skipped: [{ path: sourcePath, reason: "conversion-error" }],
    })
    await expect(access(path.join(projectPath, "_attachments", "originals", "2026", "05", "23", "failed.docx")))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("removes archived originals when conversion reports OCR unavailable", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "scan.pdf")
    await writeFile(sourcePath, "%PDF-1.7\n")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async (): Promise<FileConversionResult> => ({
          sourcePath,
          format: "pdf",
          kind: "pdf",
          title: "scan.pdf",
          markdown: "",
          text: "",
          metadata: {},
          warnings: [{ code: "ocr_unavailable", message: "Local OCR is unavailable." }],
        }),
      },
    })

    expect(result).toEqual({
      uploaded: [],
      skipped: [{ path: sourcePath, reason: "conversion-error" }],
    })
    await expect(access(path.join(projectPath, "_attachments", "originals", "2026", "05", "23", "scan.pdf")))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("stages URL sources into the dated raw web directory", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/articles/alpha?signature=final-secret&utm_source=test",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><article><h1>Alpha</h1><p>Body</p></article></body></html>",
    })

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/articles/alpha?token=input-secret&utm_source=test",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: "https://example.com/articles/alpha?token=%5Bredacted%5D&utm_source=test",
      relativePath: ".raw/web/2026/05/24/alpha.md",
      name: "alpha.md",
      sourceUrl: "https://example.com/articles/alpha?token=%5Bredacted%5D&utm_source=test",
    })])
    expect(result.skipped).toEqual([])
    await expect(readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "alpha.md"), "utf8"))
      .resolves.toContain('source_format: "url"')
    const rawMarkdown = await readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "alpha.md"), "utf8")
    expect(rawMarkdown).not.toContain("input-secret")
    expect(rawMarkdown).not.toContain("final-secret")
    await expect(access(path.join(projectPath, "wiki"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("redacts URL source skipped paths and keeps acquisition failure reasons", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => {
      throw new Error("fetch failed")
    }

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/articles/alpha?token=input-secret",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toEqual({
      uploaded: [],
      skipped: [{ path: "https://example.com/articles/alpha?token=%5Bredacted%5D", reason: "network_error" }],
    })
    expect(JSON.stringify(result)).not.toContain("input-secret")
  })

  it("keeps URL validation failures visible as skipped URL reasons", async () => {
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
      skipped: [{ path: "javascript:alert(1)", reason: "unsupported_protocol" }],
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
