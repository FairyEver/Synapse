import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common"
import { Readable } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { contentStoreSkillMaxFileBytes } from "./content-store.constants"
import { ContentStoreService, normalizeContentStoreInstallDeepLinkBase } from "./content-store.service"
import type { ContentStoreStoragePort } from "./content-store-storage"

describe("ContentStoreService", () => {
  let prisma: PrismaMock
  let storage: StorageMock
  let service: ContentStoreService

  beforeEach(() => {
    prisma = createPrismaMock()
    storage = createStorageMock()
    prisma.$transaction.mockImplementation(async (input: TransactionInput) => {
      if (typeof input === "function") return input(prisma)
      return Promise.all(input)
    })
    service = new ContentStoreService(prisma as unknown as PrismaService, storage as unknown as ContentStoreStoragePort)
  })

  it("creates a private skill draft with stored files", async () => {
    prisma.contentStoreItem.create.mockResolvedValue(item({ id: "item-1", type: "skill", title: "My Skill" }))
    prisma.contentStoreDraft.create.mockResolvedValue(draft({ id: "draft-1", itemId: "item-1", title: "My Skill" }))
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 1 })
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draft({
      id: "draft-1",
      itemId: "item-1",
      title: "My Skill",
      files: [file({ storageKey: "content-store/drafts/user-1/draft-1/sha" })],
    }))

    const result = await service.createDraft("user-1", {
      type: "skill",
      title: "My Skill",
      description: null,
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Skill").toString("base64") }],
    })

    expect(result).toMatchObject({ id: "draft-1", itemId: "item-1", title: "My Skill", revision: 1 })
    expect(prisma.contentStoreItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerUserId: "user-1", visibility: "private", moderationStatus: "normal" }),
    }))
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^content-store\/drafts\/user-1\/draft-1\/[a-f0-9]{64}$/u),
    }))
  })

  it("overwrites the existing same-source unpublished skill draft", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({
      id: "item-1",
      type: "skill",
      latestVersionId: null,
      localSourceFingerprint: "local-1",
    }))
    prisma.contentStoreDraft.findFirst
      .mockResolvedValueOnce(draft({ id: "draft-1", itemId: "item-1", revision: 1 }))
      .mockResolvedValueOnce(draft({
        id: "draft-1",
        itemId: "item-1",
        title: "Updated Skill",
        revision: 2,
        files: [file({ storageKey: "content-store/drafts/user-1/draft-1/sha" })],
      }))
    prisma.contentStoreItem.update.mockResolvedValue(item({ id: "item-1", title: "Updated Skill" }))
    prisma.contentStoreDraft.update.mockResolvedValue(draft({ id: "draft-1", itemId: "item-1", revision: 2 }))
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 1 })

    const result = await service.createDraft("user-1", {
      type: "skill",
      title: "Updated Skill",
      localSourceFingerprint: " local-1 ",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Updated").toString("base64") }],
    })

    expect(result).toMatchObject({ id: "draft-1", itemId: "item-1", title: "Updated Skill" })
    expect(prisma.contentStoreItem.create).not.toHaveBeenCalled()
    expect(prisma.contentStoreDraft.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: "item-1" },
      data: expect.objectContaining({ revision: { increment: 1 } }),
    }))
  })

  it("rejects oversized skill file base64 before decoding and writing", async () => {
    const encodedLength = Math.ceil((contentStoreSkillMaxFileBytes + 1) / 3) * 4

    await expect(service.createDraft("user-1", {
      type: "skill",
      title: "Huge Skill",
      files: [{ path: "SKILL.md", contentBase64: "A".repeat(encodedLength) }],
    })).rejects.toThrow("Skill 单文件超过 20MB。")

    expect(prisma.contentStoreItem.create).not.toHaveBeenCalled()
  })

  it("rejects a stale draft save when the revision changed during the write", async () => {
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draft({
      id: "draft-1",
      itemId: "item-1",
      ownerUserId: "user-1",
      revision: 1,
      item: item({ id: "item-1", type: "prompt" }),
      files: [],
    }))
    prisma.contentStoreDraft.updateMany.mockResolvedValue({ count: 0 })

    await expect(service.saveDraft("user-1", "item-1", 1, {
      title: "Next",
      body: "Prompt",
    })).rejects.toThrow(BadRequestException)

    expect(prisma.contentStoreFile.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes unreferenced draft objects after replacing draft files", async () => {
    prisma.contentStoreDraft.findFirst
      .mockResolvedValueOnce(draft({
        id: "draft-1",
        itemId: "item-1",
        ownerUserId: "user-1",
        revision: 1,
        item: item({ id: "item-1", type: "skill" }),
        files: [file({ storageKey: "content-store/drafts/user-1/draft-1/old" })],
      }))
      .mockResolvedValueOnce(draft({
        id: "draft-1",
        itemId: "item-1",
        revision: 2,
        files: [file({ storageKey: "content-store/drafts/user-1/draft-1/new" })],
      }))
    prisma.contentStoreFile.findMany.mockResolvedValueOnce([
      { storageKey: "content-store/drafts/user-1/draft-1/old" },
    ])
    prisma.contentStoreDraft.updateMany.mockResolvedValue({ count: 1 })
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 1 })

    await service.saveDraft("user-1", "item-1", 1, {
      title: "Next",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Next").toString("base64") }],
    })

    expect(storage.deleteObject).toHaveBeenCalledWith("content-store/drafts/user-1/draft-1/old")
  })

  it("creates a current draft from owned content when saving with revision zero", async () => {
    prisma.contentStoreDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(draft({
        id: "draft-2",
        itemId: "item-1",
        revision: 1,
        baseVersionId: "version-1",
        title: "Draft title",
        files: [file({ path: "SKILL.md" })],
      }))
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({
      id: "item-1",
      type: "skill",
      ownerUserId: "user-1",
      latestVersionId: "version-1",
    }))
    prisma.contentStoreDraft.create.mockResolvedValue(draft({ id: "draft-2", itemId: "item-1", revision: 1 }))
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 1 })

    const result = await service.saveDraft("user-1", "item-1", 0, {
      title: "Draft title",
      files: [{ path: "SKILL.md", contentBase64: Buffer.from("# Next").toString("base64") }],
    })

    expect(result).toMatchObject({
      id: "draft-2",
      revision: 1,
      baseVersionId: "version-1",
    })
    expect(prisma.contentStoreDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        itemId: "item-1",
        ownerUserId: "user-1",
        baseVersionId: "version-1",
        revision: 1,
      }),
    }))
  })

  it("reads the current draft for its owner", async () => {
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draft({
      id: "draft-1",
      itemId: "item-1",
      ownerUserId: "user-1",
      revision: 4,
      files: [file({ path: "SKILL.md" })],
    }))

    const result = await service.getDraft("user-1", "item-1")

    expect(result).toMatchObject({
      id: "draft-1",
      itemId: "item-1",
      revision: 4,
      files: [expect.objectContaining({ path: "SKILL.md" })],
    })
    expect(prisma.contentStoreDraft.findFirst).toHaveBeenCalledWith({
      where: { itemId: "item-1", ownerUserId: "user-1" },
      include: { files: { orderBy: { path: "asc" } } },
    })
  })

  it("returns not found when another user reads a draft", async () => {
    prisma.contentStoreDraft.findFirst.mockResolvedValue(null)

    await expect(service.getDraft("user-2", "item-1")).rejects.toThrow(NotFoundException)

    expect(prisma.contentStoreDraft.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: "item-1", ownerUserId: "user-2" },
    }))
  })

  it("rejects public visibility without description", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({ id: "item-1", ownerUserId: "user-1", description: "   " }))

    await expect(service.setVisibility("user-1", "item-1", "public")).rejects.toThrow(BadRequestException)
  })

  it("rejects public visibility before content has a published version", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({
      id: "item-1",
      ownerUserId: "user-1",
      description: "Ready",
      latestVersionId: null,
    }))

    await expect(service.setVisibility("user-1", "item-1", "public")).rejects.toThrow(BadRequestException)

    expect(prisma.contentStoreItem.update).not.toHaveBeenCalled()
  })

  it("publishes skill drafts by creating an immutable package", async () => {
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draft({
      id: "draft-1",
      itemId: "item-1",
      ownerUserId: "user-1",
      revision: 1,
      item: item({ id: "item-1", type: "skill" }),
      files: [file({
        path: "SKILL.md",
        sha256: "5c01bdbb26f358bab27f267924aa2c9a03fcfdb8c2a8eb01ec6a57bf54e0629e",
        text: "# Skill",
        storageKey: "content-store/drafts/user-1/draft-1/5c01",
      })],
    }))
    storage.getObjectStream.mockResolvedValue({ stream: bufferStream("# Skill") })
    prisma.contentStoreVersion.count.mockResolvedValue(0)
    prisma.contentStoreVersion.create.mockResolvedValue(version({ id: "version-1", itemId: "item-1", versionNumber: 1 }))
    prisma.contentStoreVersion.update.mockResolvedValue(version({ id: "version-1", itemId: "item-1", versionNumber: 1 }))
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 1 })
    prisma.contentStoreItem.update.mockResolvedValue(item({ id: "item-1", latestVersionId: "version-1" }))
    prisma.contentStoreDraft.delete.mockResolvedValue(draft({ id: "draft-1", itemId: "item-1" }))

    const result = await service.publishDraft("user-1", "item-1", 1)

    expect(result).toMatchObject({ id: "version-1", itemId: "item-1", versionNumber: 1 })
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({
      key: "content-store/packages/item-1/version-1.zip",
      contentType: "application/zip",
    }))
    expect(prisma.contentStoreItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ latestVersionId: "version-1" }),
    }))
  })

  it("deletes a newly written package when publishing fails before the database commit", async () => {
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draft({
      id: "draft-1",
      itemId: "item-1",
      ownerUserId: "user-1",
      revision: 1,
      item: item({ id: "item-1", type: "skill" }),
      files: [file({
        path: "SKILL.md",
        sha256: "5c01bdbb26f358bab27f267924aa2c9a03fcfdb8c2a8eb01ec6a57bf54e0629e",
        text: "# Skill",
        storageKey: "content-store/drafts/user-1/draft-1/5c01",
      })],
    }))
    storage.getObjectStream.mockResolvedValue({ stream: bufferStream("# Skill") })
    prisma.contentStoreVersion.count.mockResolvedValue(0)
    prisma.contentStoreVersion.create.mockResolvedValue(version({ id: "version-1", itemId: "item-1", versionNumber: 1 }))
    prisma.contentStoreVersion.update.mockResolvedValue(version({ id: "version-1", itemId: "item-1", versionNumber: 1 }))
    prisma.contentStoreFile.createMany.mockRejectedValue(new Error("database failed"))

    await expect(service.publishDraft("user-1", "item-1", 1)).rejects.toThrow("database failed")

    expect(storage.deleteObject).toHaveBeenCalledWith("content-store/packages/item-1/version-1.zip")
  })

  it("deletes a copied package when copying content fails before the database commit", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({
      id: "source-item",
      type: "skill",
      latestVersionId: "source-version",
      visibility: "public",
    }))
    prisma.contentStoreVersion.findFirst.mockResolvedValue(version({
      id: "source-version",
      itemId: "source-item",
      files: [file({
        path: "SKILL.md",
        sha256: "5c01bdbb26f358bab27f267924aa2c9a03fcfdb8c2a8eb01ec6a57bf54e0629e",
        text: "# Skill",
        storageKey: "content-store/drafts/source/draft/5c01",
      })],
    }))
    prisma.contentStoreItem.create.mockResolvedValue(item({ id: "copied-item", ownerUserId: "user-1" }))
    prisma.contentStoreVersion.create.mockResolvedValue(version({ id: "copied-version", itemId: "copied-item", versionNumber: 1 }))
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 1 })
    storage.getObjectStream.mockResolvedValue({ stream: bufferStream("# Skill") })
    prisma.contentStoreVersion.update.mockResolvedValue(version({ id: "copied-version", itemId: "copied-item", versionNumber: 1 }))
    prisma.contentStoreItem.update.mockRejectedValue(new Error("copy failed"))

    await expect(service.copyToMine("user-1", "source-item")).rejects.toThrow("copy failed")

    expect(storage.deleteObject).toHaveBeenCalledWith("content-store/packages/copied-item/copied-version.zip")
  })

  it("publishes prompt drafts without storing a package", async () => {
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draft({
      id: "draft-1",
      itemId: "item-1",
      revision: 1,
      body: "Prompt body",
      item: item({ id: "item-1", type: "prompt" }),
      files: [],
    }))
    prisma.contentStoreVersion.count.mockResolvedValue(0)
    prisma.contentStoreVersion.create.mockResolvedValue(version({
      id: "version-1",
      itemId: "item-1",
      versionNumber: 1,
      body: "Prompt body",
      packageKey: null,
      packageSha256: null,
      packageSize: null,
    }))
    prisma.contentStoreItem.update.mockResolvedValue(item({ id: "item-1", latestVersionId: "version-1" }))
    prisma.contentStoreDraft.delete.mockResolvedValue(draft({ id: "draft-1", itemId: "item-1" }))

    await service.publishDraft("user-1", "item-1", 1)

    expect(storage.putObject).not.toHaveBeenCalled()
    expect(prisma.contentStoreVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ body: "Prompt body", packageKey: null, packageSha256: null, packageSize: null }),
    }))
  })

  it("builds Skill search text from SKILL.md only", async () => {
    prisma.contentStoreDraft.findFirst.mockResolvedValue(draft({
      id: "draft-1",
      itemId: "item-1",
      ownerUserId: "user-1",
      revision: 1,
      item: item({ id: "item-1", type: "skill" }),
      files: [
        file({
          path: "SKILL.md",
          sha256: "5c01bdbb26f358bab27f267924aa2c9a03fcfdb8c2a8eb01ec6a57bf54e0629e",
          text: "Primary searchable text",
          storageKey: "content-store/drafts/user-1/draft-1/5c01",
        }),
        file({
          path: "references/notes.md",
          sha256: "7a38b7ed34aa5a7cd9afd2351353a12990d72581f70169c696000687193b3f28",
          text: "Hidden attachment text",
          storageKey: "content-store/drafts/user-1/draft-1/7a38",
        }),
      ],
    }))
    storage.getObjectStream
      .mockResolvedValueOnce({ stream: bufferStream("Primary searchable text") })
      .mockResolvedValueOnce({ stream: bufferStream("Hidden attachment text") })
    prisma.contentStoreVersion.count.mockResolvedValue(0)
    prisma.contentStoreVersion.create.mockResolvedValue(version({ id: "version-1", itemId: "item-1", versionNumber: 1 }))
    prisma.contentStoreVersion.update.mockResolvedValue(version({ id: "version-1", itemId: "item-1", versionNumber: 1 }))
    prisma.contentStoreFile.createMany.mockResolvedValue({ count: 2 })
    prisma.contentStoreItem.update.mockResolvedValue(item({ id: "item-1", latestVersionId: "version-1" }))
    prisma.contentStoreDraft.delete.mockResolvedValue(draft({ id: "draft-1", itemId: "item-1" }))

    await service.publishDraft("user-1", "item-1", 1)

    expect(prisma.contentStoreVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        searchText: expect.stringContaining("Primary searchable text"),
      }),
    }))
    expect(prisma.contentStoreVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        searchText: expect.not.stringContaining("Hidden attachment text"),
      }),
    }))
  })

  it("searches store items by title, description, author display name and version text", async () => {
    prisma.contentStoreItem.findMany.mockResolvedValue([])
    prisma.contentStoreItem.count.mockResolvedValue(0)

    await service.listStore("user-1", { query: "needle" })

    expect(prisma.contentStoreItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        latestVersionId: { not: null },
        OR: expect.arrayContaining([
          { title: { contains: "needle", mode: "insensitive" } },
          { description: { contains: "needle", mode: "insensitive" } },
          { owner: { displayName: { contains: "needle", mode: "insensitive" } } },
          { versions: { some: expect.objectContaining({ searchText: { contains: "needle", mode: "insensitive" } }) } },
        ]),
      }),
    }))
  })

  it("requires a published version for public detail access", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(null)

    await expect(service.getDetail("user-2", "item-1")).rejects.toThrow(NotFoundException)

    expect(prisma.contentStoreItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { visibility: "public", moderationStatus: "normal", latestVersionId: { not: null } },
        ]),
      }),
    }))
  })

  it("does not expose package storage keys in public detail responses", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({
      id: "item-1",
      visibility: "public",
      latestVersionId: "version-1",
    }))
    prisma.contentStoreInstallEvent.count.mockResolvedValue(3)
    prisma.contentStoreVersion.findFirst
      .mockResolvedValueOnce(version({
        id: "version-1",
        itemId: "item-1",
        packageKey: "content-store/packages/item-1/version-1.zip",
        packageSha256: "a".repeat(64),
        packageSize: 128n,
      }))
      .mockResolvedValueOnce({ versionNumber: 1 })

    const result = await service.getDetail("user-2", "item-1")

    expect(result.latestVersion).toEqual({
      id: "version-1",
      itemId: "item-1",
      versionNumber: 1,
      packageSha256: "a".repeat(64),
      packageSize: "128",
      createdAt: "2026-06-09T00:00:00.000Z",
    })
    expect(JSON.stringify(result)).not.toContain("packageKey")
    expect(JSON.stringify(result)).not.toContain("content-store/packages/item-1/version-1.zip")
  })

  it("sorts list results by install count", async () => {
    prisma.contentStoreItem.count.mockResolvedValue(2)
    prisma.contentStoreItem.findMany.mockResolvedValue([
      item({ id: "item-high", title: "High", updatedAt: new Date("2026-06-09T00:00:00.000Z"), _count: { installEvents: 3 } }),
      item({ id: "item-low", title: "Low", updatedAt: new Date("2026-06-08T00:00:00.000Z"), _count: { installEvents: 1 } }),
    ])

    const result = await service.listStore("user-1", { sortBy: "installCount" })

    expect(prisma.contentStoreItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 0,
      take: 20,
      include: expect.objectContaining({
        _count: { select: { installEvents: true } },
      }),
      orderBy: [
        { featured: "desc" },
        { installEvents: { _count: "desc" } },
        { updatedAt: "desc" },
      ],
    }))
    expect(prisma.contentStoreInstallEvent.count).not.toHaveBeenCalled()
    expect(result.data.map((row) => row.id)).toEqual(["item-high", "item-low"])
    expect(result.data.map((row) => row.installCount)).toEqual([3, 1])
  })

  it("normalizes only supported content install deep links", () => {
    expect(normalizeContentStoreInstallDeepLinkBase("synapse://content-install")).toBe("synapse://content-install")
    expect(normalizeContentStoreInstallDeepLinkBase(" synapse://content-install/ ")).toBe("synapse://content-install")
    expect(normalizeContentStoreInstallDeepLinkBase("https://evil.example/install")).toBeNull()
    expect(normalizeContentStoreInstallDeepLinkBase("javascript:alert(1)")).toBeNull()
    expect(normalizeContentStoreInstallDeepLinkBase("data:text/html,install")).toBeNull()
    expect(normalizeContentStoreInstallDeepLinkBase("synapse://custom-install")).toBeNull()
    expect(normalizeContentStoreInstallDeepLinkBase("synapse://content-install?next=https://evil.example")).toBeNull()
  })

  it("creates install sessions with a fixed Synapse install deep link", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({
      id: "item-1",
      type: "skill",
      visibility: "public",
      latestVersionId: "version-1",
    }))
    prisma.contentStoreVersion.findFirst.mockResolvedValue(version({
      id: "version-1",
      itemId: "item-1",
      packageKey: "content-store/packages/item-1/version-1.zip",
      packageSha256: "a".repeat(64),
      packageSize: 128n,
    }))
    prisma.contentStoreInstallSession.create.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date("2026-06-09T00:00:00.000Z"),
    })

    const result = await service.createInstallSession("user-1", "item-1", "synapse://content-install/")

    expect(result.deepLinkUrl).toBe("synapse://content-install?session=session-1")
  })

  it("rejects unsafe install deep links before creating sessions", async () => {
    await expect(service.createInstallSession("user-1", "item-1", "https://evil.example/install"))
      .rejects
      .toThrow(BadRequestException)

    expect(prisma.contentStoreItem.findFirst).not.toHaveBeenCalled()
    expect(prisma.contentStoreInstallSession.create).not.toHaveBeenCalled()
  })

  it("rejects install sessions for prompt content", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({
      id: "item-1",
      type: "prompt",
      visibility: "public",
      latestVersionId: "version-1",
      latestVersion: version({ id: "version-1", itemId: "item-1" }),
    }))

    await expect(service.createInstallSession("user-1", "item-1", "synapse://content-install")).rejects.toThrow(BadRequestException)
  })

  it("requires the install session user to match", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      itemId: "item-1",
      versionId: "version-1",
      type: "skill",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
      item: item({ id: "item-1", type: "skill" }),
      version: version({
        id: "version-1",
        itemId: "item-1",
        packageKey: "content-store/packages/item-1/version-1.zip",
        packageSha256: "a".repeat(64),
      }),
    })

    await expect(service.resolveInstallSession("user-2", "session-1")).rejects.toThrow(ForbiddenException)
  })

  it("resolves install sessions without exposing the package storage key", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession())

    await expect(service.resolveInstallSession("user-1", "session-1")).resolves.toEqual({
      id: "session-1",
      contentId: "item-1",
      versionId: "version-1",
      type: "skill",
      title: "Title",
      packageSha256: "a".repeat(64),
      packageSize: "100",
      expiresAt: expect.any(String),
    })
  })

  it("opens an install package stream for the session owner", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession())
    const stream = bufferStream("package")
    storage.getObjectStream.mockResolvedValue({
      stream,
      size: 7n,
      contentType: "application/zip",
    })

    await expect(service.openInstallPackage("user-1", "session-1")).resolves.toEqual({
      stream,
      size: 7n,
      contentType: "application/zip",
      packageSha256: "a".repeat(64),
      type: "skill",
      title: "Title",
    })
    expect(storage.getObjectStream).toHaveBeenCalledWith({
      key: "content-store/packages/item-1/version-1.zip",
    })
  })

  it("uses application/zip when storage reports another content type", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession())
    storage.getObjectStream.mockResolvedValue({
      stream: bufferStream("package"),
      contentType: "text/plain",
    })

    await expect(service.openInstallPackage("user-1", "session-1")).resolves.toMatchObject({
      contentType: "application/zip",
    })
  })

  it("rejects another user opening an install package", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession())

    await expect(service.openInstallPackage("user-2", "session-1")).rejects.toThrow(ForbiddenException)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("rejects non-owner install sessions after content becomes private", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession({
      userId: "user-2",
      item: item({ id: "item-1", ownerUserId: "user-1", visibility: "private", moderationStatus: "normal" }),
    }))

    await expect(service.openInstallPackage("user-2", "session-1")).rejects.toThrow(NotFoundException)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("rejects install sessions after content is removed", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession({
      item: item({ id: "item-1", ownerUserId: "user-1", visibility: "public", moderationStatus: "removed" }),
    }))

    await expect(service.openInstallPackage("user-1", "session-1")).rejects.toThrow(NotFoundException)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("rejects expired sessions when opening an install package", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession({
      expiresAt: new Date(Date.now() - 1),
    }))
    prisma.contentStoreInstallSession.update.mockResolvedValue({ id: "session-1", status: "expired" })

    await expect(service.openInstallPackage("user-1", "session-1")).rejects.toThrow(BadRequestException)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("marks expired pending install sessions during cleanup", async () => {
    const now = new Date("2026-06-09T01:00:00.000Z")
    prisma.contentStoreInstallSession.updateMany.mockResolvedValue({ count: 2 })

    await expect(service.cleanupExpiredInstallSessions(now)).resolves.toBe(2)

    expect(prisma.contentStoreInstallSession.updateMany).toHaveBeenCalledWith({
      where: {
        status: "pending",
        expiresAt: { lte: now },
      },
      data: { status: "expired" },
    })
  })

  it("rejects prompt sessions when opening an install package", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession({ type: "prompt" }))

    await expect(service.openInstallPackage("user-1", "session-1")).rejects.toThrow(BadRequestException)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
  })

  it("returns a controlled error when the install package object is missing", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue(installSession())
    storage.getObjectStream.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }))

    await expect(service.openInstallPackage("user-1", "session-1")).rejects.toThrow(NotFoundException)
  })

  it("rejects deleting public items", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({ id: "item-1", visibility: "public" }))

    await expect(service.deletePrivateItem("user-1", "item-1")).rejects.toThrow(BadRequestException)
  })

  it("deletes private item package and file objects after database deletion", async () => {
    prisma.contentStoreItem.findFirst.mockResolvedValue(item({ id: "item-1", visibility: "private" }))
    prisma.contentStoreVersion.findMany.mockResolvedValue([
      { packageKey: "content-store/packages/item-1/version-1.zip" },
    ])
    prisma.contentStoreFile.findMany.mockResolvedValue([
      { storageKey: "content-store/drafts/user-1/draft-1/old" },
      { storageKey: "content-store/drafts/user-1/draft-1/current" },
    ])
    prisma.contentStoreItem.delete.mockResolvedValue(item({ id: "item-1", visibility: "private" }))

    await expect(service.deletePrivateItem("user-1", "item-1")).resolves.toEqual({ ok: true })

    expect(storage.deleteObject).toHaveBeenCalledWith("content-store/packages/item-1/version-1.zip")
    expect(storage.deleteObject).toHaveBeenCalledWith("content-store/drafts/user-1/draft-1/old")
    expect(storage.deleteObject).toHaveBeenCalledWith("content-store/drafts/user-1/draft-1/current")
  })

  it("records installs with an install event upsert", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      itemId: "item-1",
      versionId: "version-1",
      type: "skill",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
      item: item({ id: "item-1", type: "skill" }),
      version: version({
        id: "version-1",
        itemId: "item-1",
        packageKey: "content-store/packages/item-1/version-1.zip",
        packageSha256: "a".repeat(64),
      }),
    })
    prisma.contentStoreInstallEvent.upsert.mockResolvedValue({ id: "event-1" })
    prisma.contentStoreInstallSession.updateMany.mockResolvedValue({ count: 1 })

    await expect(service.recordInstall("user-1", "session-1", "client-1")).resolves.toEqual({ ok: true })
    expect(prisma.contentStoreInstallSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        userId: "user-1",
        status: "pending",
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        status: "consumed",
        consumedAt: expect.any(Date),
      },
    })
    expect(prisma.contentStoreInstallEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_itemId_versionId_clientInstanceId: {
          userId: "user-1",
          itemId: "item-1",
          versionId: "version-1",
          clientInstanceId: "client-1",
        },
      },
    }))
  })

  it("does not count installs when session consumption loses the pending race", async () => {
    prisma.contentStoreInstallSession.findFirst.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      itemId: "item-1",
      versionId: "version-1",
      type: "skill",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
      item: item({ id: "item-1", type: "skill" }),
      version: version({
        id: "version-1",
        itemId: "item-1",
        packageKey: "content-store/packages/item-1/version-1.zip",
        packageSha256: "a".repeat(64),
      }),
    })
    prisma.contentStoreInstallSession.updateMany.mockResolvedValue({ count: 0 })

    await expect(service.recordInstall("user-1", "session-1", "client-1")).rejects.toThrow(BadRequestException)
    expect(prisma.contentStoreInstallEvent.upsert).not.toHaveBeenCalled()
  })

  it("writes audit actions when admin featured and removed state changes", async () => {
    prisma.$transaction.mockImplementation(async (callback: TransactionInput) => {
      if (typeof callback !== "function") return Promise.all(callback)
      return callback(prisma)
    })
    prisma.contentStoreItem.update
      .mockResolvedValueOnce(item({ id: "item-1", featured: true }))
      .mockResolvedValueOnce(item({ id: "item-1", moderationStatus: "removed" }))
    prisma.contentStoreInstallEvent.count.mockResolvedValue(0)
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" })

    await service.setFeaturedAsAdmin("admin@example.com", "127.0.0.1", "item-1", true)
    await service.setRemovedAsAdmin("admin@example.com", "127.0.0.1", "item-1", true)

    expect(prisma.auditLog.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ action: "content_store.feature", targetType: "content_store_item", targetId: "item-1" }),
    }))
    expect(prisma.auditLog.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ action: "content_store.remove", targetType: "content_store_item", targetId: "item-1" }),
    }))
  })
})

