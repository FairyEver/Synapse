import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createDefaultFileConversionService } from "../index"
import { buildFileConversionFixtures } from "./fixtures/build-fixtures"

const roots: string[] = []
const maxFixtureBytes = 1_000_000

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-conversion-fixtures-"))
  roots.push(dir)
  return dir
}

async function expectSmallFile(filePath: string): Promise<Buffer> {
  const data = await readFile(filePath)
  expect(data.byteLength).toBeGreaterThan(0)
  expect(data.byteLength).toBeLessThanOrEqual(maxFixtureBytes)
  return data
}

function expectSignature(data: Buffer, signature: string): void {
  expect(data.subarray(0, signature.length).equals(Buffer.from(signature))).toBe(true)
}

function expectNoSignature(data: Buffer, signature: string): void {
  expect(data.subarray(0, signature.length).equals(Buffer.from(signature))).toBe(false)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("file conversion fixture builders", () => {
  it("creates real fixture files for each stage 2 format", async () => {
    const root = await tempDir()

    const fixtures = await buildFileConversionFixtures(root)

    expect(fixtures.docxBasic.endsWith(path.join("docx", "basic.docx"))).toBe(true)
    expect(fixtures.docxTable.endsWith(path.join("docx", "table.docx"))).toBe(true)
    expect(fixtures.xlsxMultiSheet.endsWith(path.join("xlsx", "multi-sheet.xlsx"))).toBe(true)
    expect(fixtures.xlsxWideSheet.endsWith(path.join("xlsx", "wide-sheet.xlsx"))).toBe(true)
    expect(fixtures.pdfText.endsWith(path.join("pdf", "text.pdf"))).toBe(true)
    expect(fixtures.pptxBasic.endsWith(path.join("pptx", "basic.pptx"))).toBe(true)
    expect(fixtures.malformedDocx.endsWith(path.join("malformed", "broken.docx"))).toBe(true)
    expect(fixtures.malformedPdf.endsWith(path.join("malformed", "broken.pdf"))).toBe(true)

    const docxBasic = await expectSmallFile(fixtures.docxBasic)
    const docxTable = await expectSmallFile(fixtures.docxTable)
    const xlsxMultiSheet = await expectSmallFile(fixtures.xlsxMultiSheet)
    const xlsxWideSheet = await expectSmallFile(fixtures.xlsxWideSheet)
    const pdfText = await expectSmallFile(fixtures.pdfText)
    const pptxBasic = await expectSmallFile(fixtures.pptxBasic)
    const malformedDocx = await expectSmallFile(fixtures.malformedDocx)
    const malformedPdf = await expectSmallFile(fixtures.malformedPdf)

    expectSignature(docxBasic, "PK")
    expectSignature(docxTable, "PK")
    expectSignature(xlsxMultiSheet, "PK")
    expectSignature(xlsxWideSheet, "PK")
    expectSignature(pptxBasic, "PK")
    expectSignature(pdfText, "%PDF")
    expectNoSignature(malformedDocx, "PK")
    expectNoSignature(malformedPdf, "%PDF")
  })
})

describe("file conversion real DOCX fixtures", () => {
  it("preserves docx headings and paragraphs as markdown", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.docxBasic })

    expect(result.format).toBe("docx")
    expect(result.kind).toBe("document")
    expect(result.text).toContain("Quarterly Review")
    expect(result.text).toContain("Revenue grew 12 percent.")
    expect(result.markdown).toContain("# Quarterly Review")
  })

  it("preserves docx table content in markdown", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.docxTable })

    expect(result.markdown).toContain("Budget Table")
    expect(result.markdown).toContain("Department")
    expect(result.markdown).toContain("Product")
    expect(result.markdown).toContain("120000")
  })
})

describe("file conversion real XLSX fixtures", () => {
  it("renders each xlsx sheet as a markdown section", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.xlsxMultiSheet })

    expect(result.format).toBe("xlsx")
    expect(result.kind).toBe("spreadsheet")
    expect(result.markdown).toContain("## Sheet: Summary")
    expect(result.markdown).toContain("## Sheet: Risks")
    expect(result.markdown).toContain("| Department | Budget | Date |")
    expect(result.markdown).toContain("| APAC | Renewal delay |")
  })

  it("truncates wide xlsx sheets with a warning", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.xlsxWideSheet })

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "xlsx_truncated" }),
    ]))
    expect(result.markdown).toContain("Column 30")
    expect(result.markdown).not.toContain("Column 31")
  })
})

describe("file conversion real PDF fixtures", () => {
  it("extracts text and metadata from a real pdf fixture", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.pdfText })

    expect(result.format).toBe("pdf")
    expect(result.kind).toBe("pdf")
    expect(result.text).toContain("Quarterly Review PDF")
    expect(result.text).toContain("Page two renewal risk in APAC.")
    expect(result.metadata.pages).toEqual(expect.any(Number))
    expect(result.metadata.pages as number).toBeGreaterThanOrEqual(2)
    expect(result.markdown).toContain("# text.pdf")
  })
})

describe("file conversion real PPTX fixtures", () => {
  it("extracts text from a real pptx fixture", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.pptxBasic })

    expect(result.format).toBe("pptx")
    expect(result.kind).toBe("presentation")
    expect(result.text).toContain("Quarterly Review Deck")
    expect(result.text).toContain("Revenue expansion")
    expect(result.text).toContain("Renewal delay in APAC.")
    expect(result.markdown).toContain("# basic.pptx")
  })
})
