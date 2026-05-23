import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeBaseIngestFinalizer } from "../ingest-finalizer"
import { readKnowledgeBaseManifest } from "../manifest"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-finalizer-"))
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

describe("KnowledgeBaseIngestFinalizer", () => {
  it("allocates an address for an eligible page and updates address_map", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\ntitle: Alpha\n---\n\n# Alpha\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.assigned).toEqual([{ path: "wiki/concepts/Alpha.md", address: "c-000001" }])
    await expect(readFile(pagePath, "utf8")).resolves.toContain("address: c-000001")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8")).resolves.toBe("2\n")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      status: "valid",
      manifest: {
        address_map: { "wiki/concepts/Alpha.md": "c-000001" },
      },
    })
  })

  it("reuses an existing page address without incrementing the counter", async () => {
    const root = await tempDir()
    await writeManifest(root, { version: 1, sources: {}, address_map: {} })
    const pagePath = path.join(root, "wiki", "entities", "Team.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: entity\naddress: c-000009\n---\n\n# Team\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.reused).toEqual([{ path: "wiki/entities/Team.md", address: "c-000009" }])
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8")).rejects.toThrow()
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        address_map: { "wiki/entities/Team.md": "c-000009" },
      },
    })
  })

  it("uses an existing address_map entry when the page lacks frontmatter address", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: {},
      address_map: { "wiki/sources/Note.md": "c-000008" },
    })
    const pagePath = path.join(root, "wiki", "sources", "Note.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: source\n---\n\n# Note\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.reused).toEqual([{ path: "wiki/sources/Note.md", address: "c-000008" }])
    await expect(readFile(pagePath, "utf8")).resolves.toContain("address: c-000008")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8")).rejects.toThrow()
  })

  it("preserves manifest sources while merging address_map", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      created: "2026-05-23",
      description: "Ingest delta tracker and address map for the Synapse knowledge base.",
      sources: {
        ".raw/a.md": {
          hash: "hash-a",
          ingested_at: "2026-05-23T00:00:00.000Z",
          pages_created: ["wiki/concepts/Alpha.md"],
          pages_updated: [],
        },
      },
      address_map: {},
    })
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\n---\n\n# Alpha\n")

    await new KnowledgeBaseIngestFinalizer().finalize(root)

    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        created: "2026-05-23",
        sources: {
          ".raw/a.md": {
            hash: "hash-a",
            ingested_at: "2026-05-23T00:00:00.000Z",
            pages_created: ["wiki/concepts/Alpha.md"],
            pages_updated: [],
          },
        },
        address_map: { "wiki/concepts/Alpha.md": "c-000001" },
      },
    })
  })

  it("skips invalid manifests without writing addresses", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", ".manifest.json"), "{ bad json")
    const pagePath = path.join(root, "wiki", "concepts", "Alpha.md")
    await mkdir(path.dirname(pagePath), { recursive: true })
    await writeFile(pagePath, "---\ntype: concept\n---\n\n# Alpha\n")

    const result = await new KnowledgeBaseIngestFinalizer().finalize(root)

    expect(result.skippedReason).toBe("invalid-manifest")
    await expect(readFile(pagePath, "utf8")).resolves.not.toContain("address:")
  })
})
