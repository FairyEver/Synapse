import { BadRequestException, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { SkillRepositoryService } from "./skill-repository.service"
import type { ContentStoreStoragePort } from "../content-store/content-store-storage"
import { normalizeSkillRepositoryPath } from "./skill-repository-file-rules"

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto")
  let nextUuid = 1
  return {
    ...actual,
    randomUUID: vi.fn(() => `file-${nextUuid++}`),
  }
})

describe("SkillRepositoryService", () => {
  let prisma: PrismaMock
  let storage: StorageMock
  let service: SkillRepositoryService

  beforeEach(() => {
    prisma = createPrismaMock()
    storage = createStorageMock()
    prisma.$transaction.mockImplementation(async (callback: TransactionInput) => callback(prisma))
    service = new SkillRepositoryService(prisma as unknown as PrismaService, storage as unknown as ContentStoreStoragePort)
  })

  it("imports a private repository from a packaged Skill file tree", async () => {
    const skillText = "# Demo Skill\n"
    const readmeText = "Usage\n"
    prisma.skillRepository.findFirst.mockResolvedValue(null)
    prisma.skillRepositoryNameRedirect.findUnique.mockResolvedValue(null)
    prisma.skillRepository.create.mockResolvedValue(repositoryRow({
      id: "repo-1",
      name: "demo-skill",
      title: "Demo Skill",
      owner: ownerRow(),
    }))
    prisma.skillRepository.update.mockResolvedValue(repositoryRow({ id: "repo-1", name: "demo-skill", title: "Demo Skill" }))
    prisma.skillRepositoryFile.findMany.mockResolvedValueOnce([])
    prisma.skillRepository.findFirst.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(repositoryRow({
        id: "repo-1",
        name: "demo-skill",
        title: "Demo Skill",
        owner: ownerRow(),
        files: [
          repositoryFileRow({
            id: "file-row-1",
            path: "README.md",
            pathKey: "readme.md",
            storageKey: "skill-repositories/repo-1/files/file-2/03828777bb523525406c9d69f5dfa8a79b7691f6d2dc4bdfbf6d0d45b741255e",
            text: readmeText,
            sha256: "03828777bb523525406c9d69f5dfa8a79b7691f6d2dc4bdfbf6d0d45b741255e",
            size: BigInt(Buffer.byteLength(readmeText)),
          }),
          repositoryFileRow({
            id: "file-row-2",
            path: "SKILL.md",
            pathKey: "skill.md",
            storageKey: "skill-repositories/repo-1/files/file-1/87baa74680c93d2d14f37cbfda03dd3a06fc30cb3e999a867196fb0392ef122a",
            text: skillText,
            sha256: "87baa74680c93d2d14f37cbfda03dd3a06fc30cb3e999a867196fb0392ef122a",
            size: BigInt(Buffer.byteLength(skillText)),
          }),
        ],
      }))

    const result = await service.importRepository("user-1", {
      name: "demo-skill",
      title: "Demo Skill",
      files: [
        { path: "SKILL.md", contentBase64: Buffer.from(skillText).toString("base64"), mimeType: "text/markdown" },
        { path: "README.md", contentBase64: Buffer.from(readmeText).toString("base64"), mimeType: "text/markdown" },
      ],
    })

    expect(result).toMatchObject({
      id: "repo-1",
      name: "demo-skill",
      visibility: "private",
      owner: { id: "user-1", handle: "alice", displayName: "Alice" },
    })
    expect(prisma.skillRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerUserId: "user-1",
        name: "demo-skill",
        visibility: "private",
        status: "active",
      }),
    }))
    expect(storage.putObject).toHaveBeenNthCalledWith(1, expect.objectContaining({
      key: "skill-repositories/repo-1/files/file-1/87baa74680c93d2d14f37cbfda03dd3a06fc30cb3e999a867196fb0392ef122a",
      contentType: "text/markdown",
    }))
    expect(storage.putObject).toHaveBeenNthCalledWith(2, expect.objectContaining({
      key: "skill-repositories/repo-1/files/file-2/03828777bb523525406c9d69f5dfa8a79b7691f6d2dc4bdfbf6d0d45b741255e",
      contentType: "text/markdown",
    }))
    expect(prisma.skillRepositoryFile.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          repositoryId: "repo-1",
          path: "SKILL.md",
          pathKey: "skill.md",
          storageKey: "skill-repositories/repo-1/files/file-1/87baa74680c93d2d14f37cbfda03dd3a06fc30cb3e999a867196fb0392ef122a",
        }),
        expect.objectContaining({
          repositoryId: "repo-1",
          path: "README.md",
          pathKey: "readme.md",
          storageKey: "skill-repositories/repo-1/files/file-2/03828777bb523525406c9d69f5dfa8a79b7691f6d2dc4bdfbf6d0d45b741255e",
        }),
      ],
    })
  })

  it("rejects same-name import without repositoryId", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(repositoryRow({ id: "repo-existing", name: "demo-skill" }))

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toMatchObject({
      response: { code: "SKILL_REPOSITORY_NAME_CONFLICT" },
    })

    expect(prisma.skillRepositoryNameRedirect.findUnique).not.toHaveBeenCalled()
    expect(prisma.skillRepository.create).not.toHaveBeenCalled()
  })

  it("checks same-name conflicts against removed repositories before create", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(repositoryRow({
      id: "repo-removed",
      name: "demo-skill",
      status: "removed",
    }))

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toMatchObject({
      response: { code: "SKILL_REPOSITORY_NAME_CONFLICT" },
    })

    expect(prisma.skillRepository.findFirst).toHaveBeenCalledWith({
      where: { ownerUserId: "user-1", name: "demo-skill" },
    })
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("maps owner/name unique races to structured name conflicts", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(null)
    prisma.skillRepositoryNameRedirect.findUnique.mockResolvedValue(null)
    prisma.skillRepository.create.mockRejectedValue(createPrismaKnownRequestError("P2002"))

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toMatchObject({
      response: { code: "SKILL_REPOSITORY_NAME_CONFLICT" },
    })

    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("rejects name redirect conflict without repositoryId", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(null)
    prisma.skillRepositoryNameRedirect.findUnique.mockResolvedValue({ id: "redirect-1" })

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toMatchObject({
      response: { code: "SKILL_REPOSITORY_NAME_CONFLICT" },
    })

    expect(prisma.skillRepositoryNameRedirect.findUnique).toHaveBeenCalledWith({
      where: { ownerUserId_oldName: { ownerUserId: "user-1", oldName: "demo-skill" } },
    })
    expect(prisma.skillRepository.create).not.toHaveBeenCalled()
  })

  it("updates an owned repository only when repositoryId is explicit", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      ownerUserId: "user-1",
      name: "demo-skill",
      title: "Old Title",
    }))
    prisma.skillRepositoryFile.findMany.mockResolvedValueOnce([
      { storageKey: "skill-repositories/repo-1/files/old-file/oldsha" },
    ])
    prisma.skillRepository.update.mockResolvedValue(repositoryRow({
      id: "repo-1",
      title: "New Title",
      description: "Updated",
    }))
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      title: "New Title",
      description: "Updated",
      files: [repositoryFileRow({
        id: "file-row-1",
        path: "SKILL.md",
        pathKey: "skill.md",
        text: "# Updated",
        sha256: "22e127a7f2d892b375cc37ca455ab6a6f0c0da9ac42e58d1b4c5cc45d11d7902",
        size: BigInt(Buffer.byteLength("# Updated")),
      })],
    }))

    const result = await service.importRepository("user-1", {
      repositoryId: "repo-1",
      name: "ignored-name",
      title: "New Title",
      description: " Updated ",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Updated").toString("base64") }],
    })

    expect(result).toMatchObject({ id: "repo-1", name: "demo-skill", title: "New Title", description: "Updated" })
    expect(prisma.skillRepository.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "repo-1", ownerUserId: "user-1", visibility: "private", status: "active" },
    })
    expect(prisma.skillRepository.create).not.toHaveBeenCalled()
    expect(prisma.skillRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "repo-1" },
      data: expect.objectContaining({
        title: "New Title",
        description: "Updated",
        lastSyncedAt: expect.any(Date),
      }),
    }))
    expect(prisma.skillRepositoryFile.deleteMany).toHaveBeenCalledWith({ where: { repositoryId: "repo-1" } })
    expect(prisma.skillRepositoryFile.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ repositoryId: "repo-1", path: "SKILL.md", pathKey: "skill.md" })],
    })
    expect(storage.deleteObject).toHaveBeenCalledWith("skill-repositories/repo-1/files/old-file/oldsha")
  })

  it("cleans up newly uploaded objects when DB file replacement fails", async () => {
    const dbError = new Error("db createMany failed")
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      ownerUserId: "user-1",
      name: "demo-skill",
      title: "Old Title",
    }))
    prisma.skillRepositoryFile.findMany.mockResolvedValueOnce([])
    prisma.skillRepository.update.mockResolvedValue(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.createMany.mockRejectedValue(dbError)

    await expect(service.importRepository("user-1", {
      repositoryId: "repo-1",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Updated").toString("base64") }],
    })).rejects.toBe(dbError)

    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^skill-repositories\/repo-1\/files\/file-\d+\/[a-f0-9]{64}$/u),
    }))
    expect(storage.deleteObject).toHaveBeenCalledWith(expect.stringMatching(/^skill-repositories\/repo-1\/files\/file-\d+\/[a-f0-9]{64}$/u))
  })

  it("rejects updates to repositories owned by another user", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(null)

    await expect(service.importRepository("user-1", {
      repositoryId: "foreign-repo",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toThrow(NotFoundException)

    expect(prisma.skillRepository.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-repo", ownerUserId: "user-1", visibility: "private", status: "active" },
    })
    expect(prisma.skillRepositoryFile.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects repositories without a non-empty root SKILL.md", async () => {
    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [{ path: "docs/SKILL.md", contentBase64: Buffer.from("# Nested").toString("base64") }],
    })).rejects.toMatchObject({
      constructor: BadRequestException,
      response: { code: "SKILL_REPOSITORY_INVALID_SKILL" },
    })

    expect(prisma.skillRepository.create).not.toHaveBeenCalled()
  })

  it("rejects DB-constrained file metadata before storage upload", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(null)
    prisma.skillRepositoryNameRedirect.findUnique.mockResolvedValue(null)
    prisma.skillRepository.create.mockResolvedValue(repositoryRow({ id: "repo-1" }))

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [
        { path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") },
        { path: `${"a".repeat(1025)}.md`, contentBase64: Buffer.from("too long").toString("base64") },
      ],
    })).rejects.toThrow(BadRequestException)

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      files: [
        { path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64"), mimeType: "x".repeat(256) },
      ],
    })).rejects.toThrow(BadRequestException)

    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("normalizes blank mimeType to null before upload and file rows", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(null)
    prisma.skillRepositoryNameRedirect.findUnique.mockResolvedValue(null)
    prisma.skillRepository.create.mockResolvedValue(repositoryRow({ id: "repo-1" }))
    prisma.skillRepository.update.mockResolvedValue(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findMany.mockResolvedValueOnce([])
    prisma.skillRepository.findFirst.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(repositoryRow({
        id: "repo-1",
        files: [repositoryFileRow({ mimeType: null })],
      }))

    await service.importRepository("user-1", {
      name: "demo-skill",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64"), mimeType: "   " }],
    })

    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ contentType: undefined }))
    expect(prisma.skillRepositoryFile.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ mimeType: null })],
    })
  })

  it("rejects oversized title and description before storage upload", async () => {
    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      title: "a".repeat(161),
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toThrow(BadRequestException)

    await expect(service.importRepository("user-1", {
      name: "demo-skill",
      description: "a".repeat(2001),
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Demo").toString("base64") }],
    })).rejects.toThrow(BadRequestException)

    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("listMine returns owned active repos ordered by updatedAt desc and maps owner handle", async () => {
    prisma.skillRepository.findMany.mockResolvedValue([
      repositoryRow({ id: "repo-new", name: "new-skill", updatedAt: new Date("2026-06-02T00:00:00.000Z") }),
      repositoryRow({ id: "repo-old", name: "old-skill", updatedAt: new Date("2026-06-01T00:00:00.000Z") }),
    ])

    const result = await service.listMine("user-1")

    expect(prisma.skillRepository.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: "user-1", visibility: "private", status: "active" },
      orderBy: { updatedAt: "desc" },
    }))
    expect(result.map((repo) => repo.id)).toEqual(["repo-new", "repo-old"])
    expect(result[0]).toMatchObject({
      owner: { id: "user-1", handle: "alice", displayName: "Alice" },
      legacyInstallCount: 3,
    })
  })

  it("getMine throws NotFoundException for missing or foreign repos", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(null)

    await expect(service.getMine("user-1", "missing-repo")).rejects.toThrow(NotFoundException)

    expect(prisma.skillRepository.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "missing-repo", ownerUserId: "user-1", visibility: "private", status: "active" },
    }))
  })
})

