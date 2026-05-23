import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { FileConversionService, PdfExtractor } from "../index"

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
