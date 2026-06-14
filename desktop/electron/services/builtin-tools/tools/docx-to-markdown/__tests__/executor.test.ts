import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  convert: vi.fn(),
}))

vi.mock("../../../../file-conversion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../file-conversion")>()
  return {
    ...actual,
    createDefaultFileConversionService: () => ({ convert: mocks.convert }),
  }
})

import { executeDocxToMarkdown } from "../executor"

describe("docx-to-markdown executor", () => {
  beforeEach(() => {
    mocks.convert.mockReset()
  })

  it("rejects non-docx input", async () => {
    await expect(executeDocxToMarkdown({
      inputPath: "/tmp/source.pdf",
      outputMode: "return",
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
      code: "unsupported_input",
    })
  })

  it("writes DOCX image links to the resolved asset directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-docx-md-"))
    const inputPath = path.join(root, "report.docx")
    const outputDirectory = path.join(root, "out")
    await writeFile(inputPath, "docx")
    mocks.convert.mockImplementation(async (input: {
      imageHandling?: { assetDirectoryName?: string }
    }) => {
      const assetDirectoryName = input.imageHandling?.assetDirectoryName ?? "assets"
      return {
        markdown: `# Report\n\n![](./${assetDirectoryName}/image-1.jpeg)`,
        text: "Report",
        sourcePath: inputPath,
        assets: [{
          relativePath: `${assetDirectoryName}/image-1.jpeg`,
          fileName: "image-1.jpeg",
          mimeType: "image/jpeg",
          content: Buffer.from("image-bytes"),
        }],
        metadata: {},
        warnings: [],
      }
    })

    const result = await executeDocxToMarkdown({
      inputPath,
      outputDirectory,
      outputMode: "write-file",
    }, { entryPoint: "tools", actor: { kind: "user" } })

    expect(mocks.convert).toHaveBeenCalledWith(expect.objectContaining({
      imageHandling: { mode: "assets", assetDirectoryName: "report.assets" },
    }))
    expect(result.outputPath).toBe(path.join(outputDirectory, "report.md"))
    await expect(readFile(path.join(outputDirectory, "report.md"), "utf8"))
      .resolves.toContain("![](./report.assets/image-1.jpeg)")
    await expect(readFile(path.join(outputDirectory, "report.assets", "image-1.jpeg"), "utf8"))
      .resolves.toBe("image-bytes")
  })
})
