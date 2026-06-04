import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  resolveUniqueMarkdownOutputBundle,
  resolveUniqueMarkdownOutputPath,
  writeMarkdownOutputBundle,
} from "../file-conversion-output"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-tools-output-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("resolveUniqueMarkdownOutputPath", () => {
  it("uses the source basename with markdown extension", async () => {
    const root = await tempDir()

    await expect(resolveUniqueMarkdownOutputPath(root, "/tmp/report.docx"))
      .resolves.toBe(path.join(root, "report.md"))
  })

  it("adds numeric suffixes for existing and reserved outputs", async () => {
    const root = await tempDir()
    await writeFile(path.join(root, "report.md"), "# Existing\n")
    await writeFile(path.join(root, "report-2.md"), "# Existing\n")

    await expect(resolveUniqueMarkdownOutputPath(
      root,
      "/tmp/report.pdf",
      new Set([path.join(root, "report-3.md")]),
    )).resolves.toBe(path.join(root, "report-4.md"))
  })
})

describe("resolveUniqueMarkdownOutputBundle", () => {
  it("uses matching markdown and assets names from the source basename", async () => {
    const root = await tempDir()

    await expect(resolveUniqueMarkdownOutputBundle(root, "/tmp/report.docx"))
      .resolves.toEqual({
        markdownPath: path.join(root, "report.md"),
        assetDirectoryPath: path.join(root, "report.assets"),
        assetDirectoryName: "report.assets",
      })
  })

  it("skips a basename when either markdown or assets path already exists", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "report.assets"))

    await expect(resolveUniqueMarkdownOutputBundle(root, "/tmp/report.docx"))
      .resolves.toEqual({
        markdownPath: path.join(root, "report-2.md"),
        assetDirectoryPath: path.join(root, "report-2.assets"),
        assetDirectoryName: "report-2.assets",
      })
  })

  it("keeps same-batch files from sharing an assets directory", async () => {
    const root = await tempDir()
    const reserved = new Set<string>()

    const first = await resolveUniqueMarkdownOutputBundle(root, "/tmp/a/report.docx", reserved)
    reserved.add(first.markdownPath)
    reserved.add(first.assetDirectoryPath)
    const second = await resolveUniqueMarkdownOutputBundle(root, "/tmp/b/report.pdf", reserved)

    expect(first.assetDirectoryPath).toBe(path.join(root, "report.assets"))
    expect(second.assetDirectoryPath).toBe(path.join(root, "report-2.assets"))
  })
})

describe("writeMarkdownOutputBundle", () => {
  it("writes markdown and assets under the bundle-specific assets directory", async () => {
    const root = await tempDir()
    const bundle = await resolveUniqueMarkdownOutputBundle(root, "/tmp/report.docx")

    await writeMarkdownOutputBundle(bundle, "# Report", [{
      relativePath: "report.assets/image-1.jpeg",
      fileName: "image-1.jpeg",
      mimeType: "image/jpeg",
      content: Buffer.from("image"),
    }])

    await expect(readFile(bundle.markdownPath, "utf8")).resolves.toBe("# Report\n")
    await expect(readFile(path.join(bundle.assetDirectoryPath, "image-1.jpeg"))).resolves.toEqual(Buffer.from("image"))
  })
})
