import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const dragonScaleLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => dragonScaleLogger,
}))

import {
  DragonScaleTilingService,
  dragonScaleTilingBodyHash,
  type DragonScaleEmbeddingProvider,
  type DragonScaleTilingCheckResult,
} from "../index"
import {
  DRAGONSCALE_TILING_MAX_PAIR_COMPARISONS,
  DRAGONSCALE_TILING_MAX_REPORT_PAIRS_PER_BAND,
} from "../dragonscale/tiling-types"

const roots: string[] = []

class FakeEmbeddingProvider implements DragonScaleEmbeddingProvider {
  reachable = true
  modelPresent = true
  readonly embeddings = new Map<string, readonly number[]>()
  readonly failures = new Set<string>()
  readonly embedCalls: string[] = []
  reachableCalls = 0
  modelCalls = 0

  async isReachable(): Promise<boolean> {
    this.reachableCalls += 1
    return this.reachable
  }

  async hasModel(): Promise<boolean> {
    this.modelCalls += 1
    return this.modelPresent
  }

  async embed(input: { readonly text: string }): Promise<readonly number[]> {
    this.embedCalls.push(input.text)
    if (this.failures.has(input.text)) {
      throw new Error("fake embed failure")
    }
    return this.embeddings.get(input.text) ?? [1, 0]
  }
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-tiling-"))
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
  dragonScaleLogger.info.mockClear()
  dragonScaleLogger.warn.mockClear()
  dragonScaleLogger.error.mockClear()
})

