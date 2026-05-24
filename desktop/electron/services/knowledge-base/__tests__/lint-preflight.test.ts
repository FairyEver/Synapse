import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { DragonScaleTilingCheckResult, DragonScaleTilingPeekResult } from "../dragonscale/tiling-types"
import { KnowledgeBaseLintPreflightService, formatKnowledgeBaseLintPreflightAppendix } from "../lint-preflight"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-lint-preflight-"))
  roots.push(dir)
  return dir
}

async function writePage(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, ...relativePath.split("/"))
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseLintPreflightService", () => {
  it("collects deterministic wiki issues and reports skipped tiling", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{\"bad.md\":{\"hash\":\"h\"}},\"address_map\":{}}\n")
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ncreated: 2026-05-01\n---\n\n# Alpha\n\n[[Missing]]\n\n## Empty\n")
    await writePage(root, "wiki/concepts/Beta.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: c-000001\n---\n\n# Beta\n")

    const result = await new KnowledgeBaseLintPreflightService({
      now: () => new Date("2026-05-24T00:00:00.000Z"),
      tilingService: {
        peek: async () => ({
          status: "ollama-unreachable",
          vaultPath: root,
          ollamaUrl: "http://127.0.0.1:11434",
          ollamaReachable: false,
          modelRequested: "nomic-embed-text",
          modelPresent: false,
          cachePresent: false,
          cacheReadable: false,
          cacheEntries: 0,
          cacheModel: null,
          thresholdsPresent: false,
          thresholdsReadable: false,
        }) satisfies DragonScaleTilingPeekResult,
        check: async () => {
          throw new Error("should not check")
        },
      },
    }).run(root)

    expect(result.generatedDate).toBe("2026-05-24")
    expect(result.pagesScanned).toBe(2)
    expect(result.tiling.status).toBe("ollama-unreachable")
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "wikilink.dead",
      "frontmatter.missing-field",
      "section.empty",
      "page.orphan",
      "manifest.source-key",
      "address.missing-post-rollout",
      "tiling.ollama-unreachable",
    ]))
    expect(formatKnowledgeBaseLintPreflightAppendix(result)).toContain("Synapse 确定性预检")
  })

  it("runs tiling check and reports the generated tiling report path when ready", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: c-000001\n---\n\n# Alpha\n")

    const result = await new KnowledgeBaseLintPreflightService({
      now: () => new Date("2026-05-24T00:00:00.000Z"),
      addressLint: {
        lint: async () => ({
          counter: 2,
          highestCAddress: "c-000001",
          postRolloutPagesChecked: 0,
          legacyPagesPendingBackfill: 0,
          issues: [],
        }),
      },
      tilingService: {
        peek: async () => ({
          status: "ok",
          vaultPath: root,
          ollamaUrl: "http://127.0.0.1:11434",
          ollamaReachable: true,
          modelRequested: "nomic-embed-text",
          modelPresent: true,
          cachePresent: false,
          cacheReadable: false,
          cacheEntries: 0,
          cacheModel: null,
          thresholdsPresent: false,
          thresholdsReadable: false,
          thresholdsCalibrated: false,
        }) satisfies DragonScaleTilingPeekResult,
        check: async (_projectPath, options) => ({
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
          scanned: 1,
          embedded: 1,
          skipped: {},
          cacheHits: 0,
          recomputed: 1,
          orphansPruned: 0,
          errors: [{ similarity: 0.95, leftPath: "a", rightPath: "b" }],
          reviews: [],
          warnings: [],
          reportPath: path.join(root, options?.reportPath ?? ""),
        }) satisfies DragonScaleTilingCheckResult,
      },
    }).run(root)

    expect(result.tiling).toMatchObject({
      status: "ok",
      reportPath: "wiki/meta/tiling-report-2026-05-24.md",
      errors: 1,
      reviews: 0,
    })
  })
})
