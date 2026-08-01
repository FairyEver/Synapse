import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type { PermissionGuard } from "../../runtime/security"
import {
  createPermissionGuard,
  InMemoryAuditSink,
} from "../../runtime/security"

const mocks = vi.hoisted(() => ({
  configLoad: vi.fn(),
  commitRepositoryPaths: vi.fn(),
  getRepositoryState: vi.fn(),
  pullRepositoryWithSafeRebase: vi.fn(),
  runGitTextCommand: vi.fn(),
  writeFileError: null as Error | null,
}))

vi.mock("electron", () => ({
  app: {
    getName: () => "synapse-test",
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-user-profile-${name}`),
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
}))

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")

  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (mocks.writeFileError) {
        throw mocks.writeFileError
      }

      return actual.writeFile(...args)
    },
  }
})

vi.mock("../config-store", () => ({
  configStore: {
    load: mocks.configLoad,
  },
}))

vi.mock("../repository-store", () => ({
  repositoryStore: {
    getRepositoryState: mocks.getRepositoryState,
  },
}))

vi.mock("../git-command", () => ({
  runGitTextCommand: mocks.runGitTextCommand,
}))

vi.mock("../repository-git-mutation-service", () => ({
  commitRepositoryPaths: mocks.commitRepositoryPaths,
  pullRepositoryWithSafeRebase: mocks.pullRepositoryWithSafeRebase,
}))

import { userProfileService } from "../user-profile-service"
import { resolveUserProfilePath, userProfileCache } from "../user-profile-cache"

const tempRoots: string[] = []
const testUserId = "0123456789abcdef0123456789abcdef"

function createRepository(localPath: string): SynapseRepositoryConfig {
  return {
    contentDirs: {},
    localPath,
    name: "Test Repository",
    uuid: "repo-1",
  }
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-user-profile-"))
  tempRoots.push(root)
  return root
}

function denyPermissionGuard(): PermissionGuard {
  return {
    check: vi.fn().mockResolvedValue({
      allowed: false,
      policyId: "test-policy",
      reason: "blocked by policy",
    }),
    registerPolicy: vi.fn(() => () => undefined),
  }
}

function mockRepository(repository: SynapseRepositoryConfig, gitRootPath: string | null = null): void {
  mocks.configLoad.mockResolvedValue({
    activeRepoUuid: repository.uuid,
    agent: {
      defaultPermissionMode: "default",
      defaultProviderModel: null,
    },
    global: {
      contentSortOrder: "modified-desc",
      favorites: { prompt: [], rule: [], skill: [] },
      projects: [],
      recentlyViewed: { prompt: [], rule: [], skill: [] },
      themeMode: "system",
    },
    repositories: [repository],
  })
  mocks.getRepositoryState.mockResolvedValue({
    gitRootPath,
    isGitRepository: gitRootPath !== null,
    localPath: repository.localPath,
    status: "ready",
  })
}

describe("UserProfileService security", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.writeFileError = null
    mocks.commitRepositoryPaths.mockResolvedValue("commit-hash")
    mocks.pullRepositoryWithSafeRebase.mockResolvedValue(undefined)
    mocks.runGitTextCommand.mockResolvedValue("")
    userProfileCache.clearAll()
  })

  afterEach(async () => {
    userProfileCache.clearAll()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("records allowed fs.write audit after saving a repository profile", async () => {
    const root = await createTempRoot()
    const repository = createRepository(root)
    const auditSink = new InMemoryAuditSink()
    mockRepository(repository)

    const profile = await userProfileService.updateDisplayName(
      repository.uuid,
      testUserId,
      "Alice",
      {
        actor: { kind: "user", id: testUserId },
        auditSink,
        permissionGuard: createPermissionGuard(),
      },
    )

    const profilePath = resolveUserProfilePath(root, testUserId)
    const rawProfile = JSON.parse(await readFile(profilePath, "utf8")) as { displayName: string }

    expect(profile.displayName).toBe("Alice")
    expect(rawProfile.displayName).toBe("Alice")
    expect(auditSink.list()).toMatchObject([
      {
        action: "fs.write",
        actor: { kind: "user", id: testUserId },
        metadata: {
          operation: "user-profile.updateDisplayName",
          repoId: repository.uuid,
          userId: testUserId,
        },
        outcome: "allowed",
        resource: profilePath,
      },
    ])
  })

  it("records denied fs.write audit and does not write when policy denies", async () => {
    const root = await createTempRoot()
    const repository = createRepository(root)
    const auditSink = new InMemoryAuditSink()
    mockRepository(repository)

    await expect(userProfileService.updateDisplayName(
      repository.uuid,
      testUserId,
      "Alice",
      {
        actor: { kind: "user", id: testUserId },
        auditSink,
        permissionGuard: denyPermissionGuard(),
      },
    )).rejects.toThrow("blocked by policy")

    expect(auditSink.list()).toMatchObject([
      {
        action: "fs.write",
        metadata: {
          operation: "user-profile.updateDisplayName",
          policyId: "test-policy",
          reason: "blocked by policy",
        },
        outcome: "denied",
      },
    ])
  })

  it("records failed fs.write audit when profile persistence fails", async () => {
    const root = await createTempRoot()
    const repository = createRepository(root)
    const auditSink = new InMemoryAuditSink()
    mockRepository(repository)
    mocks.writeFileError = new Error("disk full")

    await expect(userProfileService.updateDisplayName(
      repository.uuid,
      testUserId,
      "Alice",
      {
        actor: { kind: "user", id: testUserId },
        auditSink,
        permissionGuard: createPermissionGuard(),
      },
    )).rejects.toThrow("disk full")

    expect(auditSink.list()).toMatchObject([
      {
        action: "fs.write",
        metadata: {
          errorName: "Error",
          operation: "user-profile.updateDisplayName",
          repoId: repository.uuid,
          userId: testUserId,
        },
        outcome: "failed",
      },
    ])
  })

  it("restores the previous profile file when git commit fails after writing", async () => {
    const root = await createTempRoot()
    const repository = createRepository(root)
    const auditSink = new InMemoryAuditSink()
    const profilePath = resolveUserProfilePath(root, testUserId)
    await mkdir(path.dirname(profilePath), { recursive: true })
    await writeFile(profilePath, `${JSON.stringify({
      schemaVersion: 1,
      userId: testUserId,
      displayName: "Old Name",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }, null, 2)}\n`, "utf8")
    mockRepository(repository, root)
    mocks.commitRepositoryPaths.mockRejectedValueOnce(new Error("commit rejected"))

    await expect(userProfileService.updateDisplayName(
      repository.uuid,
      testUserId,
      "Alice",
      {
        actor: { kind: "user", id: testUserId },
        auditSink,
        permissionGuard: createPermissionGuard(),
      },
    )).rejects.toThrow("commit rejected")

    const rawProfile = JSON.parse(await readFile(profilePath, "utf8")) as { displayName: string }
    expect(rawProfile.displayName).toBe("Old Name")
  })

  it("restores the post-pull profile when git commit fails after a remote update", async () => {
    const root = await createTempRoot()
    const repository = createRepository(root)
    const auditSink = new InMemoryAuditSink()
    const profilePath = resolveUserProfilePath(root, testUserId)
    await mkdir(path.dirname(profilePath), { recursive: true })
    await writeFile(profilePath, `${JSON.stringify({
      schemaVersion: 1,
      userId: testUserId,
      displayName: "Old Name",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }, null, 2)}\n`, "utf8")
    mockRepository(repository, root)
    mocks.pullRepositoryWithSafeRebase.mockImplementationOnce(async () => {
      await writeFile(profilePath, `${JSON.stringify({
        schemaVersion: 1,
        userId: testUserId,
        displayName: "Remote Name",
        updatedAt: "2026-06-02T00:00:00.000Z",
      }, null, 2)}\n`, "utf8")
    })
    mocks.commitRepositoryPaths.mockRejectedValueOnce(new Error("commit rejected"))

    await expect(userProfileService.updateDisplayName(
      repository.uuid,
      testUserId,
      "Alice",
      {
        actor: { kind: "user", id: testUserId },
        auditSink,
        permissionGuard: createPermissionGuard(),
      },
    )).rejects.toThrow("commit rejected")

    const rawProfile = JSON.parse(await readFile(profilePath, "utf8")) as { displayName: string }
    expect(rawProfile.displayName).toBe("Remote Name")
  })
})
