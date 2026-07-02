import { Readable } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import type { ContentStoreStoragePort } from "../content-store/content-store-storage"
import { SkillRepositoryLegacyMigrationService } from "./skill-repository-legacy-migration.service"

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto")
  let nextUuid = 1
  return {
    ...actual,
    randomUUID: vi.fn(() => `legacy-${nextUuid++}`),
  }
})

type MockFn = ReturnType<typeof vi.fn>

interface PrismaMock {
  $transaction: MockFn
  contentStoreDraft: {
    findUnique: MockFn
  }
  contentStoreItem: {
    findMany: MockFn
  }
  contentStoreVersion: {
    findUnique: MockFn
  }
  skillRepository: {
    create: MockFn
    findFirst: MockFn
    findUnique: MockFn
  }
  skillRepositoryFile: {
    createMany: MockFn
  }
  skillRepositoryNameRedirect: {
    findUnique: MockFn
  }
}

interface StorageMock {
  putObject: MockFn
  getObjectStream: MockFn
  deleteObject: MockFn
}

describe("SkillRepositoryLegacyMigrationService", () => {
  let prisma: PrismaMock
  let storage: StorageMock
  let repositories: Array<Record<string, unknown>>
  let files: Array<Record<string, unknown>>
  let service: SkillRepositoryLegacyMigrationService

  beforeEach(() => {
    repositories = []
    files = []
    prisma = createPrismaMock(repositories, files)
    storage = createStorageMock()
    service = new SkillRepositoryLegacyMigrationService(
      prisma as unknown as PrismaService,
      storage as unknown as ContentStoreStoragePort,
    )
  })

  it("migrates a published legacy Content Store Skill once", async () => {
    prisma.contentStoreItem.findMany.mockResolvedValue([
      legacyItemRow(),
    ])
    prisma.contentStoreVersion.findUnique.mockResolvedValue(legacySourceRow())
    storage.getObjectStream
      .mockResolvedValueOnce({ stream: bufferStream("# Demo Skill\n") })
      .mockResolvedValueOnce({ stream: bufferStream("Usage\n") })

    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      scanned: 1,
      migrated: 1,
      alreadyMigrated: 0,
      skipped: [],
      warnings: [],
    })
    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      scanned: 1,
      migrated: 0,
      alreadyMigrated: 1,
      skipped: [],
    })

    expect(repositories).toHaveLength(1)
    expect(repositories[0]).toMatchObject({
      id: "legacy-1",
      ownerUserId: "user-1",
      name: "demo-skill",
      title: "Demo Skill",
      description: "Legacy skill",
      visibility: "public",
      legacyContentStoreItemId: "content-skill-1",
      legacyInstallCount: 2,
    })
    expect(files).toEqual([
      expect.objectContaining({
        repositoryId: "legacy-1",
        path: "SKILL.md",
        pathKey: "skill.md",
      }),
      expect.objectContaining({
        repositoryId: "legacy-1",
        path: "README.md",
        pathKey: "readme.md",
      }),
    ])
    expect(storage.putObject).toHaveBeenCalledTimes(2)
  })

  it("skips non-Skill legacy Content Store items", async () => {
    prisma.contentStoreItem.findMany.mockResolvedValue([
      legacyItemRow({ id: "content-rule-1", type: "rule" }),
    ])

    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      scanned: 1,
      migrated: 0,
      alreadyMigrated: 0,
      skipped: [
        {
          contentStoreItemId: "content-rule-1",
          reason: "not_skill",
        },
      ],
    })
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("keeps public legacy Skills private when owner handle is missing", async () => {
    prisma.contentStoreItem.findMany.mockResolvedValue([
      legacyItemRow({ owner: { handle: null } }),
    ])
    prisma.contentStoreVersion.findUnique.mockResolvedValue(legacySourceRow())
    storage.getObjectStream
      .mockResolvedValueOnce({ stream: bufferStream("# Demo Skill\n") })
      .mockResolvedValueOnce({ stream: bufferStream("Usage\n") })

    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      migrated: 1,
      warnings: [
        {
          contentStoreItemId: "content-skill-1",
          code: "USER_HANDLE_REQUIRED",
        },
      ],
    })
    expect(repositories[0]).toMatchObject({
      visibility: "private",
    })
  })

  it("maps legacy copied Skills to forked Skill repositories", async () => {
    prisma.contentStoreItem.findMany.mockResolvedValue([
      legacyItemRow({ id: "content-source", title: "Source Skill", latestVersionId: "version-source" }),
      legacyItemRow({
        id: "content-copy",
        title: "Copied Skill",
        latestVersionId: "version-copy",
        copiedFromContentId: "content-source",
      }),
    ])
    prisma.contentStoreVersion.findUnique
      .mockResolvedValueOnce(legacySourceRow({ id: "version-source", title: "Source Skill" }))
      .mockResolvedValueOnce(legacySourceRow({ id: "version-copy", title: "Copied Skill" }))
    storage.getObjectStream
      .mockResolvedValueOnce({ stream: bufferStream("# Source Skill\n") })
      .mockResolvedValueOnce({ stream: bufferStream("Source usage\n") })
      .mockResolvedValueOnce({ stream: bufferStream("# Copied Skill\n") })
      .mockResolvedValueOnce({ stream: bufferStream("Copied usage\n") })

    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      scanned: 2,
      migrated: 2,
      warnings: [],
    })

    const sourceRepositoryId = repositories[0]?.id
    expect(repositories[0]).toMatchObject({
      legacyContentStoreItemId: "content-source",
    })
    expect(repositories[1]).toMatchObject({
      legacyContentStoreItemId: "content-copy",
      forkedFromRepositoryId: sourceRepositoryId,
    })
  })

  it("warns and keeps migrating when a copied Skill source is not migrated", async () => {
    prisma.contentStoreItem.findMany.mockResolvedValue([
      legacyItemRow({
        id: "content-copy",
        copiedFromContentId: "missing-content",
      }),
    ])
    prisma.contentStoreVersion.findUnique.mockResolvedValue(legacySourceRow())
    storage.getObjectStream
      .mockResolvedValueOnce({ stream: bufferStream("# Demo Skill\n") })
      .mockResolvedValueOnce({ stream: bufferStream("Usage\n") })

    await expect(service.migrateOwnerSkills("user-1")).resolves.toMatchObject({
      scanned: 1,
      migrated: 1,
      warnings: [
        {
          contentStoreItemId: "content-copy",
          code: "SKILL_REPOSITORY_LEGACY_FORK_SOURCE_MISSING",
        },
      ],
    })

    expect(repositories[0]).toMatchObject({
      legacyContentStoreItemId: "content-copy",
    })
    expect(repositories[0]).not.toHaveProperty("forkedFromRepositoryId")
  })
})

