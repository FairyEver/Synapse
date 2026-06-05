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
    const sourceRoot = await makeTempDirectory("synapse-kb-image-source-")
    const imagePath = path.join(sourceRoot, "source.png")
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
    expect(intake).toContain('original_file: "_attachments/images/2026/05/24/source.png"')
    expect(intake).toContain('attachment: "_attachments/images/2026/05/24/source.png"')
    expect(intake).toContain('source_format: "png"')
    expect(intake).not.toContain(sourceRoot)
    expect(intake).not.toContain(sourceRoot.replaceAll("\\", "\\\\"))
  })

  it("quotes image intake frontmatter fields that may contain YAML delimiters", async () => {
    const root = await makeTempKnowledgeBase()
    const imageName = process.platform === "win32" ? "report #1" : "report:final #1"
    const imagePath = path.join(root, `${imageName}.png`)
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
    expect(result.uploaded[0]?.relativePath).toBe(`.raw/images/2026/05/24/${imageName}.md`)

    const intake = await readFile(path.join(root, `.raw/images/2026/05/24/${imageName}.md`), "utf8")
    expect(intake).toContain(`title: "${imageName}"`)
    expect(intake).toContain(`attachment: "_attachments/images/2026/05/24/${imageName}.png"`)
    expect(intake).toContain('source_format: "png"')
  })
})

async function makeTempKnowledgeBase(): Promise<string> {
  return makeTempDirectory("synapse-kb-image-")
}

async function makeTempDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}
