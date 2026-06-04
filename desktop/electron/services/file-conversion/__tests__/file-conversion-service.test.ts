import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  FileConversionError,
  FileConversionService,
  DocxExtractor,
  LegacyOfficeExtractor,
  PdfExtractor,
  PptxExtractor,
  XlsxExtractor,
  type FileConversionFormat,
  type FileConversionResult,
} from "../index"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-convert-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("legacy Office extractor", () => {
  it("reports missing local helper for legacy Office files", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "legacy.doc")
    await writeFile(filePath, "legacy")
    const service = new FileConversionService({ extractors: [new LegacyOfficeExtractor({ helperPath: null })] })

    await expect(service.convert({ filePath })).rejects.toMatchObject({ code: "missing_local_helper" })
  })

  it("converts legacy Office files through an injected local helper", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "legacy.ppt")
    await writeFile(filePath, "legacy")
    const service = new FileConversionService({
      extractors: [new LegacyOfficeExtractor({
        helperPath: "/local/tika-app.jar",
        runHelper: async () => ({ text: "Slide One\nLegacy content", metadata: { parser: "stub" } }),
      })],
    })

    const result = await service.convert({ filePath })

    expect(result.format).toBe("ppt")
    expect(result.kind).toBe("presentation")
    expect(result.markdown).toContain("Legacy content")
  })
})

describe("modern file extractors", () => {
  it("converts docx parser output into document markdown", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "report.docx")
    await writeFile(filePath, "docx")
    const service = new FileConversionService({
      extractors: [new DocxExtractor({
        convertToHtml: async () => ({
          value: "<h1>Quarterly Report</h1><p>Revenue grew 12%.</p>",
          messages: [{ type: "warning", message: "Ignored style" }],
        }),
      })],
    })

    const result = await service.convert({ filePath })

    expect(result).toMatchObject({
      format: "docx",
      kind: "document",
      title: "Quarterly Report",
    })
    expect(result.markdown).toContain("# Quarterly Report")
    expect(result.text).toContain("Revenue grew 12%.")
    expect(result.warnings).toEqual([{ code: "warning", message: "Ignored style" }])
  })

  it("omits DOCX inline images by default and records a warning", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "report.docx")
    await writeFile(filePath, "docx")
    const service = new FileConversionService({
      extractors: [new DocxExtractor({
        convertToHtml: async (_input, options?: MockMammothOptions) => {
          const convertImage = readMockConvertImage(options)
          const nodes = await convertImage?.(mockDocxImage("image/png", "cover")) ?? []
          return {
            value: `<h1>Quarterly Report</h1><p>Revenue grew 12%.</p>${renderMockImageNodes(nodes)}`,
            messages: [],
          }
        },
      })],
    })

    const result = await service.convert({ filePath })

    expect(result.markdown).toContain("# Quarterly Report")
    expect(result.markdown).toContain("Revenue grew 12%.")
    expect(result.markdown).not.toContain("data:image")
    expect(result.markdown).not.toContain("![](")
    expect(result.assets).toEqual([])
    expect(result.warnings).toEqual([{
      code: "docx_inline_images_omitted",
      message: "DOCX inline images were omitted from the Markdown output.",
    }])
  })

  it("returns DOCX inline images as assets when requested", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "report.docx")
    await writeFile(filePath, "docx")
    const service = new FileConversionService({
      extractors: [new DocxExtractor({
        convertToHtml: async (_input, options?: MockMammothOptions) => {
          const convertImage = readMockConvertImage(options)
          const first = await convertImage?.(mockDocxImage("image/jpeg", "first")) ?? []
          const second = await convertImage?.(mockDocxImage("image/png", "second")) ?? []
          return {
            value: `<h1>Quarterly Report</h1>${renderMockImageNodes([...first, ...second])}<p>Body</p>`,
            messages: [],
          }
        },
      })],
    })

    const result = await service.convert({
      filePath,
      imageHandling: { mode: "assets", assetDirectoryName: "report.assets" },
    })

    expect(result.markdown).toContain("![](./report.assets/image-1.jpeg)")
    expect(result.markdown).toContain("![](./report.assets/image-2.png)")
    expect(result.markdown).not.toContain("data:image")
    expect(result.assets).toEqual([
      {
        relativePath: "report.assets/image-1.jpeg",
        fileName: "image-1.jpeg",
        mimeType: "image/jpeg",
        content: Buffer.from("first"),
      },
      {
        relativePath: "report.assets/image-2.png",
        fileName: "image-2.png",
        mimeType: "image/png",
        content: Buffer.from("second"),
      },
    ])
    expect(result.warnings).toEqual([])
  })

  it("drops unexpected data URI images from converted DOCX HTML", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "report.docx")
    await writeFile(filePath, "docx")
    const service = new FileConversionService({
      extractors: [new DocxExtractor({
        convertToHtml: async () => ({
          value: '<h1>Quarterly Report</h1><p>Body</p><img src="data:image/png;base64,YWJj" />',
          messages: [],
        }),
      })],
    })

    const result = await service.convert({ filePath })

    expect(result.markdown).toContain("# Quarterly Report")
    expect(result.markdown).toContain("Body")
    expect(result.markdown).not.toContain("data:image")
    expect(result.markdown).not.toContain("![](")
  })

  it("converts xlsx workbooks into markdown tables", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "budget.xlsx")
    const XLSX = await import("xlsx")
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Department", "Budget"],
      ["Product", 120000],
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, "Summary")
    XLSX.writeFile(workbook, filePath)
    const service = new FileConversionService({ extractors: [new XlsxExtractor()] })

    const result = await service.convert({ filePath })

    expect(result.format).toBe("xlsx")
    expect(result.kind).toBe("spreadsheet")
    expect(result.markdown).toContain("## Sheet: Summary")
    expect(result.markdown).toContain("| Product | 120000 |")
    expect(result.metadata).toEqual({ sheetNames: ["Summary"] })
  })

  it("converts pdf parser output into pdf markdown", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "paper.pdf")
    await writeFile(filePath, "pdf")
    const service = new FileConversionService({
      extractors: [new PdfExtractor({
        parsePdf: async () => ({
          text: "PDF body",
          numpages: 2,
          info: { Title: "Paper Title" },
        }),
      })],
    })

    const result = await service.convert({ filePath })

    expect(result).toMatchObject({
      format: "pdf",
      kind: "pdf",
      title: "Paper Title",
      text: "PDF body",
      metadata: { pages: 2, info: { Title: "Paper Title" } },
    })
    expect(result.markdown).toContain("# Paper Title")
  })

  it("converts pptx parser output into presentation markdown", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "deck.pptx")
    await writeFile(filePath, "pptx")
    const service = new FileConversionService({
      extractors: [new PptxExtractor({
        parseOffice: async () => "Slide one\nSlide two",
      })],
    })

    const result = await service.convert({ filePath })

    expect(result).toMatchObject({
      format: "pptx",
      kind: "presentation",
      title: "deck.pptx",
      text: "Slide one\nSlide two",
    })
    expect(result.markdown).toContain("## Slides")
    expect(result.warnings).toEqual([{
      code: "presentation_structure_limited",
      message: "Slide boundaries were not fully available from the parser.",
    }])
  })
})

