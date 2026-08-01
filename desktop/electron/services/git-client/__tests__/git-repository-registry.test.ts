import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createGitRepositoryRegistry } from "../git-repository-registry"

let tempDir: string | null = null

async function makeRegistry() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
  return createGitRepositoryRegistry({
    userDataPath: tempDir,
    now: () => new Date("2026-06-17T10:00:00.000Z"),
    resolveGitRoot: async (localPath) => path.resolve(localPath),
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

  it("registers the resolved Git root when a repository subdirectory is selected", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
    const rootPath = path.join(tempDir, "docs")
    const registry = createGitRepositoryRegistry({
      userDataPath: tempDir,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
      resolveGitRoot: async () => rootPath,
    })

    const added = await registry.addLocal({ name: "Docs", localPath: path.join(rootPath, "nested") })

    expect(added.localPath).toBe(rootPath)
  })

  it("does not register paths that cannot be resolved to a Git root", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
    const registry = createGitRepositoryRegistry({
      userDataPath: tempDir,
      resolveGitRoot: async () => {
        throw new Error("所选目录不是 Git 仓库。")
      },
    })

    await expect(registry.addLocal({ name: "Docs", localPath: "/tmp/not-git" }))
      .rejects.toThrow("所选目录不是 Git 仓库。")
    expect(await registry.list()).toEqual([])
  })

  it("deduplicates repositories by normalized path", async () => {
    const registry = await makeRegistry()
    const first = await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })
    const second = await registry.addLocal({ name: "Docs Again", localPath: "/tmp/docs/." })

    expect(second.id).toBe(first.id)
    expect(await registry.list()).toHaveLength(1)
  })

  it("preserves concurrent add-local mutations", async () => {
    const registry = await makeRegistry()
    const added = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      registry.addLocal({ name: `Repo ${index}`, localPath: `/tmp/repo-${index}` }),
    ))

    const repositories = await registry.list()

    expect(repositories.map((repository) => repository.id).sort()).toEqual(
      added.map((repository) => repository.id).sort(),
    )
  })

  it("deduplicates Windows repositories by case-insensitive normalized path", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
    const registry = createGitRepositoryRegistry({
      userDataPath: tempDir,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
      platform: "win32",
      resolveGitRoot: async (localPath) => localPath,
    })
    const first = await registry.addLocal({ name: "Repo", localPath: "C:\\Work\\Repo" })
    const second = await registry.addLocal({ name: "Repo Again", localPath: "c:\\work\\repo\\" })

    expect(second.id).toBe(first.id)
    expect(second.localPath).toBe("C:\\Work\\Repo")
    expect(await registry.list()).toHaveLength(1)
  })

  it("stores data in the git module registry file", async () => {
    const registry = await makeRegistry()
    await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })

    const raw = await readFile(path.join(tempDir as string, "git-client", "repositories.json"), "utf8")
    expect(JSON.parse(raw).repositories).toHaveLength(1)
  })

  it("recovers from the last registry backup when the live file is malformed", async () => {
    const logger = { error: vi.fn(), info: vi.fn() }
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
    const registry = createGitRepositoryRegistry({
      logger,
      userDataPath: tempDir,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
      resolveGitRoot: async (localPath) => path.resolve(localPath),
    })
    const first = await registry.addLocal({ name: "Docs", localPath: "/tmp/docs" })
    await registry.addLocal({ name: "Website", localPath: "/tmp/website" })

    const registryPath = path.join(tempDir, "git-client", "repositories.json")
    await writeFile(registryPath, "{\"version\":1,\"repositories\":[", "utf8")

    await expect(registry.list()).resolves.toEqual([first])
    await expect(registry.list()).resolves.toEqual([first])
    await expect(readFile(registryPath, "utf8")).resolves.toContain(first.id)
    expect(logger.error).toHaveBeenCalledWith("Git repository registry is malformed.", { quarantined: true })
    expect(logger.info).toHaveBeenCalledWith("Recovered Git repository registry from backup.", {
      repositoryCount: 1,
    })
  })

  it("keeps malformed registry files and reports corruption when no backup is available", async () => {
    const logger = { error: vi.fn(), info: vi.fn() }
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-git-registry-"))
    const registryDir = path.join(tempDir, "git-client")
    await mkdir(registryDir, { recursive: true })
    await writeFile(path.join(registryDir, "repositories.json"), "{\"version\":1,\"repositories\":[", "utf8")
    const registry = createGitRepositoryRegistry({
      logger,
      userDataPath: tempDir,
      now: () => new Date("2026-06-17T10:00:00.000Z"),
      resolveGitRoot: async (localPath) => path.resolve(localPath),
    })

    await expect(registry.list()).rejects.toThrow("Git 仓库列表已损坏且没有可用备份")

    const entries = await readdir(registryDir)
    expect(entries.some((entry) => /^repositories\.invalid-.*\.json$/.test(entry))).toBe(true)
    expect(entries).toContain("repositories.json")
    expect(logger.error).toHaveBeenCalledWith("Git repository registry is malformed.", { quarantined: true })
  })
})
