import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KnowledgeBaseManifestFinalizer } from "../manifest-finalizer"
import { readKnowledgeBaseManifest } from "../manifest"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-manifest-finalizer-"))
  roots.push(dir)
  return dir
}

async function writeManifest(root: string, manifest: object): Promise<void> {
  await mkdir(path.join(root, ".raw"), { recursive: true })
  await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseManifestFinalizer", () => {
  it("writes sources from trusted preflight hashes and merges address_map", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    await writeFile(path.join(root, ".raw", "a.md"), "Alpha\n")
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "a.md"), "# A\n")
    await writeFile(path.join(root, "wiki", "index.md"), "# Index\n")

    const result = await new KnowledgeBaseManifestFinalizer({
      now: () => "2026-05-24T00:00:00.000Z",
      addressFinalizer: {
        finalize: vi.fn(async () => ({
          assigned: [],
          reused: [],
          addressMap: { "wiki/sources/a.md": "c-000001" },
        })),
      },
    }).finalize({
      projectPath: root,
      conversationId: "conv-1",
      turnId: "turn-1",
      preflight: {
        projectPath: root,
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{
          relativePath: ".raw/a.md",
          hash: "90c877f65b3141d28d51619fd2bbc862c49c48be4fab42386062f532e27e4fd6",
          state: "new",
        }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      report: {
        processedSources: [{
          source: ".raw/a.md",
          pagesCreated: ["wiki/sources/a.md"],
          pagesUpdated: ["wiki/index.md"],
        }],
        skippedSources: [],
      },
    })

    expect(result.writtenSources).toEqual([".raw/a.md"])
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/a.md": {
            hash: "90c877f65b3141d28d51619fd2bbc862c49c48be4fab42386062f532e27e4fd6",
            ingested_at: "2026-05-24T00:00:00.000Z",
            pages_created: ["wiki/sources/a.md"],
            pages_updated: ["wiki/index.md"],
          },
        },
        address_map: { "wiki/sources/a.md": "c-000001" },
      },
    })
  })

  it("preserves unrelated sources and refuses unknown report sources", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: { ".raw/old.md": { hash: "old-hash", ingested_at: "2026-05-01T00:00:00.000Z" } },
      address_map: {},
    })

    const result = await new KnowledgeBaseManifestFinalizer({
      addressFinalizer: { finalize: vi.fn(async () => ({ assigned: [], reused: [], addressMap: {} })) },
    }).finalize({
      projectPath: root,
      conversationId: "conv-1",
      turnId: "turn-1",
      preflight: {
        projectPath: root,
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      report: {
        processedSources: [{ source: ".raw/missing.md", pagesCreated: ["wiki/sources/a.md"], pagesUpdated: [] }],
        skippedSources: [],
      },
    })

    expect(result.warnings.map((warning) => warning.code)).toContain("source-not-in-preflight")
    await expect(readFile(path.join(root, ".raw", ".manifest.json"), "utf8")).resolves.toContain("\".raw/old.md\"")
  })

  it("skips sources whose hash changed after preflight", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "a.md"), "changed\n")
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "a.md"), "# A\n")

    const result = await new KnowledgeBaseManifestFinalizer({
      addressFinalizer: { finalize: vi.fn(async () => ({ assigned: [], reused: [], addressMap: {} })) },
    }).finalize({
      projectPath: root,
      conversationId: "conv-1",
      turnId: "turn-1",
      preflight: {
        projectPath: root,
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "preflight-hash", state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      report: {
        processedSources: [{ source: ".raw/a.md", pagesCreated: ["wiki/sources/a.md"], pagesUpdated: [] }],
        skippedSources: [],
      },
    })

    expect(result.warnings.map((warning) => warning.code)).toContain("source-hash-changed")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: { sources: {} },
    })
  })

  it("serializes concurrent manifest source writes for one project", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    await writeFile(path.join(root, ".raw", "a.md"), "Alpha\n")
    await writeFile(path.join(root, ".raw", "b.md"), "Beta\n")
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "a.md"), "# A\n")
    await writeFile(path.join(root, "wiki", "sources", "b.md"), "# B\n")
    const addressFinalizer = {
      finalize: vi.fn(async () => {
        await delay(20)
        return { assigned: [], reused: [], addressMap: {} }
      }),
    }
    const finalizer = new KnowledgeBaseManifestFinalizer({
      now: () => "2026-05-24T00:00:00.000Z",
      addressFinalizer,
    })

    await Promise.all([
      finalizer.finalize({
        projectPath: root,
        conversationId: "conv-1",
        turnId: "turn-1",
        preflight: {
          projectPath: root,
          generatedAt: "2026-05-24T00:00:00.000Z",
          force: false,
          changedSources: [{ relativePath: ".raw/a.md", hash: sha256("Alpha\n"), state: "new" }],
          skippedSources: [],
          wikiBefore: { files: {} },
        },
        report: {
          processedSources: [{ source: ".raw/a.md", pagesCreated: ["wiki/sources/a.md"], pagesUpdated: [] }],
          skippedSources: [],
        },
      }),
      finalizer.finalize({
        projectPath: root,
        conversationId: "conv-1",
        turnId: "turn-2",
        preflight: {
          projectPath: root,
          generatedAt: "2026-05-24T00:00:00.000Z",
          force: false,
          changedSources: [{ relativePath: ".raw/b.md", hash: sha256("Beta\n"), state: "new" }],
          skippedSources: [],
          wikiBefore: { files: {} },
        },
        report: {
          processedSources: [{ source: ".raw/b.md", pagesCreated: ["wiki/sources/b.md"], pagesUpdated: [] }],
          skippedSources: [],
        },
      }),
    ])

    const manifest = await readKnowledgeBaseManifest(root)
    expect(Object.keys(manifest.manifest.sources).sort()).toEqual([".raw/a.md", ".raw/b.md"])
  })

  it("does not run address finalization when no source entry is accepted", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await writeFile(path.join(root, "wiki", "concepts", "Alpha.md"), "---\ntype: concept\n---\n\n# Alpha\n")
    const addressFinalizer = {
      finalize: vi.fn(async () => ({
        assigned: [{ path: "wiki/concepts/Alpha.md", address: "c-000001" }],
        reused: [],
        addressMap: { "wiki/concepts/Alpha.md": "c-000001" },
      })),
    }

    const result = await new KnowledgeBaseManifestFinalizer({
      addressFinalizer,
    }).finalize({
      projectPath: root,
      conversationId: "conv-1",
      turnId: "turn-1",
      preflight: {
        projectPath: root,
        generatedAt: "2026-05-24T00:00:00.000Z",
        force: false,
        changedSources: [{ relativePath: ".raw/a.md", hash: "hash-a", state: "new" }],
        skippedSources: [],
        wikiBefore: { files: {} },
      },
      report: {
        processedSources: [{ source: ".raw/missing.md", pagesCreated: ["wiki/concepts/Alpha.md"], pagesUpdated: [] }],
        skippedSources: [],
      },
    })

    const manifest = await readKnowledgeBaseManifest(root)
    expect(result.warnings.map((warning) => warning.code)).toContain("source-not-in-preflight")
    expect(addressFinalizer.finalize).not.toHaveBeenCalled()
    expect(manifest.manifest.address_map).toEqual({})
  })
})

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
