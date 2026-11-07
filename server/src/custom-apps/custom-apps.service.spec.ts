import { ConflictException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { CustomAppIconsService } from "./custom-app-icons.service"
import { CustomAppEvents } from "./custom-app-events"
import { CustomAppsService } from "./custom-apps.service"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
const userId = "user-1"

describe("CustomAppsService", () => {
  it("returns only the current user's active apps and normalizes the Dock", async () => {
    const prisma = createPrisma()
    const icons = createIcons()
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      icons as unknown as CustomAppIconsService,
    )
    prisma.userCustomAppSettings.upsert.mockResolvedValue(settingsRow())
    prisma.userCustomApp.findMany.mockResolvedValue([appRow()])

    const snapshot = await service.snapshot(userId)

    expect(prisma.userCustomApp.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId },
    }))
    expect(snapshot).toMatchObject({
      initialized: true,
      revision: 1,
      dockAppIds: ["agent", appId, "launcher"],
      apps: [expect.objectContaining({ id: appId, name: "阅读" })],
    })
  })

  it("does not resurrect a tombstoned app", async () => {
    const prisma = createPrisma()
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      createIcons() as unknown as CustomAppIconsService,
    )
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomAppTombstone.findUnique.mockResolvedValue({
      userId,
      appId,
      deletedAt: new Date("2026-11-07T00:00:00.000Z"),
    })

    await expect(service.create(userId, createInput()))
      .rejects.toBeInstanceOf(ConflictException)
  })

  it("enforces the 100 app account limit", async () => {
    const prisma = createPrisma()
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      createIcons() as unknown as CustomAppIconsService,
    )
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomAppTombstone.findUnique.mockResolvedValue(null)
    prisma.userCustomApp.findUnique.mockResolvedValue(null)
    prisma.userCustomApp.count.mockResolvedValue(100)

    await expect(service.create(userId, createInput())).rejects.toBeInstanceOf(ConflictException)
  })

  it("serializes creates through the account lock before checking the limit", async () => {
    const prisma = createPrisma()
    const icons = createIcons()
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      icons as unknown as CustomAppIconsService,
    )
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomAppTombstone.findUnique.mockResolvedValue(null)
    prisma.userCustomApp.findUnique.mockResolvedValue(null)
    prisma.userCustomApp.count.mockResolvedValue(0)
    prisma.userCustomApp.create.mockResolvedValue(appRow())
    prisma.userCustomAppSettings.upsert.mockResolvedValue(settingsRow({ revision: 0 }))
    prisma.userCustomAppSettings.update.mockResolvedValue(settingsRow({ revision: 1 }))
    prisma.userCustomAppOperation.create.mockResolvedValue({})
    prisma.userCustomApp.findMany.mockResolvedValue([appRow()])

    await service.create(userId, createInput())

    expect(prisma.$queryRaw).toHaveBeenCalled()
    const query = (prisma.$queryRaw.mock.calls[0]?.[0] as readonly string[]).join("?")
    expect(query).toContain("WITH lock AS MATERIALIZED")
    expect(query).toContain("SELECT 1 AS locked")
    expect(prisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.userCustomApp.count.mock.invocationCallOrder[0])
  })

  it("hard-deletes the app and removes its Dock id in one transaction", async () => {
    const prisma = createPrisma()
    const icons = createIcons()
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      icons as unknown as CustomAppIconsService,
    )
    prisma.userCustomAppTombstone.findUnique.mockResolvedValue(null)
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomApp.findFirst.mockResolvedValue(appRow({
      iconId: "icon-1",
    }))
    prisma.userCustomAppSettings.findUnique.mockResolvedValue(settingsRow({
      dockAppIds: ["agent", appId, "launcher"],
    }))
    prisma.userCustomAppSettings.upsert.mockResolvedValue(settingsRow({
      dockAppIds: ["agent", "launcher"],
      revision: 2,
    }))
    prisma.userCustomAppSettings.update.mockResolvedValue(settingsRow({
      dockAppIds: ["agent", "launcher"],
      revision: 2,
    }))
    prisma.userCustomApp.findMany.mockResolvedValue([])
    prisma.userCustomAppOperation.create.mockResolvedValue({
      id: "receipt",
      userId,
      operationId: "delete-1",
      operationHash: "hash",
      resultRevision: 2,
      expiresAt: new Date(),
      createdAt: new Date(),
    })
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma))

    await service.delete(userId, appId, { operationId: "delete-1" })

    expect(prisma.userCustomAppTombstone.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_appId: { userId, appId } },
    }))
    expect(prisma.userCustomApp.deleteMany).toHaveBeenCalledWith({ where: { id: appId, userId } })
    expect(prisma.userCustomAppSettings.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId },
      data: expect.objectContaining({
        dockAppIds: ["agent", "launcher"],
        revision: { increment: 1 },
      }),
    }))
    expect(icons.discard).toHaveBeenCalledWith("icon-1")
  })

  it("returns not found when updating a deleted or foreign app", async () => {
    const prisma = createPrisma()
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      createIcons() as unknown as CustomAppIconsService,
    )
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomApp.findFirst.mockResolvedValue(null)

    await expect(service.update(userId, appId, {
      operationId: "update-1",
      name: "新名称",
    })).rejects.toBeInstanceOf(NotFoundException)
  })

  it("updates only the current user's app inside the account lock", async () => {
    const prisma = createPrisma()
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      createIcons() as unknown as CustomAppIconsService,
    )
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomApp.findFirst.mockResolvedValue(appRow())
    prisma.userCustomApp.updateMany.mockResolvedValue({ count: 1 })
    prisma.userCustomAppSettings.upsert.mockResolvedValue(settingsRow({ revision: 1 }))
    prisma.userCustomAppSettings.update.mockResolvedValue(settingsRow({ revision: 2 }))
    prisma.userCustomAppOperation.create.mockResolvedValue({})
    prisma.userCustomApp.findMany.mockResolvedValue([appRow({ name: "新名称" })])

    await service.update(userId, appId as `cwa_${string}`, {
      operationId: "update-1",
      name: "新名称",
    })

    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(prisma.userCustomApp.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: appId, userId },
    }))
  })

  it("initializes Dock once from the first device", async () => {
    const prisma = createPrisma()
    const events = { publish: vi.fn() }
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      createIcons() as unknown as CustomAppIconsService,
      events as unknown as CustomAppEvents,
    )
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomAppSettings.upsert
      .mockResolvedValueOnce(settingsRow({
        dockAppIds: [],
        dockMigrationIds: [],
        revision: 0,
        initializedAt: null,
      }))
      .mockResolvedValueOnce(settingsRow({
        dockAppIds: ["agent", "database", "launcher"],
        dockMigrationIds: ["dock.mail-apps-introduction.v1"],
        revision: 1,
      }))
    prisma.userCustomApp.findMany.mockResolvedValue([])
    prisma.userCustomAppSettings.update.mockResolvedValue(settingsRow({
      dockAppIds: ["agent", "database", "launcher"],
      dockMigrationIds: ["dock.mail-apps-introduction.v1"],
      revision: 1,
    }))
    prisma.userCustomAppOperation.create.mockResolvedValue({})
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma))

    await expect(service.bootstrap(userId, {
      operationId: "bootstrap-1",
      dockAppIds: ["agent", "database", "launcher"],
      dockMigrationIds: ["dock.mail-apps-introduction.v1"],
    })).resolves.toMatchObject({
      initialized: true,
      dockAppIds: ["agent", "database", "launcher"],
    })
    expect(events.publish).toHaveBeenCalledWith(userId, 1)
  })

  it("applies a Dock operation to the latest layout and publishes its revision", async () => {
    const prisma = createPrisma()
    const events = { publish: vi.fn() }
    const service = new CustomAppsService(
      prisma as unknown as PrismaService,
      createIcons() as unknown as CustomAppIconsService,
      events as unknown as CustomAppEvents,
    )
    prisma.userCustomAppOperation.findUnique.mockResolvedValue(null)
    prisma.userCustomAppSettings.upsert.mockResolvedValue(settingsRow())
    prisma.userCustomApp.findMany.mockResolvedValue([])
    prisma.userCustomAppSettings.update.mockResolvedValue(settingsRow({
      dockAppIds: ["drive", "agent", "launcher"],
      revision: 2,
    }))
    prisma.userCustomAppOperation.create.mockResolvedValue({})
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma))

    await service.applyDockOperation(userId, {
      operationId: "move-1",
      type: "move",
      appId: "drive",
      beforeAppId: "agent",
    })

    expect(events.publish).toHaveBeenCalledWith(userId, 2)
  })
})

