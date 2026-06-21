import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { readKnowledgeBaseManifest } from "../manifest"
import { scanKnowledgeBaseSources } from "../source-scan"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-scan-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base source scan", () => {
  it("classifies new, changed, unchanged, and skipped raw sources", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw", "notes"), { recursive: true })
    await writeFile(path.join(root, ".raw", "a.md"), "alpha\n")
    await writeFile(path.join(root, ".raw", "notes", "b.txt"), "bravo\n")
    await writeFile(path.join(root, ".raw", ".gitkeep"), "")
    await writeFile(path.join(root, ".raw", "skip.png"), "not text")

    const initial = await scanKnowledgeBaseSources(root)
    const unchanged = initial.sources.find((source) => source.relativePath === ".raw/a.md")
    if (!unchanged) throw new Error("expected a.md")

    await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      sources: {
        ".raw/a.md": {
          hash: unchanged.hash,
          ingested_at: "2026-05-21T00:00:00.000Z",
          pages_created: ["wiki/sources/a.md"],
          pages_updated: ["wiki/index.md"],
        },
        ".raw/notes/b.txt": {
          hash: "old-hash",
          ingested_at: "2026-05-21T00:00:00.000Z",
          pages_created: [],
          pages_updated: [],
        },
      },
    }, null, 2)}\n`)

    const result = await scanKnowledgeBaseSources(root)

    expect(result.manifest.status).toBe("valid")
    expect(result.sources.map((source) => [source.relativePath, source.state])).toEqual([
      [".raw/a.md", "unchanged"],
      [".raw/notes/b.txt", "changed"],
    ])
    expect(result.skippedSources).toEqual([
      expect.objectContaining({ relativePath: ".raw/skip.png", reason: "unsupported-extension" }),
    ])
    expect(result.sources.some((source) => source.relativePath === ".raw/.gitkeep")).toBe(false)
    expect(result.skippedSources.some((source) => source.relativePath === ".raw/.gitkeep")).toBe(false)
  })

  it("marks matching sources as changed when force is true", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "a.md"), "alpha\n")
    const initial = await scanKnowledgeBaseSources(root)
    const source = initial.sources[0]
    await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      sources: {
        [source.relativePath]: {
          hash: source.hash,
          ingested_at: "2026-05-21T00:00:00.000Z",
          pages_created: [],
          pages_updated: [],
        },
      },
    })}\n`)

    const result = await scanKnowledgeBaseSources(root, { force: true })

    expect(result.sources).toEqual([
      expect.objectContaining({ relativePath: ".raw/a.md", state: "changed" }),
    ])
  })

  it("preserves knowledge base manifest metadata and raw-relative source entries", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "a.md"), "alpha\n")
    const initial = await scanKnowledgeBaseSources(root)
    const source = initial.sources[0]
    await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      created: "2026-05-23",
      description: "Ingest delta tracker and address map for the Synapse knowledge base.",
      sources: {
        [source.relativePath]: {
          hash: source.hash,
        },
      },
      address_map: {
        "wiki/sources/a.md": "c-000001",
      },
    })}\n`)

    const result = await scanKnowledgeBaseSources(root)

    expect(result.manifest.status).toBe("valid")
    expect(result.manifest.manifest.sources).toEqual({
      ".raw/a.md": { hash: source.hash },
    })
    expect(result.manifest.manifest.created).toBe("2026-05-23")
    expect(result.manifest.manifest.description).toContain("Ingest delta tracker")
    expect(result.manifest.manifest.address_map).toEqual({
      "wiki/sources/a.md": "c-000001",
    })
    expect(result.sources).toEqual([
      expect.objectContaining({ relativePath: ".raw/a.md", state: "unchanged" }),
    ])
  })

  it("does not treat legacy string hash entries as imported sources", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "a.md"), "alpha\n")
    const initial = await scanKnowledgeBaseSources(root)
    const source = initial.sources[0]
    await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      sources: {
        "a.md": source.hash,
      },
      address_map: {},
    })}\n`)

    const result = await scanKnowledgeBaseSources(root)

    expect(result.sources).toEqual([
      expect.objectContaining({ relativePath: ".raw/a.md", state: "new" }),
    ])
  })

  it("reports invalid manifests without throwing", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", ".manifest.json"), "{ bad json")

    const result = await readKnowledgeBaseManifest(root)

    expect(result.status).toBe("invalid")
    if (result.status !== "invalid") throw new Error("expected invalid manifest")
    expect(result.error).toContain("JSON")
  })

  it("does not traverse a symlinked raw directory", async () => {
    const root = await tempDir()
    const outsideRoot = await tempDir()
    await writeFile(path.join(outsideRoot, "outside.md"), "outside\n")
    await symlink(outsideRoot, path.join(root, ".raw"), "dir")

    const result = await scanKnowledgeBaseSources(root)

    expect(result.sources).toEqual([])
    expect(result.skippedSources).toEqual([
      { relativePath: ".raw", reason: "symlink" },
    ])
  })

  it("reports raw directory read errors instead of hiding them", async () => {
    const root = await tempDir()
    await writeFile(path.join(root, ".raw"), "not a directory")

    const result = await scanKnowledgeBaseSources(root)

    expect(result.sources).toEqual([])
    expect(result.skippedSources).toEqual([
      { relativePath: ".raw", reason: "read-error" },
    ])
  })

  it("skips supported raw sources above the per-file size limit", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "large.md"), "alpha bravo\n")

    const result = await scanKnowledgeBaseSources(root, { maxSourceBytes: 5 })

    expect(result.sources).toEqual([])
    expect(result.skippedSources).toEqual([
      { relativePath: ".raw/large.md", reason: "too-large" },
    ])
  })

  it("skips supported raw sources after the total scan size limit is reached", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "a.md"), "alpha")
    await writeFile(path.join(root, ".raw", "b.md"), "bravo")

    const result = await scanKnowledgeBaseSources(root, { maxScanBytes: 6 })

    expect(result.sources.map((source) => source.relativePath)).toEqual([".raw/a.md"])
    expect(result.skippedSources).toEqual([
      { relativePath: ".raw/b.md", reason: "scan-size-limit" },
    ])
  })

  it("stops raw source discovery when the entry budget is exhausted", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "a.md"), "alpha")
    await writeFile(path.join(root, ".raw", "b.md"), "bravo")
    await writeFile(path.join(root, ".raw", "c.md"), "charlie")

    const result = await scanKnowledgeBaseSources(root, { maxDiscoveryEntries: 2 })

    expect(result.sources.length).toBeLessThanOrEqual(2)
    expect(result.skippedSources).toContainEqual(expect.objectContaining({
      relativePath: expect.stringMatching(/^\.raw\/[abc]\.md$/),
      reason: "scan-entry-limit",
    }))
  })

  it("skips raw source subtrees after the discovery depth limit", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw", "nested"), { recursive: true })
    await writeFile(path.join(root, ".raw", "nested", "a.md"), "alpha")

    const result = await scanKnowledgeBaseSources(root, { maxDiscoveryDepth: 0 })

    expect(result.sources).toEqual([])
    expect(result.skippedSources).toEqual([
      { relativePath: ".raw/nested", reason: "scan-depth-limit" },
    ])
  })
})
