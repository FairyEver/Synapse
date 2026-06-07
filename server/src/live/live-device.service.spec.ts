import { NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveDeviceService } from "./live-device.service"

function createPrismaMock() {
  const userDevice = {
    count: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  }
  return {
    userDevice,
    $transaction: vi.fn((operations: readonly Promise<unknown>[]) => Promise.all(operations)),
  }
}

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    userId: "user-1",
    clientInstanceId: "client-a",
    displayName: null,
    deviceName: "MacBook",
    platform: "darwin-arm64",
    appVersion: "0.2.253",
    firstSeenAt: new Date("2026-06-06T09:00:00.000Z"),
    lastSeenAt: new Date("2026-06-06T10:00:00.000Z"),
    createdAt: new Date("2026-06-06T09:00:00.000Z"),
    updatedAt: new Date("2026-06-06T10:00:00.000Z"),
    ...overrides,
  }
}

function registerClient(registry: LiveClientRegistry, overrides: Record<string, unknown> = {}) {
  registry.register({
    userId: "user-1",
    clientInstanceId: "client-a",
    connectionId: "conn-a",
    appVersion: "0.2.254",
    platform: "darwin-arm64",
    deviceName: "MacBook Pro",
    now: new Date("2026-06-06T10:05:00.000Z"),
    ...overrides,
  } as never)
}

function prismaNotFound() {
  return new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "test",
  })
}

describe("LiveDeviceService", () => {
  it("merges a user's persisted devices with current live state", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.findMany.mockResolvedValue([
      device({
        id: "device-b",
        clientInstanceId: "client-b",
        displayName: "Windows 台式机",
        deviceName: "Workstation",
        platform: "win32-x64",
        appVersion: "0.2.250",
        firstSeenAt: new Date("2026-06-06T08:00:00.000Z"),
        lastSeenAt: new Date("2026-06-06T10:03:00.000Z"),
      }),
      device({ displayName: "工作电脑" }),
    ])
    const registry = new LiveClientRegistry()
    registerClient(registry)
    registerClient(registry, {
      userId: "user-2",
      clientInstanceId: "client-other",
      connectionId: "conn-other",
      deviceName: "Other Mac",
    })
    const service = new LiveDeviceService(prisma as unknown as PrismaService, registry)

    const devices = await service.listUserDevices("user-1")

    expect(prisma.userDevice.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { lastSeenAt: "desc" },
    })
    expect(devices).toEqual([
      expect.objectContaining({
        clientInstanceId: "client-a",
        displayName: "工作电脑",
        deviceName: "MacBook Pro",
        status: "online",
        firstSeenAt: "2026-06-06T09:00:00.000Z",
        lastSeenAt: "2026-06-06T10:05:00.000Z",
      }),
      expect.objectContaining({
        clientInstanceId: "client-b",
        displayName: "Windows 台式机",
        deviceName: "Workstation",
        status: "offline",
        connectedAt: null,
        lastSeenAt: "2026-06-06T10:03:00.000Z",
      }),
    ])
    expect(devices[0]).not.toHaveProperty("userId")
  })

  it("upserts hello metadata without overwriting the user display name", async () => {
    const prisma = createPrismaMock()
    const service = new LiveDeviceService(prisma as unknown as PrismaService, new LiveClientRegistry())
    const seenAt = new Date("2026-06-06T10:00:00.000Z")

    await service.upsertFromHello({
      userId: "user-1",
      clientInstanceId: "client-a",
      deviceName: `${"A".repeat(130)}`,
      platform: "darwin-arm64",
      appVersion: "0.2.253",
      seenAt,
    })

    expect(prisma.userDevice.upsert).toHaveBeenCalledWith({
      where: {
        userId_clientInstanceId: {
          userId: "user-1",
          clientInstanceId: "client-a",
        },
      },
      create: {
        userId: "user-1",
        clientInstanceId: "client-a",
        deviceName: "A".repeat(120),
        platform: "darwin-arm64",
        appVersion: "0.2.253",
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      },
      update: {
        deviceName: "A".repeat(120),
        platform: "darwin-arm64",
        appVersion: "0.2.253",
        lastSeenAt: seenAt,
      },
    })
  })

  it("renames only the current user's device", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.update.mockResolvedValue(device({ displayName: "Studio Mac" }))
    const service = new LiveDeviceService(prisma as unknown as PrismaService, new LiveClientRegistry())

    const renamed = await service.renameUserDevice("user-1", "client-a", " Studio Mac ")

    expect(prisma.userDevice.update).toHaveBeenCalledWith({
      where: {
        userId_clientInstanceId: {
          userId: "user-1",
          clientInstanceId: "client-a",
        },
      },
      data: { displayName: "Studio Mac" },
    })
    expect(renamed).toMatchObject({
      clientInstanceId: "client-a",
      displayName: "Studio Mac",
      status: "offline",
    })
  })

  it("throws not found when renaming a missing user device", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.update.mockRejectedValue(prismaNotFound())
    const service = new LiveDeviceService(prisma as unknown as PrismaService, new LiveClientRegistry())

    await expect(service.renameUserDevice("user-1", "client-a", "Studio Mac"))
      .rejects
      .toBeInstanceOf(NotFoundException)
  })

  it("lists admin devices with user identity and pagination", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.findMany.mockResolvedValue([
      device({
        user: {
          id: "user-1",
          email: "user@example.com",
          displayName: "Li Yang",
        },
      }),
    ])
    prisma.userDevice.count.mockResolvedValue(1)
    const registry = new LiveClientRegistry()
    registerClient(registry)
    const service = new LiveDeviceService(prisma as unknown as PrismaService, registry)

    const result = await service.listAdminDevices({
      page: 1,
      pageSize: 20,
      sortBy: "lastSeenAt",
      sortOrder: "desc",
    })

    expect(prisma.userDevice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 0,
      take: 20,
      orderBy: { lastSeenAt: "desc" },
      include: {
        user: {
          select: { id: true, email: true, displayName: true },
        },
      },
    }))
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          userId: "user-1",
          userEmail: "user@example.com",
          userDisplayName: "Li Yang",
          clientInstanceId: "client-a",
          status: "online",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  })
})