type TransactionInput = ((tx: PrismaMock) => unknown) | readonly unknown[]

type MockFn = ReturnType<typeof vi.fn>

interface PrismaMock {
  $transaction: MockFn
  contentStoreItem: {
    create: MockFn
    update: MockFn
    delete: MockFn
    findFirst: MockFn
    findMany: MockFn
    count: MockFn
  }
  contentStoreDraft: {
    create: MockFn
    update: MockFn
    updateMany: MockFn
    delete: MockFn
    findFirst: MockFn
    upsert: MockFn
  }
  contentStoreVersion: {
    create: MockFn
    update: MockFn
    findFirst: MockFn
    findMany: MockFn
    count: MockFn
  }
  contentStoreFile: {
    createMany: MockFn
    deleteMany: MockFn
    findMany: MockFn
    count: MockFn
  }
  contentStoreInstallSession: {
    create: MockFn
    findFirst: MockFn
    update: MockFn
    updateMany: MockFn
  }
  contentStoreInstallEvent: {
    upsert: MockFn
    count: MockFn
  }
  auditLog: {
    create: MockFn
  }
}

interface StorageMock {
  putObject: MockFn
  getObjectStream: MockFn
  headObject: MockFn
  deleteObject: MockFn
}

function createPrismaMock(): PrismaMock {
  return {
    $transaction: vi.fn(),
    contentStoreItem: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    contentStoreDraft: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    contentStoreVersion: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    contentStoreFile: { createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    contentStoreInstallSession: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    contentStoreInstallEvent: { upsert: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
  }
}

function createStorageMock(): StorageMock {
  return {
    putObject: vi.fn().mockResolvedValue(undefined),
    getObjectStream: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
  }
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    type: "skill",
    title: "Title",
    description: "Description",
    ownerUserId: "user-1",
    owner: { id: "user-1", displayName: "User" },
    visibility: "private",
    moderationStatus: "normal",
    featured: false,
    copiedFromContentId: null,
    copiedFromVersionId: null,
    localSourceFingerprint: null,
    latestVersionId: null,
    latestVersion: null,
    createdAt: new Date("2026-06-09T00:00:00.000Z"),
    updatedAt: new Date("2026-06-09T00:00:00.000Z"),
    ...overrides,
  }
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    itemId: "item-1",
    ownerUserId: "user-1",
    baseVersionId: null,
    revision: 1,
    title: "Title",
    description: "Description",
    body: null,
    files: [],
    item: item(),
    createdAt: new Date("2026-06-09T00:00:00.000Z"),
    updatedAt: new Date("2026-06-09T00:00:00.000Z"),
    ...overrides,
  }
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    itemId: "item-1",
    versionNumber: 1,
    title: "Title",
    description: "Description",
    body: null,
    packageKey: "content-store/packages/item-1/version-1.zip",
    packageSha256: "b".repeat(64),
    packageSize: 100n,
    searchText: "Title Description",
    files: [],
    createdAt: new Date("2026-06-09T00:00:00.000Z"),
    ...overrides,
  }
}

function installSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    itemId: "item-1",
    versionId: "version-1",
    type: "skill",
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: new Date("2026-06-09T00:00:00.000Z"),
    item: item({ id: "item-1", type: "skill" }),
    version: version({
      id: "version-1",
      itemId: "item-1",
      packageKey: "content-store/packages/item-1/version-1.zip",
      packageSha256: "a".repeat(64),
    }),
    ...overrides,
  }
}

function file(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    draftId: "draft-1",
    versionId: null,
    path: "SKILL.md",
    size: 7n,
    sha256: "5c01bdbb26f358bab27f267924aa2c9a03fcfdb8c2a8eb01ec6a57bf54e0629e",
    kind: "text",
    mimeType: "text/markdown",
    storageKey: "content-store/drafts/user-1/draft-1/sha",
    text: "# Skill",
    createdAt: new Date("2026-06-09T00:00:00.000Z"),
    ...overrides,
  }
}

function bufferStream(input: string): NodeJS.ReadableStream {
  return Readable.from([Buffer.from(input)])
}
