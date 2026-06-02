import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { stageKnowledgeBaseSources } from "../source-staging"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("stageKnowledgeBaseSources image intake", () => {
  it("copies image originals to attachments and creates immutable raw intake records", async () => {
    const root = await makeTempKnowledgeBase()
    const imagePath = path.join(root, "source.png")
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await stageKnowledgeBaseSources({
      projectPath: root,
      filePaths: [imagePath],
      now: () => new Date("2026-05-24T10:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error("converter should not be called for images")
        },
      },
    })

    expect(result.skipped).toEqual([])
    expect(result.uploaded).toHaveLength(1)
    expect(result.uploaded[0]?.relativePath).toBe(".raw/images/2026/05/24/source.md")
    expect(result.uploaded[0]?.originalRelativePath).toBe("_attachments/images/2026/05/24/source.png")

    const intake = await readFile(path.join(root, ".raw/images/2026/05/24/source.md"), "utf8")
    expect(intake).toContain("source_type: image")
    expect(intake).toContain('attachment: "_attachments/images/2026/05/24/source.png"')
    expect(intake).toContain('source_format: "png"')
  })

  it("quotes image intake frontmatter fields that may contain YAML delimiters", async () => {
    const root = await makeTempKnowledgeBase()
    const imagePath = path.join(root, "report:final #1.png")
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await stageKnowledgeBaseSources({
      projectPath: root,
      filePaths: [imagePath],
      now: () => new Date("2026-05-24T10:00:00.000Z"),
      converter: {
        convert: async () => {
          throw new Error("converter should not be called for images")
        },
      },
    })

    expect(result.skipped).toEqual([])
    expect(result.uploaded[0]?.relativePath).toBe(".raw/images/2026/05/24/report:final #1.md")

    const intake = await readFile(path.join(root, ".raw/images/2026/05/24/report:final #1.md"), "utf8")
    expect(intake).toContain('title: "report:final #1"')
    expect(intake).toContain('attachment: "_attachments/images/2026/05/24/report:final #1.png"')
    expect(intake).toContain('source_format: "png"')
  })
})

async function makeTempKnowledgeBase(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-image-"))
  roots.push(root)
  return root
}