describe("DragonScaleTilingService", () => {
  it("is exported from the knowledge-base barrel", () => {
    expect(DragonScaleTilingService).toBeDefined()
    const result: DragonScaleTilingCheckResult = {
      status: "ok",
      generated: "2026-05-24T00:00:00Z",
      model: "nomic-embed-text",
      ollamaUrl: "http://127.0.0.1:11434",
      thresholds: {
        version: 1,
        model: "nomic-embed-text",
        bands: { error: 0.9, review: 0.8 },
        calibrated: false,
        calibrationPairsLabeled: 0,
      },
      scanned: 0,
      embedded: 0,
      skipped: {},
      cacheHits: 0,
      recomputed: 0,
      orphansPruned: 0,
      errors: [],
      reviews: [],
      warnings: [],
    }
    expect(result.status).toBe("ok")
  })

  it("returns ok for a missing wiki without creating metadata or calling Ollama", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()

    const result = await new DragonScaleTilingService({
      embeddingProvider: provider,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }).check(root)

    expect(result).toMatchObject({ status: "ok", scanned: 0, embedded: 0 })
    expect(provider.reachableCalls).toBe(0)
    await expect(pathExists(path.join(root, ".vault-meta"))).resolves.toBe(false)
  })

  it("scans eligible pages and skips system, meta, fold, symlink, oversized, and invalid pages", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await writePage(root, "wiki/hot.md", "Hot body\n")
    await writePage(root, "wiki/meta/Report.md", "---\ntype: concept\n---\n\nReport body\n")
    await writePage(root, "wiki/folds/Fold.md", "---\ntype: concept\n---\n\nFold body\n")
    await writePage(root, "wiki/concepts/MetaByType.md", "---\ntype: meta\n---\n\nMeta body\n")
    await writePage(root, "wiki/concepts/TooLarge.md", `${"x".repeat(128 * 1024 + 1)}\n`)
    await writePage(outside, "Outside.md", "outside\n")
    await symlink(path.join(outside, "Outside.md"), path.join(root, "wiki", "concepts", "Outside.md"))
    await writeFile(path.join(root, "wiki", "concepts", "Invalid.md"), Buffer.from([0xff, 0xfe, 0xfd]))

    const result = await new DragonScaleTilingService({
      embeddingProvider: new FakeEmbeddingProvider(),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }).check(root)

    expect(result).toMatchObject({
      status: "ok",
      scanned: 8,
      embedded: 1,
      recomputed: 1,
    })
    expect(result.skipped).toMatchObject({
      "excluded filename": 1,
      "under wiki/meta/": 1,
      "under wiki/folds/": 1,
      "type=meta": 1,
      too_large: 1,
      symlink: 1,
      read_error: 1,
    })
    expect(dragonScaleLogger.warn).toHaveBeenCalledWith(
      "DragonScale tiling page read failed",
      expect.objectContaining({
        pagePath: "wiki/concepts/Invalid.md",
        reason: "read_error",
      }),
    )
  })

  it("skips oversized pages before reading their content", async () => {
    const root = await tempDir()
    const tooLargePath = path.join(root, "wiki", "concepts", "TooLarge.md")
    const readFileForBody = vi.fn(async (filePath: string) => {
      if (filePath === tooLargePath) throw new Error("oversized page body should not be read")
      return readFile(filePath)
    })
    const fileSize = vi.fn(async (filePath: string) => {
      if (filePath === tooLargePath) return 128 * 1024 + 1
      return (await lstat(filePath)).size
    })
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await writePage(root, "wiki/concepts/TooLarge.md", "body that should be skipped by size metadata\n")

    const result = await new DragonScaleTilingService({
      embeddingProvider: new FakeEmbeddingProvider(),
      fileSize,
      readFile: readFileForBody,
    }).check(root)

    expect(result.skipped).toMatchObject({ too_large: 1 })
    expect(readFileForBody).not.toHaveBeenCalledWith(tooLargePath)
  })

  it("uses cache hits for unchanged bodies and ignores frontmatter-only changes", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()
    provider.embeddings.set("\nAlpha body\n", [1, 0])
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ntitle: A\n---\n\nAlpha body\n")
    const service = new DragonScaleTilingService({
      embeddingProvider: provider,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    await expect(service.check(root)).resolves.toMatchObject({ recomputed: 1, cacheHits: 0 })
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ntitle: Renamed\n---\n\nAlpha body\n")
    await expect(service.check(root)).resolves.toMatchObject({ recomputed: 0, cacheHits: 1 })

    const cache = JSON.parse(await readFile(path.join(root, ".vault-meta", "tiling-cache.json"), "utf8")) as {
      embeddings: Record<string, { hash: string }>
    }
    expect(cache.embeddings["wiki/concepts/Alpha.md"]?.hash)
      .toBe(dragonScaleTilingBodyHash("\nAlpha body\n", "nomic-embed-text"))
    expect(provider.embedCalls).toHaveLength(1)
  })

  it("recomputes body changes, rebuilds on request, invalidates model changes, and prunes orphans", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()
    provider.embeddings.set("\nAlpha body\n", [1, 0])
    provider.embeddings.set("\nAlpha changed\n", [0, 1])
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await writePage(root, "wiki/concepts/Orphan.md", "---\ntype: concept\n---\n\nOrphan body\n")
    const service = new DragonScaleTilingService({ embeddingProvider: provider })

    await service.check(root)
    provider.embedCalls.length = 0
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha changed\n")
    await rm(path.join(root, "wiki", "concepts", "Orphan.md"))

    await expect(service.check(root)).resolves.toMatchObject({ recomputed: 1, orphansPruned: 1 })
    await expect(service.check(root, { rebuildCache: true })).resolves.toMatchObject({ recomputed: 1, cacheHits: 0 })
    await expect(service.check(root, { model: "other-model" })).resolves.toMatchObject({ recomputed: 1, cacheHits: 0 })
  })

  it("returns cache-corrupt without overwriting the cache", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "tiling-cache.json"), "{ bad json")

    const result = await new DragonScaleTilingService({ embeddingProvider: new FakeEmbeddingProvider() }).check(root)

    expect(result.status).toBe("cache-corrupt")
    await expect(readFile(path.join(root, ".vault-meta", "tiling-cache.json"), "utf8")).resolves.toBe("{ bad json")
    expect(dragonScaleLogger.warn).toHaveBeenCalledWith(
      "DragonScale tiling cache corrupt",
      expect.objectContaining({
        cachePath: path.join(root, ".vault-meta", "tiling-cache.json"),
        errorName: "SyntaxError",
      }),
    )
  })

  it("rejects a symlinked metadata directory before writing the tiling cache", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await symlink(outside, path.join(root, ".vault-meta"))

    await expect(new DragonScaleTilingService({
      embeddingProvider: new FakeEmbeddingProvider(),
    }).check(root)).rejects.toThrow("Knowledge base path must not contain symlinks: .vault-meta")

    await expect(pathExists(path.join(outside, "tiling-cache.json"))).resolves.toBe(false)
  })

  it("splits similarity pairs into error and review bands", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()
    provider.embeddings.set("\nAlpha body\n", [1, 0])
    provider.embeddings.set("\nBeta body\n", [1, 0])
    provider.embeddings.set("\nReview body\n", [0.85, Math.sqrt(1 - 0.85 ** 2)])
    provider.embeddings.set("\nLow body\n", [0, 1])
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "tiling-thresholds.json"), `${JSON.stringify({
      version: 1,
      model: "nomic-embed-text",
      bands: { error: 0.95, review: 0.8 },
      calibrated: true,
      calibration_pairs_labeled: 12,
    })}\n`)
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await writePage(root, "wiki/concepts/Beta.md", "---\ntype: concept\n---\n\nBeta body\n")
    await writePage(root, "wiki/concepts/Review.md", "---\ntype: concept\n---\n\nReview body\n")
    await writePage(root, "wiki/concepts/Low.md", "---\ntype: concept\n---\n\nLow body\n")

    const result = await new DragonScaleTilingService({ embeddingProvider: provider }).check(root)

    expect(result.thresholds).toMatchObject({ calibrated: true, calibrationPairsLabeled: 12 })
    expect(result.errors).toEqual([
      expect.objectContaining({ leftPath: "wiki/concepts/Alpha.md", rightPath: "wiki/concepts/Beta.md", similarity: 1 }),
    ])
    expect(result.reviews.map((pair) => [pair.leftPath, pair.rightPath, Number(pair.similarity.toFixed(2))])).toEqual([
      ["wiki/concepts/Alpha.md", "wiki/concepts/Review.md", 0.85],
      ["wiki/concepts/Beta.md", "wiki/concepts/Review.md", 0.85],
    ])
  })

  it("stops warm-cache pair scoring when comparison budget is exceeded", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()
    const pageCount = Math.floor((1 + Math.sqrt(1 + 8 * DRAGONSCALE_TILING_MAX_PAIR_COMPARISONS)) / 2) + 1
    const embeddings: Record<string, { hash: string; embedding: readonly number[]; computed_at: string }> = {}
    for (let index = 0; index < pageCount; index += 1) {
      const body = `\nBody ${index}\n`
      const relativePath = `wiki/concepts/Page-${String(index).padStart(4, "0")}.md`
      await writePage(root, relativePath, `---\ntype: concept\n---\n${body}`)
      embeddings[relativePath] = {
        hash: dragonScaleTilingBodyHash(body, "nomic-embed-text"),
        embedding: [1, 0],
        computed_at: "2026-05-24T00:00:00Z",
      }
    }
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "tiling-cache.json"), `${JSON.stringify({
      version: 1,
      model: "nomic-embed-text",
      embeddings,
    })}\n`)

    const result = await new DragonScaleTilingService({ embeddingProvider: provider }).check(root)

    expect(result).toMatchObject({
      status: "scale-exceeded",
      scanned: pageCount,
      embedded: pageCount,
      cacheHits: pageCount,
      recomputed: 0,
      message: expect.stringContaining("pair comparisons"),
    })
    expect(provider.embedCalls).toHaveLength(0)
  })

  it("keeps only the top pairs per report band", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()
    const pageCount = 21
    for (let index = 0; index < pageCount; index += 1) {
      const body = `\nSame ${index}\n`
      provider.embeddings.set(body, [1, 0])
      await writePage(root, `wiki/concepts/Same-${String(index).padStart(2, "0")}.md`, `---\ntype: concept\n---\n${body}`)
    }

    const result = await new DragonScaleTilingService({ embeddingProvider: provider }).check(root)

    expect(result.status).toBe("ok")
    expect(result.errors).toHaveLength(DRAGONSCALE_TILING_MAX_REPORT_PAIRS_PER_BAND)
    expect(result.reviews).toHaveLength(0)
  })

  it("records embed failures and dimension mismatch warnings", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()
    provider.embeddings.set("\nAlpha body\n", [1, 0])
    provider.embeddings.set("\nShort body\n", [1])
    provider.failures.add("\nFail body\n")
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await writePage(root, "wiki/concepts/Short.md", "---\ntype: concept\n---\n\nShort body\n")
    await writePage(root, "wiki/concepts/Fail.md", "---\ntype: concept\n---\n\nFail body\n")

    const result = await new DragonScaleTilingService({ embeddingProvider: provider }).check(root)

    expect(result.skipped).toMatchObject({ embed_error: 1 })
    expect(dragonScaleLogger.warn).toHaveBeenCalledWith(
      "DragonScale tiling embed failed",
      expect.objectContaining({
        pagePath: "wiki/concepts/Fail.md",
        model: "nomic-embed-text",
        errorName: "Error",
        errorMessage: "fake embed failure",
      }),
    )
    expect(result.warnings).toEqual([
      "cosine skip (wiki/concepts/Alpha.md, wiki/concepts/Short.md): dimension mismatch",
    ])
  })

  it("returns usage-error for invalid thresholds and unsafe remote Ollama URLs", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "tiling-thresholds.json"), `${JSON.stringify({
      version: 1,
      bands: { error: 0.7, review: 0.8 },
    })}\n`)
    const service = new DragonScaleTilingService({ embeddingProvider: new FakeEmbeddingProvider() })

    await expect(service.check(root)).resolves.toMatchObject({ status: "usage-error" })
    const remoteResult = await service.check(root, { ollamaUrl: "https://user:secret@example.com?token=sk-secret" })
    expect(remoteResult).toMatchObject({
      status: "usage-error",
      message: expect.stringContaining("not localhost"),
    })
    expect(JSON.stringify(remoteResult)).toContain("https://example.com/?token=%5Bredacted%5D")
    expect(JSON.stringify(remoteResult)).not.toContain("user:secret")
    expect(JSON.stringify(remoteResult)).not.toContain("sk-secret")
  })

  it("reports peek diagnostics without writing cache or reports", async () => {
    const root = await tempDir()
    const provider = new FakeEmbeddingProvider()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "tiling-cache.json"), `${JSON.stringify({
      version: 1,
      model: "nomic-embed-text",
      embeddings: { "wiki/concepts/Alpha.md": { hash: "h", embedding: [1], computed_at: "2026-05-24T00:00:00Z" } },
    })}\n`)

    const result = await new DragonScaleTilingService({ embeddingProvider: provider }).peek(root)

    expect(result).toMatchObject({
      status: "ok",
      cachePresent: true,
      cacheReadable: true,
      cacheEntries: 1,
      cacheModel: "nomic-embed-text",
      thresholdsPresent: false,
    })
  })
})
