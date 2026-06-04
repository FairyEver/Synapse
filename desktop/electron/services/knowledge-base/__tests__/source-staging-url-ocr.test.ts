import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { FileConversionResult } from "../../file-conversion"
import type { FetchUrl } from "../../source-acquisition/url-source"
import { stageKnowledgeBaseSources, stageKnowledgeBaseUrlSource } from "../source-staging"

const roots: string[] = []
const fixedNow = () => new Date("2026-05-24T08:00:00.000Z")

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-url-ocr-stage-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base source staging for URL and OCR sources", () => {
  it("stages URL sources under the dated raw web directory with source metadata", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/docs/source",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><main><h1>Source</h1><p>Body</p></main></body></html>",
    })

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/docs/source",
      fetchUrl,
      now: fixedNow,
    })

    expect(result.skipped).toEqual([])
    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: "https://example.com/docs/source",
      relativePath: ".raw/web/2026/05/24/source.md",
      sourceKind: "url",
      sourceUrl: "https://example.com/docs/source",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "source.md"), "utf8"))
      .resolves.toContain('source_url: "https://example.com/docs/source"')
    await expect(access(path.join(projectPath, "wiki"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("copies image originals and writes intake markdown under the dated raw images directory", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "receipt.png")
    await writeFile(sourcePath, "png")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: fixedNow,
      converter: {
        convert: async (): Promise<FileConversionResult> => {
          throw new Error("image intake should not require local OCR")
        },
      },
    })

    expect(result.skipped).toEqual([])
    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: sourcePath,
      relativePath: ".raw/images/2026/05/24/receipt.md",
      originalRelativePath: "_attachments/images/2026/05/24/receipt.png",
    })])
    await expect(readFile(path.join(projectPath, "_attachments", "images", "2026", "05", "24", "receipt.png"), "utf8"))
      .resolves.toBe("png")
    await expect(readFile(path.join(projectPath, ".raw", "images", "2026", "05", "24", "receipt.md"), "utf8"))
      .resolves.toContain('attachment: "_attachments/images/2026/05/24/receipt.png"')
    await expect(access(path.join(projectPath, "wiki"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("writes scanned PDF OCR markdown under the dated raw PDFs directory", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "scan.pdf")
    await writeFile(sourcePath, "%PDF-1.7\n")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: fixedNow,
      converter: {
        convert: async (input): Promise<FileConversionResult> => {
          expect(input).toEqual({
            filePath: sourcePath,
            ocr: { enabled: true },
            imageHandling: { mode: "omit" },
          })
          return {
            sourcePath,
            format: "pdf",
            kind: "pdf",
            title: "scan.pdf",
            markdown: "# scan.pdf\n\nScanned page text\n",
            text: "Scanned page text",
            metadata: { ocr: { pages: [{ page: 1 }] } },
            warnings: [],
          }
        },
      },
    })

    expect(result.skipped).toEqual([])
    expect(result.uploaded).toEqual([expect.objectContaining({
      relativePath: ".raw/pdfs/2026/05/24/scan.md",
      originalRelativePath: "_attachments/originals/2026/05/24/scan.pdf",
      sourceKind: "file",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "pdfs", "2026", "05", "24", "scan.md"), "utf8"))
      .resolves.toContain("Scanned page text")
  })

})