describe("normalizeSkillRepositoryPath", () => {
  it("rejects a trailing-space file segment", () => {
    expect(() => normalizeSkillRepositoryPath("SKILL.md ")).toThrow("文件路径片段不能以点或空格结尾。")
  })
})

type MockFn = ReturnType<typeof vi.fn>
type TransactionInput = (tx: PrismaMock) => unknown

interface PrismaMock {
  $transaction: MockFn
  skillRepository: {
    create: MockFn
    update: MockFn
    findFirst: MockFn
    findMany: MockFn
  }
  skillRepositoryFile: {
    createMany: MockFn
    deleteMany: MockFn
    findMany: MockFn
  }
  skillRepositoryNameRedirect: {
    findUnique: MockFn
  }
}

interface StorageMock {
  putObject: MockFn
  deleteObject: MockFn
}

function createPrismaMock(): PrismaMock {
  return {
    $transaction: vi.fn(),
    skillRepository: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    skillRepositoryFile: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    skillRepositoryNameRedirect: {
      findUnique: vi.fn(),
    },
  }
}

function createStorageMock(): StorageMock {
  return {
    putObject: vi.fn(async () => undefined),
    deleteObject: vi.fn(async () => undefined),
  }
}

function createPrismaKnownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Prisma conflict", {
    code,
    clientVersion: "6.0.0",
  })
}

function ownerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    handle: "alice",
    displayName: "Alice",
    ...overrides,
  }
}

function repositoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-1",
    ownerUserId: "user-1",
    owner: ownerRow(),
    name: "demo-skill",
    title: "Demo Skill",
    description: null,
    visibility: "private",
    status: "active",
    forkedFromRepositoryId: null,
    legacyContentStoreItemId: null,
    legacyInstallCount: 3,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    lastSyncedAt: new Date("2026-06-02T00:00:00.000Z"),
    files: [],
    ...overrides,
  }
}

function repositoryFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-row-1",
    repositoryId: "repo-1",
    path: "SKILL.md",
    pathKey: "skill.md",
    kind: "text",
    mimeType: "text/markdown",
    size: BigInt(8),
    sha256: "sha",
    storageKey: "skill-repositories/repo-1/files/file-1/sha",
    text: "# Demo",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    ...overrides,
  }
}
