import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import {
  commitRepositoryPaths,
  pullRepositoryWithSafeRebase,
  readUnpushedCommitCount,
} from "../repository-git-mutation-service"

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

const execFileAsync = promisify(execFile)
const tempRoots: string[] = []

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  })
  return result.stdout.trim()
}

async function initRepository(root: string, configureIdentity: boolean): Promise<void> {
  await git(root, ["init", "-q"])
  if (configureIdentity) {
    await git(root, ["config", "user.name", "Configured User"])
    await git(root, ["config", "user.email", "configured@example.com"])
  }
  await writeFile(path.join(root, "target.md"), "target-0\n", "utf8")
  await writeFile(path.join(root, "unrelated.md"), "unrelated-0\n", "utf8")
  await git(root, ["add", "--", "target.md", "unrelated.md"])
  const identityArgs = configureIdentity
    ? []
    : ["-c", "user.name=Initial", "-c", "user.email=initial@example.com"]
  await git(root, [...identityArgs, "commit", "-qm", "initial"])
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("repository git mutation service", () => {
  it("commits only owned paths and preserves unrelated staged changes", async () => {
    const root = await createTempRoot("synapse-git-mutation-")
    await initRepository(root, true)
    await writeFile(path.join(root, "target.md"), "target-1\n", "utf8")
    await writeFile(path.join(root, "unrelated.md"), "unrelated-1\n", "utf8")
    await git(root, ["add", "--", "unrelated.md"])

    await commitRepositoryPaths({
      fallbackMessage: "commit failed",
      filePaths: [path.join(root, "target.md")],
      gitRootPath: root,
      message: "target only",
    })

    expect(await git(root, ["show", "--pretty=", "--name-only", "HEAD"])).toBe("target.md")
    expect(await git(root, ["diff", "--cached", "--name-only"])).toBe("unrelated.md")
    expect(await git(root, ["config", "--local", "user.name"])).toBe("Configured User")
    expect(await git(root, ["config", "--local", "user.email"])).toBe("configured@example.com")
  })

  it("rejects paths outside the resolved Git root before staging", async () => {
    const root = await createTempRoot("synapse-git-path-")
    const outsideRoot = await createTempRoot("synapse-git-outside-")
    await initRepository(root, true)
    const outsidePath = path.join(outsideRoot, "outside.md")
    await writeFile(outsidePath, "outside\n", "utf8")

    await expect(commitRepositoryPaths({
      fallbackMessage: "commit failed",
      filePaths: [outsidePath],
      gitRootPath: root,
      message: "outside",
    })).rejects.toThrow("提交路径必须位于当前 Git 仓库内")
    expect(await git(root, ["status", "--porcelain"])).toBe("")
  })

  it("uses a command-only Bot identity when Git identity is missing", async () => {
    const root = await createTempRoot("synapse-git-identity-")
    const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL
    const previousNoSystemConfig = process.env.GIT_CONFIG_NOSYSTEM
    process.env.GIT_CONFIG_GLOBAL = path.join(root, "empty-global-config")
    process.env.GIT_CONFIG_NOSYSTEM = "1"
    try {
      await initRepository(root, false)
      await writeFile(path.join(root, "target.md"), "target-1\n", "utf8")

      await commitRepositoryPaths({
        fallbackMessage: "commit failed",
        filePaths: [path.join(root, "target.md")],
        gitRootPath: root,
        message: "bot fallback",
      })

      expect(await git(root, ["show", "-s", "--format=%an <%ae>", "HEAD"])).toBe("Synapse Bot <bot@synapse.local>")
      await expect(execFileAsync("git", ["-C", root, "config", "--local", "--get", "user.name"]))
        .rejects
        .toBeTruthy()
    } finally {
      if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig
      if (previousNoSystemConfig === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
      else process.env.GIT_CONFIG_NOSYSTEM = previousNoSystemConfig
    }
  })

  it("detects local-only commits when the branch has no upstream", async () => {
    const root = await createTempRoot("synapse-git-ahead-")
    await initRepository(root, true)
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: root,
      contentDirs: {},
    }

    expect(await readUnpushedCommitCount(repository, {
      repositoryUuid: repository.uuid,
      localPath: root,
      status: "ready",
      isGitRepository: true,
      gitRootPath: root,
    })).toBe(1)
  })

  it("aborts only the rebase started by a conflicting pull and preserves local content", async () => {
    const root = await createTempRoot("synapse-git-rebase-")
    const remote = path.join(root, "remote.git")
    const local = path.join(root, "local")
    const peer = path.join(root, "peer")
    await execFileAsync("git", ["init", "--bare", "-q", remote])
    await execFileAsync("git", ["clone", "-q", remote, local])
    await git(local, ["config", "user.name", "Local"])
    await git(local, ["config", "user.email", "local@example.com"])
    await writeFile(path.join(local, "shared.md"), "base\n", "utf8")
    await git(local, ["add", "shared.md"])
    await git(local, ["commit", "-qm", "base"])
    await git(local, ["push", "-q", "-u", "origin", "HEAD"])
    await execFileAsync("git", ["clone", "-q", remote, peer])
    await git(peer, ["config", "user.name", "Peer"])
    await git(peer, ["config", "user.email", "peer@example.com"])
    await writeFile(path.join(local, "shared.md"), "local\n", "utf8")
    await git(local, ["add", "shared.md"])
    await git(local, ["commit", "-qm", "local"])
    await writeFile(path.join(peer, "shared.md"), "remote\n", "utf8")
    await git(peer, ["add", "shared.md"])
    await git(peer, ["commit", "-qm", "remote"])
    await git(peer, ["push", "-q"])
    const repository: SynapseRepositoryConfig = {
      uuid: "repo-1",
      name: "Repo",
      localPath: local,
      contentDirs: {},
    }

    await expect(pullRepositoryWithSafeRebase(repository)).rejects.toBeTruthy()

    expect(await readFile(path.join(local, "shared.md"), "utf8")).toBe("local\n")
    expect(await git(local, ["status", "--porcelain"])).toBe("")
    expect(await git(local, ["log", "-1", "--format=%s"])).toBe("local")
  })
})
