import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeBaseAddressLintService } from "../lint-addresses"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-address-lint-"))
  roots.push(dir)
  return dir
}

async function writePage(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, ...relativePath.split("/"))
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function writeManifest(root: string, manifest: object): Promise<void> {
  await mkdir(path.join(root, ".raw"), { recursive: true })
  await writeFile(path.join(root, ".raw", ".manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseAddressLintService", () => {
  it("reports invalid, duplicate, missing, counter, and manifest address issues", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "10\n")
    await writeManifest(root, {
      version: 1,
      sources: {},
      address_map: {
        "wiki/concepts/Alpha.md": "c-000001",
        "wiki/concepts/Missing.md": "c-000004",
        "wiki/concepts/Mismatch.md": "c-000005",
      },
    })
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: c-000001\n---\n\n# Alpha\n")
    await writePage(root, "wiki/concepts/DupeA.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: c-000002\n---\n\n# A\n")
    await writePage(root, "wiki/concepts/DupeB.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: c-000002\n---\n\n# B\n")
    await writePage(root, "wiki/concepts/Bad.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: nope\n---\n\n# Bad\n")
    await writePage(root, "wiki/concepts/New.md", "---\ntype: concept\ncreated: 2026-05-01\n---\n\n# New\n")
    await writePage(root, "wiki/concepts/Mismatch.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: c-000006\n---\n\n# Mismatch\n")
    await writePage(root, "wiki/concepts/Drift.md", "---\ntype: concept\ncreated: 2026-05-01\naddress: c-000010\n---\n\n# Drift\n")

    const result = await new KnowledgeBaseAddressLintService().lint(root)

    expect(result.counter).toBe(10)
    expect(result.highestCAddress).toBe("c-000010")
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "address.invalid-format",
      "address.duplicate",
      "address.missing-post-rollout",
      "address.counter-drift",
      "address-map.missing-page",
      "address-map.mismatch",
    ]))
  })

  it("treats pre-rollout and legacy-list pages as pending backfill", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")
    await writeFile(path.join(root, ".vault-meta", "legacy-pages.txt"), [
      "# rollout: 2026-05-01",
      "wiki/concepts/ListLegacy.md",
      "",
    ].join("\n"))
    await writePage(root, "wiki/concepts/Old.md", "---\ntype: concept\ncreated: 2026-04-01\n---\n\n# Old\n")
    await writePage(root, "wiki/concepts/ListLegacy.md", "---\ntype: concept\ncreated: 2026-05-10\n---\n\n# Listed\n")

    const result = await new KnowledgeBaseAddressLintService().lint(root)

    expect(result.legacyPagesPendingBackfill).toBe(2)
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "address.legacy-pending-backfill",
      "address.legacy-pending-backfill",
    ])
  })
})
