import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { buildFileConversionFixtures } from "./fixtures/build-fixtures"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-conversion-fixtures-"))
  roots.push(dir)
  return dir
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
  })
})
