import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeBaseIngestCoordinator } from "../ingest-coordinator"
import { readKnowledgeBaseManifest } from "../manifest"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-ingest-coordinator-"))
  roots.push(dir)
  return dir
}

async function writeManifest(root: string, manifest: object): Promise<void> {
  await mkdir(path.join(root, ".raw"), { recursive: true })
  await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

function report(processedSources: readonly object[]): string {
  return [
    "```json synapse_kb_ingest_report",
    JSON.stringify({
      schema: "synapse.kb.ingest.report.v1",
      processed_sources: processedSources,
      skipped_sources: [],
    }),
    "```",
  ].join("\n")
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseIngestCoordinator", () => {
  it("preflight scans raw sources and computes hashes", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")

    const preflight = await new KnowledgeBaseIngestCoordinator().prepareTurn({ projectPath: root, force: false })

    expect(preflight.sources).toEqual([{
      relativePath: ".raw/note.md",
      hash: createHash("sha256").update("# Source\n").digest("hex"),
      state: "new",
    }])
  })

  it("updates manifest sources from trusted preflight hashes after a valid report", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: {
        ".raw/old.md": {
          hash: "old-hash",
          ingested_at: "2026-05-23T00:00:00.000Z",
          pages_created: ["wiki/sources/old.md"],
          pages_updated: [],
        },
      },
      address_map: {},
    })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "note.md"), "---\ntype: source\naddress: c-000001\n---\n\n# Note\n")

    const coordinator = new KnowledgeBaseIngestCoordinator({
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    const result = await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: report([{
        source: ".raw/note.md",
        hash: "agent-provided-hash",
        pages_created: ["wiki/sources/note.md"],
        pages_updated: [],
      }]),
    })

    expect(result.acceptedSources).toEqual([".raw/note.md"])
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/old.md": {
            hash: "old-hash",
            ingested_at: "2026-05-23T00:00:00.000Z",
            pages_created: ["wiki/sources/old.md"],
            pages_updated: [],
          },
          ".raw/note.md": {
            hash: preflight.sources[0]?.hash,
            ingested_at: "2026-05-24T00:00:00.000Z",
            pages_created: ["wiki/sources/note.md"],
            pages_updated: [],
          },
        },
      },
    })
  })

  it("rejects unknown sources and leaves manifest sources unchanged", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: {
        ".raw/existing.md": { hash: "existing-hash" },
      },
      address_map: {},
    })
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "unknown.md"), "# Unknown\n")

    const coordinator = new KnowledgeBaseIngestCoordinator()
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    const result = await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: report([{
        source: ".raw/unknown.md",
        pages_created: ["wiki/sources/unknown.md"],
        pages_updated: [],
      }]),
    })

    expect(result.acceptedSources).toEqual([])
    expect(result.warnings).toContain("Unknown ingest source was ignored: .raw/unknown.md")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/existing.md": { hash: "existing-hash" },
        },
      },
    })
  })

  it("rejects wiki page paths outside wiki", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")
    await mkdir(path.join(root, "notes"), { recursive: true })
    await writeFile(path.join(root, "notes", "note.md"), "# Note\n")

    const coordinator = new KnowledgeBaseIngestCoordinator()
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    const result = await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: report([{
        source: ".raw/note.md",
        pages_created: ["notes/note.md"],
        pages_updated: [],
      }]),
    })

    expect(result.acceptedSources).toEqual([])
    expect(result.warnings).toContain("Invalid wiki page path was ignored for .raw/note.md: notes/note.md")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: { sources: {} },
    })
  })

  it("rejects missing listed wiki pages", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")

    const coordinator = new KnowledgeBaseIngestCoordinator()
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    const result = await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: report([{
        source: ".raw/note.md",
        pages_created: ["wiki/sources/missing.md"],
        pages_updated: [],
      }]),
    })

    expect(result.acceptedSources).toEqual([])
    expect(result.warnings).toContain("Listed wiki page does not exist for .raw/note.md: wiki/sources/missing.md")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: { sources: {} },
    })
  })

  it("rejects processed sources that do not list any wiki page evidence", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: {},
      address_map: {},
    })
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")

    const coordinator = new KnowledgeBaseIngestCoordinator()
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    const result = await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: report([{
        source: ".raw/note.md",
        pages_created: [],
        pages_updated: [],
      }]),
    })

    expect(result.acceptedSources).toEqual([])
    expect(result.warnings).toContain("No wiki page evidence was reported for .raw/note.md")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: { sources: {} },
    })
  })

  it("rejects wiki page paths through a symlinked wiki ancestor", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")
    await mkdir(path.join(outside, "sources"), { recursive: true })
    const outsidePagePath = path.join(outside, "sources", "note.md")
    await writeFile(outsidePagePath, "---\ntype: source\n---\n\n# Note\n")
    await symlink(outside, path.join(root, "wiki"), "dir")

    const coordinator = new KnowledgeBaseIngestCoordinator()
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    const result = await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: report([{
        source: ".raw/note.md",
        pages_created: ["wiki/sources/note.md"],
        pages_updated: [],
      }]),
    })

    expect(result.acceptedSources).toEqual([])
    expect(result.warnings).toContain("Invalid wiki page path was ignored for .raw/note.md: wiki/sources/note.md")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: { sources: {} },
    })
    await expect(readFile(outsidePagePath, "utf8")).resolves.not.toContain("address:")
  })

  it("leaves manifest sources unchanged when report JSON is invalid", async () => {
    const root = await tempDir()
    await writeManifest(root, {
      version: 1,
      sources: {
        ".raw/existing.md": { hash: "existing-hash" },
      },
      address_map: {},
    })

    const coordinator = new KnowledgeBaseIngestCoordinator()
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    const result = await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: ["```json synapse_kb_ingest_report", "{ bad json", "```"].join("\n"),
    })

    expect(result.acceptedSources).toEqual([])
    expect(result.warnings[0]).toMatch(/Ingest report was not accepted/)
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/existing.md": { hash: "existing-hash" },
        },
      },
    })
  })

  it("runs the address finalizer after accepted source validation", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeFile(path.join(root, ".raw", "note.md"), "# Source\n")
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "note.md"), "---\ntype: source\naddress: c-000004\n---\n\n# Note\n")

    const coordinator = new KnowledgeBaseIngestCoordinator({
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })
    const preflight = await coordinator.prepareTurn({ projectPath: root, force: false })
    await coordinator.finalizeTurn({
      projectPath: root,
      preflightId: preflight.id,
      assistantText: report([{
        source: ".raw/note.md",
        pages_created: ["wiki/sources/note.md"],
        pages_updated: [],
      }]),
    })

    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      manifest: {
        address_map: {
          "wiki/sources/note.md": "c-000004",
        },
      },
    })
  })
})
