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
const readSkillRepositoryIdentity = vi.hoisted(() => vi.fn())
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
    readSkillRepositoryIdentity,
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
      displayName: "liyang",
      status: "active",
    },
    teams: [],
    syncedAt: "2026-07-01T00:00:00.000Z",
  },
}

describe("SkillRepositoryUploadService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readSkillDraftFromDirectory.mockResolvedValue(skillDraft())
    readSkillRepositoryIdentity.mockResolvedValue(null)
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
    owner: { id: "user-1", handle: "liyang", displayName: "liyang" },
    forkedFromRepositoryId: null,
    legacyContentStoreItemId: null,
    legacyInstallCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
    files: [],
    ...overrides,
  }
}
