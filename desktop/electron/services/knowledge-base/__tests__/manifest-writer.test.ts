import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { knowledgeBaseLogger } from "../logging"
import {
  readKnowledgeBaseManifest,
  writeKnowledgeBaseManifest,
  type KnowledgeBaseManifest,
} from "../manifest"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-manifest-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("writeKnowledgeBaseManifest", () => {
  it("writes pretty JSON and preserves manifest fields", async () => {
    const root = await tempDir()
    const manifest: KnowledgeBaseManifest = {
      version: 1,
      created: "2026-05-23",
      description: "Ingest delta tracker and address map for the Synapse knowledge base.",
      sources: {
        ".raw/a.md": {
          hash: "hash-a",
          ingested_at: "2026-05-23T00:00:00.000Z",
          pages_created: ["wiki/sources/a.md"],
          pages_updated: ["wiki/index.md"],
        },
      },
      address_map: {
        "wiki\\concepts\\Alpha.md": "c-000001",
      },
    }

    await writeKnowledgeBaseManifest(root, manifest)

    await expect(readFile(path.join(root, ".raw", ".manifest.json"), "utf8"))
      .resolves.toContain("\"wiki/concepts/Alpha.md\": \"c-000001\"")
    await expect(readKnowledgeBaseManifest(root)).resolves.toMatchObject({
      status: "valid",
      manifest: {
        created: "2026-05-23",
        sources: manifest.sources,
        address_map: {
          "wiki/concepts/Alpha.md": "c-000001",
        },
      },
    })
  })

  it("rejects symlinked raw directories", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await symlink(outside, path.join(root, ".raw"), "dir")

    await expect(writeKnowledgeBaseManifest(root, {
      version: 1,
      sources: {},
      address_map: {},
    })).rejects.toThrow("符号链接")
  })

  it("logs corrupt manifest reads with sanitized error metadata", async () => {
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    await writeKnowledgeBaseManifest(root, {
      version: 1,
      sources: {},
      address_map: {},
    })
    await rm(path.join(root, ".raw", ".manifest.json"))
    await mkdir(path.join(root, ".raw", ".manifest.json"))

    const result = await readKnowledgeBaseManifest(root)

    expect(result.status).toBe("invalid")
    expect(warn).toHaveBeenCalledWith("Knowledge Base manifest read failed.", expect.objectContaining({
      errorName: "Error",
      manifestPath: ".raw/.manifest.json",
    }))
    expect(String((warn.mock.calls[0]?.[1] as { error?: unknown } | undefined)?.error)).not.toContain(root)
  })

  it("repairs a UTF-8 BOM prefix on otherwise valid manifests", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".raw"), { recursive: true })
    const manifestText = JSON.stringify({
      version: 1,
      sources: {
        ".raw/a.md": {
          hash: "hash-a",
          ingested_at: "2026-06-25T00:00:00.000Z",
        },
      },
      address_map: {
        "wiki/a.md": "c-000001",
      },
    }, null, 2) + "\n"
    const manifestPath = path.join(root, ".raw", ".manifest.json")
    await writeFile(manifestPath, `\uFEFF${manifestText}`, "utf8")

    const result = await readKnowledgeBaseManifest(root)

    expect(result.status).toBe("valid")
    expect(result.manifest.sources[".raw/a.md"]).toEqual({
      hash: "hash-a",
      ingested_at: "2026-06-25T00:00:00.000Z",
    })
    expect(result.manifest.address_map).toEqual({
      "wiki/a.md": "c-000001",
    })
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(manifestText)
  })
})
