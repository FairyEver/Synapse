import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { Readable } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { SkillRepositoryService } from "./skill-repository.service"
import { normalizeSkillRepositoryPath } from "./skill-repository-file-rules"
import type { SkillRepositoryStoragePort } from "./skill-repository-storage"

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
    service = new SkillRepositoryService(prisma as unknown as PrismaService, storage as unknown as SkillRepositoryStoragePort)
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
            sha256: "03828777bb523525406c9d69f5dfa8a79b7691f6d2dc4bdfbf6d0d45b741255e",
            size: BigInt(Buffer.byteLength(readmeText)),
          }),
          repositoryFileRow({
            id: "file-row-2",
            path: "SKILL.md",
            pathKey: "skill.md",
            storageKey: "skill-repositories/repo-1/files/file-1/87baa74680c93d2d14f37cbfda03dd3a06fc30cb3e999a867196fb0392ef122a",
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
      where: { id: "repo-1", ownerUserId: "user-1", status: "active" },
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
    expect(prisma.skillRepositoryObjectCleanupTask.createMany).toHaveBeenCalledWith({
      data: [{
        repositoryId: "repo-1",
        storageKey: "skill-repositories/repo-1/files/old-file/oldsha",
        reason: "skill-file-replaced",
      }],
      skipDuplicates: true,
    })
    expect(storage.deleteObject).toHaveBeenCalledWith("skill-repositories/repo-1/files/old-file/oldsha")
    expect(prisma.skillRepositoryObjectCleanupTask.deleteMany).toHaveBeenCalledWith({
      where: { storageKey: "skill-repositories/repo-1/files/old-file/oldsha" },
    })
  })

  it("keeps a cleanup task when stale object deletion fails", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      ownerUserId: "user-1",
    }))
    prisma.skillRepositoryFile.findMany.mockResolvedValueOnce([
      { storageKey: "skill-repositories/repo-1/files/old-file/oldsha" },
    ])
    prisma.skillRepository.update.mockResolvedValue(repositoryRow({ id: "repo-1" }))
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      files: [repositoryFileRow({
        sha256: "22e127a7f2d892b375cc37ca455ab6a6f0c0da9ac42e58d1b4c5cc45d11d7902",
        size: BigInt(Buffer.byteLength("# Updated")),
      })],
    }))
    storage.deleteObject.mockRejectedValueOnce(new Error("temporary storage failure"))

    await expect(service.importRepository("user-1", {
      repositoryId: "repo-1",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Updated").toString("base64") }],
    })).resolves.toMatchObject({ id: "repo-1" })

    expect(prisma.skillRepositoryObjectCleanupTask.createMany).toHaveBeenCalledWith({
      data: [{
        repositoryId: "repo-1",
        storageKey: "skill-repositories/repo-1/files/old-file/oldsha",
        reason: "skill-file-replaced",
      }],
      skipDuplicates: true,
    })
    expect(prisma.skillRepositoryObjectCleanupTask.updateMany).toHaveBeenCalledWith({
      where: { storageKey: "skill-repositories/repo-1/files/old-file/oldsha" },
      data: {
        attempts: { increment: 1 },
        lastError: "temporary storage failure",
      },
    })
    expect(prisma.skillRepositoryObjectCleanupTask.deleteMany).not.toHaveBeenCalledWith({
      where: { storageKey: "skill-repositories/repo-1/files/old-file/oldsha" },
    })
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
      where: { id: "foreign-repo", ownerUserId: "user-1", status: "active" },
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
      where: { ownerUserId: "user-1", status: "active" },
      orderBy: { updatedAt: "desc" },
    }))
    expect(result.map((repo) => repo.id)).toEqual(["repo-new", "repo-old"])
    expect(result[0]).toMatchObject({
      owner: { id: "user-1", handle: "alice", displayName: "Alice" },
    })
  })

  it("getMine throws NotFoundException for missing or foreign repos", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(null)

    await expect(service.getMine("user-1", "missing-repo")).rejects.toThrow(NotFoundException)

    expect(prisma.skillRepository.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "missing-repo", ownerUserId: "user-1", status: "active" },
    }))
  })

  it("reads text file content without adding text to repository detail files", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      path: "SKILL.md",
      pathKey: "skill.md",
      kind: "text",
      storageKey: "skill-repositories/repo-1/files/file-1/sha",
    }))
    storage.getObjectStream.mockResolvedValue({ stream: bufferStream("# Demo Skill\n") })

    const result = await service.getFileContent("user-1", "repo-1", "SKILL.md")

    expect(result).toMatchObject({
      file: { path: "SKILL.md", kind: "text" },
      text: "# Demo Skill\n",
      downloadUrl: null,
      truncated: false,
    })
    expect("text" in result.file).toBe(false)
    expect(storage.getObjectStream).toHaveBeenCalledWith({ key: "skill-repositories/repo-1/files/file-1/sha" })
  })

  it("returns null text for binary file content", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      path: "assets/logo.png",
      pathKey: "assets/logo.png",
      kind: "binary",
      mimeType: "image/png",
      storageKey: "skill-repositories/repo-1/files/file-2/sha",
    }))

    const result = await service.getFileContent("user-1", "repo-1", "assets/logo.png")

    expect(result).toMatchObject({
      file: { path: "assets/logo.png", kind: "binary" },
      text: null,
      downloadUrl: null,
      truncated: false,
    })
    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("opens a private repository file download for the owner", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1", ownerUserId: "user-1", visibility: "private" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      path: "assets/logo.png",
      pathKey: "assets/logo.png",
      kind: "binary",
      mimeType: "image/png",
      size: BigInt(4),
      storageKey: "skill-repositories/repo-1/files/file-2/logo-sha",
    }))
    storage.getObjectStream.mockResolvedValue({ stream: bufferStream(Buffer.from("logo")) })

    const result = await service.openFileDownload("user-1", "repo-1", "assets/logo.png")

    expect(result).toMatchObject({
      contentType: "image/png",
      size: 4,
      filename: "logo.png",
    })
    expect(storage.getObjectStream).toHaveBeenCalledWith({ key: "skill-repositories/repo-1/files/file-2/logo-sha" })
  })

  it("opens a public repository file download for a non-owner", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1", ownerUserId: "user-1", visibility: "public" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      path: "README.md",
      pathKey: "readme.md",
      kind: "text",
      mimeType: "text/markdown",
      storageKey: "skill-repositories/repo-1/files/file-3/readme-sha",
    }))
    storage.getObjectStream.mockResolvedValue({ stream: bufferStream("# Readme") })

    const result = await service.openFileDownload("user-2", "repo-1", "README.md")

    expect(result).toMatchObject({
      contentType: "text/markdown",
      filename: "README.md",
    })
    expect(storage.getObjectStream).toHaveBeenCalledWith({ key: "skill-repositories/repo-1/files/file-3/readme-sha" })
  })

  it("rejects private repository file downloads for non-owners", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(null)

    await expect(service.openFileDownload("user-2", "repo-1", "README.md")).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.skillRepositoryFile.findFirst).not.toHaveBeenCalled()
    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("rejects missing repository file downloads", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(null)

    await expect(service.openFileDownload("user-1", "repo-1", "missing.txt")).rejects.toBeInstanceOf(NotFoundException)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("saves a text file when expected sha matches", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      id: "file-row-1",
      path: "SKILL.md",
      pathKey: "skill.md",
      sha256: "oldsha",
      storageKey: "skill-repositories/repo-1/files/old/oldsha",
    }))
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      files: [repositoryFileRow({
        sha256: "22e127a7f2d892b375cc37ca455ab6a6f0c0da9ac42e58d1b4c5cc45d11d7902",
        size: BigInt(Buffer.byteLength("# Updated")),
      })],
    }))

    const result = await service.saveTextFile("user-1", "repo-1", {
      path: "SKILL.md",
      text: "# Updated",
      expectedSha256: "oldsha",
    })

    expect(result.files[0]).toMatchObject({ path: "SKILL.md" })
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^skill-repositories\/repo-1\/files\/file-\d+\/11c312/u),
      body: Buffer.from("# Updated"),
    }))
    expect(prisma.skillRepositoryFile.deleteMany).toHaveBeenCalledWith({
      where: { repositoryId: "repo-1", pathKey: "skill.md" },
    })
    expect(storage.deleteObject).toHaveBeenCalledWith("skill-repositories/repo-1/files/old/oldsha")
  })

  it("rejects stale text saves with a conflict", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      sha256: "newsha",
      storageKey: "skill-repositories/repo-1/files/file-1/newsha",
    }))

    await expect(service.saveTextFile("user-1", "repo-1", {
      path: "SKILL.md",
      text: "# Stale",
      expectedSha256: "oldsha",
    })).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: "SKILL_REPOSITORY_FILE_CONFLICT" },
    })

    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("renames non-root files and protects SKILL.md from rename or delete", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      id: "file-row-2",
      path: "README.md",
      pathKey: "readme.md",
      sha256: "readme-sha",
    }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(null)
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      files: [
        repositoryFileRow(),
        repositoryFileRow({ path: "docs/README.md", pathKey: "docs/readme.md" }),
      ],
    }))

    await service.renameFile("user-1", "repo-1", { fromPath: "README.md", toPath: "docs/README.md" })

    expect(prisma.skillRepositoryFile.update).toHaveBeenCalledWith({
      where: { id: "file-row-2" },
      data: { path: "docs/README.md", pathKey: "docs/readme.md" },
    })

    await expect(service.renameFile("user-1", "repo-1", { fromPath: "SKILL.md", toPath: "README.md" })).rejects.toMatchObject({
      response: { code: "SKILL_REPOSITORY_PROTECTED_ROOT_FILE" },
    })
    await expect(service.deleteFile("user-1", "repo-1", { path: "SKILL.md" })).rejects.toMatchObject({
      response: { code: "SKILL_REPOSITORY_PROTECTED_ROOT_FILE" },
    })
  })

  it("uploads, replaces, deletes non-root files, and records stale object cleanup", async () => {
    prisma.skillRepository.findFirst.mockResolvedValue(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(null)
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({
      id: "repo-1",
      files: [repositoryFileRow(), repositoryFileRow({ path: "README.md", pathKey: "readme.md" })],
    }))

    await service.uploadFile("user-1", "repo-1", {
      path: "README.md",
      contentBase64: Buffer.from("Read me").toString("base64"),
      mimeType: "text/markdown",
    })

    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^skill-repositories\/repo-1\/files\/file-\d+\/[a-f0-9]{64}$/u),
    }))

    prisma.skillRepositoryFile.findFirst.mockResolvedValueOnce(repositoryFileRow({
      path: "README.md",
      pathKey: "readme.md",
      sha256: "readme-sha",
      storageKey: "skill-repositories/repo-1/files/file-2/readme-sha",
    }))
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1", files: [repositoryFileRow()] }))

    await service.deleteFile("user-1", "repo-1", { path: "README.md", expectedSha256: "readme-sha" })

    expect(prisma.skillRepositoryObjectCleanupTask.createMany).toHaveBeenCalledWith({
      data: [{
        repositoryId: "repo-1",
        storageKey: "skill-repositories/repo-1/files/file-2/readme-sha",
        reason: "skill-file-deleted",
      }],
      skipDuplicates: true,
    })
    expect(storage.deleteObject).toHaveBeenCalledWith("skill-repositories/repo-1/files/file-2/readme-sha")
  })

  it("updates repository metadata, records name redirects, and soft deletes repositories", async () => {
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1", name: "old-name" }))
    prisma.skillRepository.findFirst.mockResolvedValueOnce(null)
    prisma.skillRepositoryNameRedirect.findUnique.mockResolvedValueOnce(null)
    prisma.skillRepository.update.mockResolvedValueOnce(repositoryRow({ id: "repo-1", name: "new-name", title: "New Title" }))
    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1", name: "new-name", title: "New Title" }))

    await service.updateMine("user-1", "repo-1", { name: "new-name", title: "New Title" })

    expect(prisma.skillRepositoryNameRedirect.create).toHaveBeenCalledWith({
      data: { ownerUserId: "user-1", oldName: "old-name", repositoryId: "repo-1" },
    })
    expect(prisma.skillRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "repo-1" },
      data: expect.objectContaining({ name: "new-name", title: "New Title" }),
    }))

    prisma.skillRepository.findFirst.mockResolvedValueOnce(repositoryRow({ id: "repo-1" }))
    prisma.skillRepositoryFile.findMany.mockResolvedValueOnce([
      { storageKey: "skill-repositories/repo-1/files/file-1/sha" },
    ])
    prisma.skillRepository.update.mockResolvedValueOnce(repositoryRow({ id: "repo-1", status: "removed" }))

    const result = await service.deleteMine("user-1", "repo-1")

    expect(result).toEqual({ id: "repo-1", status: "removed" })
    expect(prisma.skillRepositoryObjectCleanupTask.createMany).toHaveBeenCalledWith({
      data: [{
        repositoryId: "repo-1",
        storageKey: "skill-repositories/repo-1/files/file-1/sha",
        reason: "skill-repository-removed",
      }],
      skipDuplicates: true,
    })
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
    update: MockFn
    findFirst: MockFn
    findMany: MockFn
  }
  skillRepositoryNameRedirect: {
    create: MockFn
    findUnique: MockFn
  }
  skillRepositoryObjectCleanupTask: {
    createMany: MockFn
    deleteMany: MockFn
    updateMany: MockFn
  }
}

interface StorageMock {
  putObject: MockFn
  getObjectStream: MockFn
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
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    skillRepositoryNameRedirect: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    skillRepositoryObjectCleanupTask: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  }
}

function createStorageMock(): StorageMock {
  return {
    putObject: vi.fn(async () => undefined),
    getObjectStream: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
  }
}

function bufferStream(value: string | Buffer): Readable {
  return Readable.from([typeof value === "string" ? Buffer.from(value) : value])
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
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    ...overrides,
  }
}