function createInput() {
  return {
    operationId: "create-1",
    id: appId as `cwa_${string}`,
    name: "阅读",
    startUrl: "https://example.com/read",
    iconSource: "favicon" as const,
  }
}

function createIcons() {
  return {
    stagePng: vi.fn(),
    activate: vi.fn(),
    discard: vi.fn(),
    resolve: vi.fn(),
    cleanupStale: vi.fn(),
  }
}

function createPrisma() {
  const prisma = {
    userCustomApp: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
    userCustomAppTombstone: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    userCustomAppSettings: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userCustomAppOperation: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
  }
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma))
  return prisma
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    userId,
    dockAppIds: ["agent", appId, "launcher"],
    dockMigrationIds: [],
    dockCatalogVersion: 1,
    revision: 1,
    initializedAt: new Date("2026-11-07T00:00:00.000Z"),
    createdAt: new Date("2026-11-07T00:00:00.000Z"),
    updatedAt: new Date("2026-11-07T00:00:00.000Z"),
    ...overrides,
  }
}

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: appId,
    userId,
    kind: "web",
    name: "阅读",
    startUrl: "https://example.com/read",
    iconId: null,
    iconSource: "favicon",
    version: 1,
    createdAt: new Date("2026-11-07T00:00:00.000Z"),
    updatedAt: new Date("2026-11-07T00:00:00.000Z"),
    icon: null,
    ...overrides,
  }
}
