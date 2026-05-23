import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  insertAddressIntoWikiPage,
  readAddressedWikiPages,
} from "../wiki-page-addresses"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-pages-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("wiki page address helpers", () => {
  it("finds eligible pages and excludes meta pages", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await mkdir(path.join(root, "wiki", "meta"), { recursive: true })
    await writeFile(path.join(root, "wiki", "concepts", "Alpha.md"), "---\ntype: concept\n---\n\n# Alpha\n")
    await writeFile(path.join(root, "wiki", "hot.md"), "# Hot\n")
    await writeFile(path.join(root, "wiki", "meta", "Report.md"), "# Report\n")

    const pages = await readAddressedWikiPages(root)

    expect(pages.map((page) => page.relativePath)).toEqual(["wiki/concepts/Alpha.md"])
  })

  it("reads existing addresses from frontmatter", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "entities"), { recursive: true })
    await writeFile(path.join(root, "wiki", "entities", "Team.md"), "---\ntype: entity\naddress: c-000009\n---\n\n# Team\n")

    const pages = await readAddressedWikiPages(root)

    expect(pages).toEqual([expect.objectContaining({
      relativePath: "wiki/entities/Team.md",
      address: "c-000009",
      eligible: true,
    })])
  })

  it("does not include pre-rollout legacy pages", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await writeFile(path.join(root, "wiki", "concepts", "Legacy.md"), "---\ntype: concept\ncreated: 2026-04-01\n---\n\n# Legacy\n")

    await expect(readAddressedWikiPages(root)).resolves.toEqual([])
  })

  it("inserts an address into existing frontmatter", async () => {
    const root = await tempDir()
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\ntitle: Alpha\n---\n\n# Alpha\n")

    await insertAddressIntoWikiPage(pagePath, "c-000010")

    await expect(readFile(pagePath, "utf8")).resolves.toBe("---\ntype: concept\ntitle: Alpha\naddress: c-000010\n---\n\n# Alpha\n")
  })

  it("inserts minimal frontmatter when a page has none", async () => {
    const root = await tempDir()
    const pagePath = path.join(root, "wiki", "sources", "Note.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "# Note\n")

    await insertAddressIntoWikiPage(pagePath, "c-000011")

    await expect(readFile(pagePath, "utf8")).resolves.toBe("---\naddress: c-000011\n---\n\n# Note\n")
  })

  it("skips symlinked pages", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await writeFile(path.join(outside, "Outside.md"), "# Outside\n")
    await symlink(path.join(outside, "Outside.md"), path.join(root, "wiki", "concepts", "Outside.md"))

    await expect(readAddressedWikiPages(root)).resolves.toEqual([])
  })
})
