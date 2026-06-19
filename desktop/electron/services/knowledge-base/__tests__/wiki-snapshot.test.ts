import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { diffWikiSnapshots, snapshotWikiMarkdown } from "../wiki-snapshot"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-snapshot-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("wiki snapshots", () => {
  it("detects created and updated wiki pages", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "old.md"), "# Old\n")
    const before = await snapshotWikiMarkdown(root)

    await writeFile(path.join(root, "wiki", "sources", "old.md"), "# Old\n\nUpdated\n")
    await writeFile(path.join(root, "wiki", "sources", "new.md"), "# New\n")
    const after = await snapshotWikiMarkdown(root)

    expect(diffWikiSnapshots(before, after)).toEqual({
      created: ["wiki/sources/new.md"],
      updated: ["wiki/sources/old.md"],
    })
  })

  it("can snapshot only declared wiki page candidates", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(root, "wiki", "sources", "reported.md"), "# Reported\n")
    await writeFile(path.join(root, "wiki", "sources", "unrelated.md"), "# Unrelated\n")

    const snapshot = await snapshotWikiMarkdown(root, {
      paths: [
        "wiki/sources/reported.md",
        "wiki/sources/missing.md",
        "../outside.md",
      ],
    })

    expect(Object.keys(snapshot.files)).toEqual(["wiki/sources/reported.md"])
  })
})
