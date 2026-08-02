import path from "node:path"
import { access, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { GitCloneJournalEntryV1 } from "../../../runtime/data-repo"
import { createGitCloneService, detectRemoteKind } from "../git-clone-service"

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "synapse-clone-service-"))
  roots.push(root)
  return root
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function createJournal(initial: readonly GitCloneJournalEntryV1[] = []) {
  const entries = new Map(initial.map((entry) => [entry.id, entry]))
  return {
    entries,
    journal: {
      get: async (id: string) => entries.get(id) ?? null,
      list: async () => [...entries.values()],
      remove: async (id: string) => { entries.delete(id) },
      upsert: async (entry: GitCloneJournalEntryV1) => { entries.set(entry.id, entry) },
    },
  }
}

describe("detectRemoteKind", () => {
  it("detects HTTP, HTTPS, and SSH URLs", () => {
    expect(detectRemoteKind("http://git.example.com:8080/team/docs.git")).toBe("http")
    expect(detectRemoteKind("https://git.example.com/team/docs.git")).toBe("https")
    expect(detectRemoteKind("git@git.example.com:team/docs.git")).toBe("ssh")
    expect(detectRemoteKind("file:///tmp/repo")).toBe("unknown")
  })
})

describe("git clone service", () => {
  it("removes a journaled temporary clone after cancellation without creating the final target", async () => {
    const root = await createRoot()
    const { entries, journal } = createJournal()
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      const clonePath = input.args.at(-1)!
      await mkdir(path.join(clonePath, ".git", "objects"), { recursive: true })
      throw new Error("Git 操作已取消。")
    })
    const service = createGitCloneService({
      commandRunner: { run },
      journal,
      registry: { addLocal: vi.fn() },
      pathExists: exists,
    })

    await expect(service.clone({
      remoteUrl: "file:///remote.git",
      parentDirectory: root,
      directoryName: "docs",
    }, { operationId: "clone-cancelled" })).rejects.toThrow("已取消")

    expect(await exists(path.join(root, "docs"))).toBe(false)
    expect(entries.size).toBe(0)
    await expect((await import("node:fs/promises")).readdir(root)).resolves.toEqual([])
  })

  it("clones into a repository directory below the selected parent", async () => {
    const root = await createRoot()
    const run = vi.fn(async (input: { readonly args: readonly string[] }) => {
      await mkdir(path.join(input.args.at(-1)!, ".git"), { recursive: true })
      return { stdout: "", stderr: "" }
    })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const addLocal = vi.fn(async ({ name, localPath }: { name: string; localPath: string }) => ({
      id: "repo-1", name, localPath, addedAt: "2026-06-17T10:00:00.000Z", lastOpenedAt: null,
    }))
    const { journal } = createJournal()
    const service = createGitCloneService({
      commandRunner: { run },
      journal,
      logger,
      registry: { addLocal },
      pathExists: exists,
    })

    const result = await service.clone({
      remoteUrl: "https://user:secret@git.example.com/team/docs.git?token=raw-token",
      parentDirectory: root,
      directoryName: "docs",
    })

    const targetPath = path.join(root, "docs")
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: root,
      args: ["clone", "--progress", "https://user:secret@git.example.com/team/docs.git?token=raw-token", expect.stringMatching(/\.synapse-clone-.+\/repository$/)],
      operation: "git.clone",
      operationId: expect.any(String),
      remoteUrl: "https://user:secret@git.example.com/team/docs.git?token=raw-token",
      timeoutMs: 300000,
    }))
    expect(result).toMatchObject({ status: "registered", localPath: targetPath, repository: { id: "repo-1" } })
    const serialized = JSON.stringify(logger.info.mock.calls)
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("raw-token")
    expect(serialized).not.toContain("user:secret")
  })

  it("keeps a complete clone when repository registration fails", async () => {
    const root = await createRoot()
    const { entries, journal } = createJournal()
    const service = createGitCloneService({
      commandRunner: {
        run: vi.fn(async (input: { readonly args: readonly string[] }) => {
          await mkdir(path.join(input.args.at(-1)!, ".git"), { recursive: true })
          return { stdout: "", stderr: "" }
        }),
      },
      journal,
      registry: { addLocal: vi.fn().mockRejectedValue(new Error("registry unavailable")) },
      pathExists: exists,
    })

    await expect(service.clone({
      remoteUrl: "file:///remote.git",
      parentDirectory: root,
      directoryName: "docs",
    })).resolves.toMatchObject({
      status: "registration-failed",
      repository: null,
      localPath: path.join(root, "docs"),
      message: expect.stringContaining("添加本地仓库"),
    })
    expect(await exists(path.join(root, "docs", ".git"))).toBe(true)
    expect(entries.size).toBe(0)
  })

  it("recovers only journaled containers that still carry the Synapse marker", async () => {
    const root = await createRoot()
    const trustedTemp = path.join(root, ".synapse-clone-trusted")
    const untrustedTemp = path.join(root, ".synapse-clone-untrusted")
    await mkdir(path.join(trustedTemp, ".synapse-owned-clone"), { recursive: true })
    await mkdir(path.join(trustedTemp, "repository", ".git"), { recursive: true })
    await mkdir(path.join(untrustedTemp, "repository", ".git"), { recursive: true })
    const trustedEntry: GitCloneJournalEntryV1 = {
      id: "trusted",
      schemaVersion: 1,
      tempPath: trustedTemp,
      targetPath: path.join(root, "docs"),
      createdAt: "2026-08-02T00:00:00.000Z",
    }
    const untrustedEntry: GitCloneJournalEntryV1 = {
      id: "untrusted",
      schemaVersion: 1,
      tempPath: untrustedTemp,
      targetPath: path.join(root, "other"),
      createdAt: "2026-08-02T00:00:00.000Z",
    }
    const { entries, journal } = createJournal([trustedEntry, untrustedEntry])
    const service = createGitCloneService({
      commandRunner: { run: vi.fn() },
      journal,
      registry: { addLocal: vi.fn() },
      pathExists: exists,
    })

    await expect(service.recoverAbandonedClones()).resolves.toEqual({ removed: 1, skipped: 1 })
    expect(await exists(trustedTemp)).toBe(false)
    expect(await exists(untrustedTemp)).toBe(true)
    expect([...entries.keys()]).toEqual(["untrusted"])
  })

  it("does not overwrite existing targets", async () => {
    const { journal } = createJournal()
    const service = createGitCloneService({
      commandRunner: { run: vi.fn() },
      journal,
      registry: { addLocal: vi.fn() },
      pathExists: async () => true,
    })

    await expect(service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      parentDirectory: "/work",
      directoryName: "docs",
    })).rejects.toThrow("目标目录已存在。请选择空目录。")
  })

  it("rejects repository directory names that escape the selected parent", async () => {
    const { journal } = createJournal()
    const service = createGitCloneService({
      commandRunner: { run: vi.fn() },
      journal,
      registry: { addLocal: vi.fn() },
      pathExists: async () => false,
    })

    await expect(service.clone({
      remoteUrl: "https://git.example.com/team/docs.git",
      parentDirectory: "/work",
      directoryName: "../outside",
    })).rejects.toThrow("仓库目录名无效。")
  })
})
