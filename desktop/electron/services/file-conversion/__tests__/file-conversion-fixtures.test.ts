import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

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

    expect(fixtures.docxBasic.endsWith("docx/basic.docx")).toBe(true)
    expect(fixtures.docxTable.endsWith("docx/table.docx")).toBe(true)
    expect(fixtures.xlsxMultiSheet.endsWith("xlsx/multi-sheet.xlsx")).toBe(true)
    expect(fixtures.xlsxWideSheet.endsWith("xlsx/wide-sheet.xlsx")).toBe(true)
    expect(fixtures.pdfText.endsWith("pdf/text.pdf")).toBe(true)
    expect(fixtures.pptxBasic.endsWith("pptx/basic.pptx")).toBe(true)
    expect(fixtures.malformedDocx.endsWith("malformed/broken.docx")).toBe(true)
    expect(fixtures.malformedPdf.endsWith("malformed/broken.pdf")).toBe(true)

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
