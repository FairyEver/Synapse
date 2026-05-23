import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DocxExtractor, FileConversionService, PdfExtractor, PptxExtractor } from "../index"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-conversion-errors-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("file conversion PDF extraction warnings", () => {
  it("reports an empty warning when the PDF parser returns no text", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "empty.pdf")
    await writeFile(filePath, "%PDF-1.7\n", "utf8")
    const service = new FileConversionService({
      extractors: [new PdfExtractor({
        parsePdf: async () => ({ text: "", total: 1, info: {} }),
      })],
    })

    const result = await service.convert({ filePath })

    expect(result.warnings).toEqual([{
      code: "empty_extraction",
      message: "PDF parser returned no text.",
    }])
  })
})

describe("file conversion parser errors", () => {
  it("reports malformed DOCX parser failures as parse_failed", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "broken.docx")
    await writeFile(filePath, "docx")
    const service = new FileConversionService({
      extractors: [new DocxExtractor({
        convertToHtml: async () => {
          throw new Error("Zip archive is invalid")
        },
      })],
    })

    await expect(service.convert({ filePath })).rejects.toMatchObject({
      code: "parse_failed",
      message: expect.stringContaining("Zip archive is invalid"),
    })
  })

  it("reports malformed PDF parser failures as parse_failed", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "broken.pdf")
    await writeFile(filePath, "%PDF-1.7\n", "utf8")
    const service = new FileConversionService({
      extractors: [new PdfExtractor({
        parsePdf: async () => {
          throw new Error("Invalid PDF structure")
        },
      })],
    })

    await expect(service.convert({ filePath })).rejects.toMatchObject({
      code: "parse_failed",
      message: expect.stringContaining("Invalid PDF structure"),
    })
  })

  it.each([
    ["docx", "password is required", new DocxExtractor({
      convertToHtml: async () => {
        throw new Error("password is required")
      },
    })],
    ["pdf", "Document is encrypted", new PdfExtractor({
      parsePdf: async () => {
        throw new Error("Document is encrypted")
      },
    })],
    ["pptx", "Failed to decrypt package", new PptxExtractor({
      parseOffice: async () => {
        throw new Error("Failed to decrypt package")
      },
    })],
  ] as const)("classifies %s parser password/encryption failures as encrypted", async (extension, message, extractor) => {
    const root = await tempDir()
    const filePath = path.join(root, `locked.${extension}`)
    await writeFile(filePath, extension)
    const service = new FileConversionService({ extractors: [extractor] })

    await expect(service.convert({ filePath })).rejects.toMatchObject({
      code: "encrypted",
      message: expect.stringContaining(message),
    })
  })
})
