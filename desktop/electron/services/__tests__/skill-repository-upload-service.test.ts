import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SkillRepositoryDetailDto, SkillRepositoryImportInput } from "@synapse/shared" with { "resolution-mode": "import" }
import type { SynapseAccountState } from "../../../src/types/account"
import type { ContentSkillSourceDraft } from "../content-skill-source-service"

const serviceLogger = vi.hoisted(() => {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
})

const readSkillDraftFromDirectory = vi.hoisted(() => vi.fn())
const ensureSkillRepositoryIdentityWriteAllowed = vi.hoisted(() => vi.fn())
const readSkillRepositoryIdentity = vi.hoisted(() => vi.fn())
const removeLegacySkillRepositoryIdentity = vi.hoisted(() => vi.fn())
const writeSkillRepositoryIdentity = vi.hoisted(() => vi.fn())

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-skill-repository-upload-${name}`),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher: Buffer) => cipher.toString("utf8"),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => serviceLogger,
}))

vi.mock("../../generated/deployment-config.generated", () => ({
  SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG: {
    apiBaseUrl: "https://api.synapse.example.test",
    publicAppUrl: "https://synapse.example.test",
  },
}))

vi.mock("../generated/deployment-config.generated", () => ({
  SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG: {
    apiBaseUrl: "https://api.synapse.example.test",
    publicAppUrl: "https://synapse.example.test",
  },
}))

vi.mock("../content-skill-source-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content-skill-source-service")>()
  return {
    ...actual,
    readSkillDraftFromDirectory,
  }
})

vi.mock("../skill-repository-local-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skill-repository-local-identity")>()
  return {
    ...actual,
    ensureSkillRepositoryIdentityWriteAllowed,
    readSkillRepositoryIdentity,
    removeLegacySkillRepositoryIdentity,
    writeSkillRepositoryIdentity,
  }
})

import { AccountAuthenticationRequiredError } from "../account-service"
import { SkillRepositoryUploadService } from "../skill-repository-upload-service"

const authenticatedState: SynapseAccountState = {
  status: "authenticated",
  connectivity: "online",
  profile: {
    user: {
      id: "user-1",
      email: "liyang@example.test",
      handle: "liyang",
      status: "active",
    },
    teams: [],
    syncedAt: "2026-07-01T00:00:00.000Z",
  },
}

const identity = {
  id: "repo-1",
  kind: "cloud-skill-repository" as const,
  owner: "liyang",
  name: "demo-skill",
}

describe("SkillRepositoryUploadService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readSkillDraftFromDirectory.mockResolvedValue(skillDraft())
    ensureSkillRepositoryIdentityWriteAllowed.mockResolvedValue(undefined)
    readSkillRepositoryIdentity.mockReset()
    readSkillRepositoryIdentity.mockResolvedValueOnce(null).mockResolvedValue(identity)
    removeLegacySkillRepositoryIdentity.mockResolvedValue(false)
    writeSkillRepositoryIdentity.mockResolvedValue(undefined)
  })

  it("imports a local Skill directory, uploads root SKILL.md, and writes cloud identity", async () => {
    const importSkillRepository = vi.fn(async (input: SkillRepositoryImportInput) => repositoryDetail({
      name: input.name ?? "demo-skill",
      title: input.title ?? "Demo Skill",
    }))
    const openExternal = vi.fn()
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
      publicAppUrl: "https://synapse.example.test/",
      openExternal,
    })

    await expect(service.importLocal({ sourceDirectoryPath: "/skills/demo" })).resolves.toEqual({
      repositoryId: "repo-1",
      name: "demo-skill",
      owner: "liyang",
      managementUrl: "https://synapse.example.test/console/skill-repositories/repo-1",
      identityWritten: true,
      identityMigrated: false,
      sourceImportSummary: skillDraft().sourceImportSummary,
    })

    expect(importSkillRepository).toHaveBeenCalledWith({
      repositoryId: undefined,
      name: "demo-skill",
      title: "Demo Skill",
      description: null,
      files: [
        {
          path: "SKILL.md",
          contentBase64: Buffer.from("# Demo", "utf8").toString("base64"),
          mimeType: "text/markdown",
        },
      ],
    })
    expect(writeSkillRepositoryIdentity).toHaveBeenCalledWith("/skills/demo", {
      id: "repo-1",
      kind: "cloud-skill-repository",
      owner: "liyang",
      name: "demo-skill",
    }, undefined)
    expect(removeLegacySkillRepositoryIdentity).toHaveBeenCalledWith("/skills/demo", undefined)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it("passes explicit repositoryId for updates", async () => {
    const importSkillRepository = vi.fn(async () => repositoryDetail())
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await service.importLocal({ sourceDirectoryPath: "/skills/demo", repositoryId: "repo-update" })

    expect(importSkillRepository).toHaveBeenCalledWith(expect.objectContaining({
      repositoryId: "repo-update",
    }))
  })

  it("uses local cloud identity repositoryId when explicit repositoryId is absent", async () => {
    readSkillRepositoryIdentity.mockReset()
    readSkillRepositoryIdentity.mockResolvedValue({
      id: "repo-local",
      kind: "cloud-skill-repository",
      owner: "liyang",
      name: "demo-skill",
    })
    const importSkillRepository = vi.fn(async () => repositoryDetail({ id: "repo-local" }))
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await service.importLocal({ sourceDirectoryPath: "/skills/demo" })

    expect(readSkillRepositoryIdentity).toHaveBeenCalledWith("/skills/demo")
    expect(importSkillRepository).toHaveBeenCalledWith(expect.objectContaining({
      repositoryId: "repo-local",
    }))
  })

  it("recreates a repository when the local cloud identity is stale", async () => {
    readSkillRepositoryIdentity.mockReset()
    readSkillRepositoryIdentity.mockResolvedValue({
      id: "repo-stale",
      kind: "cloud-skill-repository",
      owner: "liyang",
      name: "demo-skill",
    })
    const staleIdentityError = Object.assign(new Error("Skill 仓库不存在。"), {
      status: 404,
      code: "NOT_FOUND",
    })
    const importSkillRepository = vi.fn(async (input: SkillRepositoryImportInput) => {
      if (input.repositoryId === "repo-stale") throw staleIdentityError
      return repositoryDetail({ id: "repo-new" })
    })
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await expect(service.importLocal({ sourceDirectoryPath: "/skills/demo" })).resolves.toMatchObject({
      repositoryId: "repo-new",
      identityWritten: true,
    })

    expect(importSkillRepository).toHaveBeenNthCalledWith(1, expect.objectContaining({
      repositoryId: "repo-stale",
    }))
    expect(importSkillRepository).toHaveBeenNthCalledWith(2, expect.objectContaining({
      repositoryId: undefined,
    }))
    expect(writeSkillRepositoryIdentity).toHaveBeenCalledWith("/skills/demo", {
      id: "repo-new",
      kind: "cloud-skill-repository",
      owner: "liyang",
      name: "demo-skill",
    }, undefined)
  })

  it("preflights identity write permission before cloud import", async () => {
    ensureSkillRepositoryIdentityWriteAllowed.mockRejectedValueOnce(new Error("denied by policy"))
    const importSkillRepository = vi.fn()
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await expect(service.importLocal({ sourceDirectoryPath: "/skills/demo" }))
      .rejects.toThrow("denied by policy")

    expect(ensureSkillRepositoryIdentityWriteAllowed).toHaveBeenCalledWith("/skills/demo", undefined)
    expect(importSkillRepository).not.toHaveBeenCalled()
  })

  it("stops before upload when the confirmed local snapshot changed", async () => {
    const importSkillRepository = vi.fn()
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await expect(service.importLocal({
      sourceDirectoryPath: "/skills/demo",
      expectedSourceFingerprint: "sha256:older",
    })).rejects.toThrow("本地 Skill 在确认后发生变化")
    expect(importSkillRepository).not.toHaveBeenCalled()
  })

  it("returns cloud upload success when identity write fails after import", async () => {
    writeSkillRepositoryIdentity.mockRejectedValueOnce(new Error("disk full"))
    const importSkillRepository = vi.fn(async () => repositoryDetail())
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await expect(service.importLocal({ sourceDirectoryPath: "/skills/demo" })).resolves.toMatchObject({
      repositoryId: "repo-1",
      identityWritten: false,
      identityWriteError: "disk full",
    })
    expect(importSkillRepository).toHaveBeenCalled()
  })

  it("uploads attachment bytes by originalName and rejects missing attachment bytes", async () => {
    readSkillDraftFromDirectory.mockResolvedValue(skillDraft({
      files: [
        { originalName: "assets/guide.txt", size: 5, bytes: Buffer.from("hello") },
        { originalName: "assets/missing.bin", size: 10 },
      ],
    }))
    const importSkillRepository = vi.fn(async () => repositoryDetail())
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await expect(service.importLocal({ sourceDirectoryPath: "/skills/demo" }))
      .rejects.toThrow("无法读取 Skill 附件：assets/missing.bin")
    expect(importSkillRepository).not.toHaveBeenCalled()

    readSkillDraftFromDirectory.mockResolvedValue(skillDraft({
      files: [
        { originalName: "assets/guide.txt", size: 5, bytes: Buffer.from("hello") },
      ],
    }))
    await service.importLocal({ sourceDirectoryPath: "/skills/demo" })

    expect(importSkillRepository).toHaveBeenCalledWith(expect.objectContaining({
      files: [
        {
          path: "SKILL.md",
          contentBase64: Buffer.from("# Demo", "utf8").toString("base64"),
          mimeType: "text/markdown",
        },
        {
          path: "assets/guide.txt",
          contentBase64: Buffer.from("hello").toString("base64"),
          mimeType: null,
        },
      ],
    }))
  })

  it("rejects unauthenticated accounts before reading local files", async () => {
    const importSkillRepository = vi.fn()
    const service = new SkillRepositoryUploadService({
      accountService: {
        getState: () => ({ status: "unauthenticated" }),
        importSkillRepository,
      },
    })

    await expect(service.importLocal({ sourceDirectoryPath: "/skills/demo" }))
      .rejects.toBeInstanceOf(AccountAuthenticationRequiredError)

    expect(readSkillDraftFromDirectory).not.toHaveBeenCalled()
    expect(importSkillRepository).not.toHaveBeenCalled()
  })

  it("rejects local sources whose main file basename is not exactly SKILL.md", async () => {
    readSkillDraftFromDirectory.mockResolvedValue(skillDraft({
      mainFilePath: "/skills/demo/README.md",
    }))
    const importSkillRepository = vi.fn()
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository },
    })

    await expect(service.importLocal({ sourceDirectoryPath: "/skills/demo" }))
      .rejects.toThrow("Skill 必须包含根目录 SKILL.md。")

    expect(importSkillRepository).not.toHaveBeenCalled()
  })

  it("opens the management URL only when requested and an opener is provided", async () => {
    const openExternal = vi.fn()
    const service = new SkillRepositoryUploadService({
      accountService: { getState: () => authenticatedState, importSkillRepository: vi.fn(async () => repositoryDetail()) },
      publicAppUrl: "https://synapse.example.test/",
      openExternal,
    })

    await service.importLocal({ sourceDirectoryPath: "/skills/demo", openInBrowser: true })

    expect(openExternal).toHaveBeenCalledWith("https://synapse.example.test/console/skill-repositories/repo-1")
  })
})

function skillDraft(overrides: Partial<ContentSkillSourceDraft> = {}): ContentSkillSourceDraft {
  return {
    sourceDirectoryPath: "/skills/demo",
    mainFilePath: "/skills/demo/SKILL.md",
    content: "# Demo",
    metadata: { name: "demo-skill", title: "Demo Skill" },
    files: [],
    publishFingerprint: "sha256:publish",
    sourceFingerprint: "sha256:source",
    sourceImportSummary: {
      controlFilesExcluded: [],
      fileCount: 1,
      hiddenEntryCount: 0,
      runtimeEnvExcluded: false,
      symlinkCount: 0,
      totalBytes: 6,
    },
    ...overrides,
  }
}

function repositoryDetail(overrides: Partial<SkillRepositoryDetailDto> = {}): SkillRepositoryDetailDto {
  return {
    id: "repo-1",
    name: "demo-skill",
    title: "Demo Skill",
    description: null,
    visibility: "private",
    status: "active",
    owner: { id: "user-1", handle: "liyang" },
    forkedFromRepositoryId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
    files: [],
    ...overrides,
  }
}