function createPrismaMock(
  repositories: Array<Record<string, unknown>>,
  files: Array<Record<string, unknown>>,
): PrismaMock {
  const mock = {
    $transaction: vi.fn(),
    contentStoreDraft: {
      findUnique: vi.fn(async () => null),
    },
    contentStoreItem: {
      findMany: vi.fn(),
    },
    contentStoreVersion: {
      findUnique: vi.fn(),
    },
    skillRepository: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        repositories.push(data)
        return data
      }),
      findFirst: vi.fn(async ({ where }: { where: { ownerUserId: string; name: string } }) =>
        repositories.find((repository) =>
          repository.ownerUserId === where.ownerUserId && repository.name === where.name) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { legacyContentStoreItemId?: string } }) => {
        if (!where.legacyContentStoreItemId) return null
        return repositories.find((repository) =>
          repository.legacyContentStoreItemId === where.legacyContentStoreItemId) ?? null
      }),
    },
    skillRepositoryFile: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        files.push(...data)
        return { count: data.length }
      }),
    },
    skillRepositoryNameRedirect: {
      findUnique: vi.fn(async () => null),
    },
  }
  mock.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => callback(mock))
  return mock
}

function createStorageMock(): StorageMock {
  return {
    putObject: vi.fn(async () => undefined),
    getObjectStream: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
  }
}

function legacyItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "content-skill-1",
    type: "skill",
    title: "Demo Skill",
    description: "Legacy skill",
    ownerUserId: "user-1",
    visibility: "public",
    moderationStatus: "normal",
    latestVersionId: "version-1",
    copiedFromContentId: null,
    owner: { handle: "liyang" },
    _count: { installEvents: 2 },
    ...overrides,
  }
}

function legacySourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    title: "Demo Skill",
    description: "Legacy skill",
    files: [
      {
        path: "SKILL.md",
        storageKey: "content-store/files/skill-md",
        text: null,
        mimeType: "text/markdown",
      },
      {
        path: "README.md",
        storageKey: "content-store/files/readme",
        text: null,
        mimeType: "text/markdown",
      },
    ],
    ...overrides,
  }
}

function bufferStream(value: string | Buffer): Readable {
  return Readable.from([typeof value === "string" ? Buffer.from(value) : value])
}
