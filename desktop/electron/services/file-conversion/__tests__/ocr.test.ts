import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { FileConversionService, PdfExtractor, type LocalOcrEngine } from "../index"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-conversion-ocr-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("file conversion OCR", () => {
  it("converts image files with the injected local OCR engine", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "receipt.png")
    await writeFile(filePath, Buffer.from("89504e470d0a1a0a", "hex"))
    const ocrEngine: LocalOcrEngine = {
      recognize: async (input) => ({
        text: `OCR text from ${path.basename(input.filePath)} (${input.mimeType})`,
        confidence: 0.91,
        metadata: { image: { width: 120, height: 80 } },
      }),
    }
    const service = new FileConversionService({ extractors: [], localOcrEngine: ocrEngine })

    const result = await service.convert({ filePath })

    expect(result).toMatchObject({
      sourcePath: filePath,
      format: "png",
      kind: "image",
      title: "receipt.png",
      text: "OCR text from receipt.png (image/png)",
      metadata: {
        mimeType: "image/png",
        ocr: {
          confidence: 0.91,
          image: { width: 120, height: 80 },
        },
      },
      warnings: [],
    })
    expect(result.markdown).toContain("# receipt.png")
    expect(result.markdown).toContain("OCR text from receipt.png")
  })

  it("uses OCR for PDFs with empty embedded text only when OCR is enabled", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "scan.pdf")
    await writeFile(filePath, "%PDF-1.7\n", "utf8")
    const extractor = new PdfExtractor({
      parsePdf: async () => ({ text: "", total: 2, info: { Title: "Scanned Report" } }),
      localOcrEngine: {
        recognize: async () => ({
          text: "OCR page text",
          metadata: { pages: [{ page: 1 }, { page: 2 }] },
        }),
      },
    })
    const service = new FileConversionService({ extractors: [extractor] })

    const withoutOcr = await service.convert({ filePath })
    const withOcr = await service.convert({ filePath, ocr: { enabled: true } })

    expect(withoutOcr.text).toBe("")
    expect(withoutOcr.warnings).toEqual([{ code: "empty_extraction", message: "PDF parser returned no text." }])
    expect(withOcr.text).toBe("OCR page text")
    expect(withOcr.markdown).toContain("OCR page text")
    expect(withOcr.metadata).toMatchObject({
      pages: 2,
      ocr: { pages: [{ page: 1 }, { page: 2 }] },
    })
    expect(withOcr.warnings).toEqual([])
  })

  it("returns a structured OCR warning when the default OCR engine is unavailable", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "scan.webp")
    await writeFile(filePath, "webp")
    const service = new FileConversionService({ extractors: [] })

    const result = await service.convert({ filePath })

    expect(result).toMatchObject({
      format: "webp",
      kind: "image",
      text: "",
      metadata: {
        mimeType: "image/webp",
        ocr: { available: false },
      },
      warnings: [{
        code: "ocr_unavailable",
        message: expect.stringContaining("Local OCR"),
      }],
    })
  })

  it("preserves OCR confidence, metadata, and warnings", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "photo.jpg")
    await writeFile(filePath, "jpeg")
    const service = new FileConversionService({
      extractors: [],
      localOcrEngine: {
        recognize: async () => ({
          text: "Meter reading 42",
          confidence: 0.84,
          metadata: { image: { orientation: "landscape" }, engine: "test" },
          warnings: [{ code: "low_contrast", message: "Image contrast is low." }],
        }),
      },
    })

    const result = await service.convert({ filePath })

    expect(result.metadata).toEqual({
      mimeType: "image/jpeg",
      ocr: {
        confidence: 0.84,
        image: { orientation: "landscape" },
        engine: "test",
      },
    })
    expect(result.warnings).toEqual([{ code: "low_contrast", message: "Image contrast is low." }])
  })
})