describe("file conversion contract", () => {
  it("exports supported file formats and structured errors", () => {
    const format: FileConversionFormat = "docx"
    const result: FileConversionResult = {
      sourcePath: "/tmp/report.docx",
      format,
      kind: "document",
      title: "report.docx",
      markdown: "# report.docx\n",
      text: "report.docx",
      metadata: {},
      warnings: [],
    }
    const error = new FileConversionError("unsupported_format", "Unsupported file format")

    expect(result.format).toBe("docx")
    expect(error.code).toBe("unsupported_format")
  })
})

describe("FileConversionService", () => {
  it("rejects unsupported extensions with a structured error", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "archive.zip")
    await writeFile(filePath, "not supported")
    const service = new FileConversionService({ extractors: [] })

    await expect(service.convert({ filePath })).rejects.toMatchObject({ code: "unsupported_format" })
  })

  it("uses the registered extractor for a supported format", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "note.docx")
    await writeFile(filePath, "docx")
    const service = new FileConversionService({
      extractors: [{
        formats: ["docx"],
        extract: async (input) => ({
          sourcePath: input.filePath,
          format: "docx",
          kind: "document",
          title: "note.docx",
          markdown: "# note.docx\n",
          text: "note",
          metadata: {},
          warnings: [],
        }),
      }],
    })

    await expect(service.convert({ filePath })).resolves.toMatchObject({
      sourcePath: filePath,
      format: "docx",
      kind: "document",
    })
  })

  it("uses the registered extractor for image formats", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "receipt.png")
    await writeFile(filePath, "png")
    const service = new FileConversionService({
      extractors: [{
        formats: ["png"],
        extract: async (input) => ({
          sourcePath: input.filePath,
          format: "png",
          kind: "image",
          title: "receipt.png",
          markdown: "# receipt.png\n\ncustom image extractor\n",
          text: "custom image extractor",
          metadata: { custom: true },
          warnings: [],
        }),
      }],
    })

    await expect(service.convert({ filePath })).resolves.toMatchObject({
      sourcePath: filePath,
      format: "png",
      kind: "image",
      text: "custom image extractor",
      metadata: { custom: true },
    })
  })
})

type MockMammothOptions = {
  readonly convertImage?: unknown
}

type MockConvertImage = (image: MockDocxImage) => Promise<readonly MockImageNode[]>

type MockDocxImage = {
  readonly contentType: string
  readAsBase64String(): Promise<string>
}

type MockImageNode = {
  readonly tag?: {
    readonly attributes?: {
      readonly src?: string
    }
  }
}

function readMockConvertImage(options: MockMammothOptions | undefined): MockConvertImage | undefined {
  return typeof options?.convertImage === "function"
    ? options.convertImage as MockConvertImage
    : undefined
}

function mockDocxImage(contentType: string, content: string): MockDocxImage {
  return {
    contentType,
    readAsBase64String: async () => Buffer.from(content).toString("base64"),
  }
}

function renderMockImageNodes(nodes: readonly MockImageNode[]): string {
  return nodes
    .map((node) => node.tag?.attributes?.src)
    .filter((src): src is string => typeof src === "string")
    .map((src) => `<img src="${src}" />`)
    .join("")
}
