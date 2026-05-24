import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  DragonScaleBoundaryService,
  type DragonScaleBoundaryScoreReport,
} from "../index"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-boundary-"))
  roots.push(dir)
  return dir
}

async function writePage(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, ...relativePath.split("/"))
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("DragonScaleBoundaryService", () => {
  it("is exported from the knowledge-base barrel", () => {
    expect(DragonScaleBoundaryService).toBeDefined()
    const report: DragonScaleBoundaryScoreReport = {
      generated: "2026-05-24T00:00:00Z",
      halflifeDays: 30,
      pageCountScoreable: 0,
      results: [],
    }
    expect(report.results).toEqual([])
  })

  it("returns an empty report for a missing wiki without writing vault files", async () => {
    const root = await tempDir()
    const service = new DragonScaleBoundaryService()

    const result = await service.score(root, { today: "2026-05-24" })

    expect(result).toMatchObject({
      halflifeDays: 30,
      pageCountScoreable: 0,
      results: [],
    })
    await expect(pathExists(path.join(root, ".vault-meta"))).resolves.toBe(false)
    await expect(pathExists(path.join(root, "wiki", "meta"))).resolves.toBe(false)
  })

  it("collects scoreable pages and excludes system, meta, fold, symlink, and oversized pages", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\nupdated: 2026-05-24\n---\n\n[[Beta]]\n")
    await writePage(root, "wiki/concepts/Beta.md", "---\ntype: concept\nupdated: 2026-05-24\n---\n\n# Beta\n")
    await writePage(root, "wiki/hot.md", "# Hot\n\n[[Beta]]\n")
    await writePage(root, "wiki/index.md", "# Index\n")
    await writePage(root, "wiki/meta/Report.md", "---\ntype: concept\n---\n\n[[Beta]]\n")
    await writePage(root, "wiki/folds/Fold.md", "---\ntype: concept\n---\n\n[[Beta]]\n")
    await writePage(root, "wiki/concepts/MetaByType.md", "---\ntype: meta\n---\n\n[[Beta]]\n")
    await writePage(root, "wiki/concepts/TooLarge.md", `${"x".repeat(256 * 1024 + 1)}\n`)
    await writePage(outside, "Outside.md", "[[Beta]]\n")
    await symlink(path.join(outside, "Outside.md"), path.join(root, "wiki", "concepts", "Outside.md"))

    const result = await new DragonScaleBoundaryService().score(root, {
      includeScoreZero: true,
      today: "2026-05-24",
    })

    expect(result.pageCountScoreable).toBe(2)
    expect(result.results.map((item) => item.path).sort()).toEqual([
      "wiki/concepts/Alpha.md",
      "wiki/concepts/Beta.md",
    ])
  })

  it("computes graph degrees from Obsidian wikilinks", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", [
      "---",
      "type: concept",
      "updated: 2026-05-24",
      "---",
      "",
      "[[Beta]] [[Beta|alias]] [[folder/Beta#Heading]] [[Missing]] [[Alpha]]",
      "    [[Gamma]]",
      "```",
      "[[Gamma]]",
      "```",
      "~~~",
      "[[Gamma]]",
      "~~~",
      "",
    ].join("\n"))
    await writePage(root, "wiki/concepts/Beta.md", "---\ntype: concept\nupdated: 2026-05-24\n---\n\n[[Gamma]]\n")
    await writePage(root, "wiki/concepts/Gamma.md", "---\ntype: concept\nupdated: 2026-05-24\n---\n\n# Gamma\n")

    const result = await new DragonScaleBoundaryService().score(root, {
      includeScoreZero: true,
      today: "2026-05-24",
    })

    expect(result.results).toEqual([
      expect.objectContaining({ titleKey: "Alpha", outDegree: 2, inDegree: 0, score: 2 }),
      expect.objectContaining({ titleKey: "Beta", outDegree: 1, inDegree: 1, score: 0 }),
      expect.objectContaining({ titleKey: "Gamma", outDegree: 0, inDegree: 2, score: -2 }),
    ])
  })

  it("uses updated before created and filters non-positive scores by default", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Fresh.md", [
      "---",
      "type: concept",
      "title: Fresh Frontier",
      "created: 2026-04-01",
      "updated: 2026-05-24",
      "---",
      "",
      "[[Hub]]",
      "",
    ].join("\n"))
    await writePage(root, "wiki/concepts/Stale.md", "---\ntype: concept\ncreated: 2026-04-24\n---\n\n[[Hub]]\n")
    await writePage(root, "wiki/concepts/Hub.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Hub\n")

    const result = await new DragonScaleBoundaryService().score(root, { today: "2026-05-24" })

    expect(result.results).toEqual([
      expect.objectContaining({
        title: "Fresh Frontier",
        titleKey: "Fresh",
        ageDays: 0,
        recencyWeight: 1,
        score: 1,
      }),
      expect.objectContaining({
        titleKey: "Stale",
        ageDays: 30,
        recencyWeight: 0.3679,
        score: 0.3679,
      }),
    ])
  })

  it("includes zero and negative scores when requested", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n[[Beta]]\n")
    await writePage(root, "wiki/concepts/Beta.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Beta\n")
    await writePage(root, "wiki/concepts/Zero.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Zero\n")

    const result = await new DragonScaleBoundaryService().score(root, {
      includeScoreZero: true,
      today: "2026-05-24",
    })

    expect(result.results.map((item) => ({ key: item.titleKey, score: item.score }))).toEqual([
      { key: "Alpha", score: 1 },
      { key: "Zero", score: 0 },
      { key: "Beta", score: -1 },
    ])
  })

  it("limits default results to the top ten positive pages", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Hub.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Hub\n")
    for (let i = 0; i < 12; i += 1) {
      await writePage(root, `wiki/concepts/Page${String(i).padStart(2, "0")}.md`, [
        "---",
        "type: concept",
        "created: 2026-05-24",
        "---",
        "",
        "[[Hub]]",
        "",
      ].join("\n"))
    }

    const result = await new DragonScaleBoundaryService().score(root, { today: "2026-05-24" })

    expect(result.results).toHaveLength(10)
    expect(result.results[0]?.titleKey).toBe("Page00")
    expect(result.results.at(-1)?.titleKey).toBe("Page09")
  })

  it("matches a single page by stem or relative path", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n[[Beta]]\n")
    await writePage(root, "wiki/concepts/Beta.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Beta\n")
    const service = new DragonScaleBoundaryService()

    await expect(service.score(root, { page: "Alpha", today: "2026-05-24" }))
      .resolves.toMatchObject({ results: [expect.objectContaining({ titleKey: "Alpha" })] })
    await expect(service.score(root, { page: "wiki/concepts/Beta.md", today: "2026-05-24" }))
      .resolves.toMatchObject({ results: [expect.objectContaining({ titleKey: "Beta" })] })
  })

  it("rejects invalid top and unmatched page filters", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\n# Alpha\n")
    const service = new DragonScaleBoundaryService()

    await expect(service.score(root, { top: 0 })).rejects.toThrow("top must be >= 1")
    await expect(service.score(root, { page: "Missing" })).rejects.toThrow("No scoreable DragonScale page")
  })

  it("uses the later sorted path for duplicate stems to match upstream behavior", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/a/Dupe.md", "---\ntype: concept\ntitle: First\ncreated: 2026-05-24\n---\n\n# First\n")
    await writePage(root, "wiki/z/Dupe.md", "---\ntype: concept\ntitle: Second\ncreated: 2026-05-24\n---\n\n# Second\n")

    const result = await new DragonScaleBoundaryService().score(root, {
      includeScoreZero: true,
      today: "2026-05-24",
    })

    expect(result.pageCountScoreable).toBe(1)
    expect(result.results).toEqual([
      expect.objectContaining({ title: "Second", path: "wiki/z/Dupe.md" }),
    ])
  })

  it("skips invalid utf8 without failing the scan", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Valid.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Valid\n")
    const invalidPath = path.join(root, "wiki", "concepts", "Invalid.md")
    await writeFile(invalidPath, Buffer.from([0xff, 0xfe, 0xfd]))

    const result = await new DragonScaleBoundaryService().score(root, {
      includeScoreZero: true,
      today: "2026-05-24",
    })

    expect(result.results.map((item) => item.titleKey)).toEqual(["Valid"])
  })

  it("does not write reports or metadata while scoring", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Alpha\n")

    await new DragonScaleBoundaryService().score(root, { includeScoreZero: true, today: "2026-05-24" })

    await expect(pathExists(path.join(root, ".vault-meta"))).resolves.toBe(false)
    await expect(pathExists(path.join(root, "wiki", "meta"))).resolves.toBe(false)
    await expect(readFile(path.join(root, "wiki", "concepts", "Alpha.md"), "utf8"))
      .resolves.toBe("---\ntype: concept\ncreated: 2026-05-24\n---\n\n# Alpha\n")
  })
})
