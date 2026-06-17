import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createGitRepositoryRegistry } from "../git-repository-registry"

let tempDir: string | null = null

async function makeRegistry() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
  return createGitRepositoryRegistry({
    userDataPath: tempDir,
    now: () => new Date("2026-06-17T10:00:00.000Z"),
  })
}

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe("git repository registry", () => {
  it("adds, lists, opens, and removes repositories without deleting local files", async () => {
    const registry = await makeRegistry()
    const added = await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })

    expect(await registry.list()).toEqual([added])
    expect(added).toMatchObject({
      name: "Docs",
      localPath: path.resolve("/tmp/docs"),
      addedAt: "2026-06-17T10:00:00.000Z",
      lastOpenedAt: null,
    })

    await registry.markOpened(added.id)
    expect((await registry.list())[0]?.lastOpenedAt).toBe("2026-06-17T10:00:00.000Z")

    await registry.remove(added.id)
    expect(await registry.list()).toEqual([])
  })

  it("deduplicates repositories by normalized path", async () => {
    const registry = await makeRegistry()
    const first = await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })
    const second = await registry.addLocal({ name: "Docs Again", localPath: "/tmp/docs/." })

    expect(second.id).toBe(first.id)
    expect(await registry.list()).toHaveLength(1)
  })

  it("stores data in the git module registry file", async () => {
    const registry = await makeRegistry()
    await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })

    const raw = await readFile(path.join(tempDir as string, "git-client", "repositories.json"), "utf8")
    expect(JSON.parse(raw).repositories).toHaveLength(1)
  })
})
