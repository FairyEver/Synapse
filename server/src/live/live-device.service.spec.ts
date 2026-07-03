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
    prisma.userDevice.findMany
      .mockResolvedValueOnce([
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
      .mockResolvedValueOnce([
        { userId: "user-1", clientInstanceId: "client-a" },
      ])
    prisma.userDevice.count.mockResolvedValue(2)
    const registry = new LiveClientRegistry()
    registerClient(registry)
    registerClient(registry, {
      userId: "user-2",
      clientInstanceId: "client-other",
      connectionId: "conn-other",
      deviceName: "Other Mac",
    })
    const service = new LiveDeviceService(prisma as unknown as PrismaService, registry)

    const result = await service.listUserDevices("user-1", {
      page: 1,
      pageSize: 20,
      sortBy: "lastSeenAt",
      sortOrder: "desc",
    })

    expect(prisma.userDevice.findMany).toHaveBeenNthCalledWith(1, {
      skip: 0,
      take: 20,
      where: { userId: "user-1" },
      orderBy: { lastSeenAt: "desc" },
    })
    expect(result).toEqual({
      data: [
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
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    })
    expect(result.data[0]).not.toHaveProperty("userId")
  })

  it("keeps user device rows ordered by the requested sort field", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.findMany
      .mockResolvedValueOnce([
        device({
          clientInstanceId: "client-a",
          platform: "darwin-arm64",
          lastSeenAt: new Date("2026-06-06T09:00:00.000Z"),
        }),
        device({
          id: "device-b",
          clientInstanceId: "client-b",
          platform: "win32-x64",
          lastSeenAt: new Date("2026-06-06T10:00:00.000Z"),
        }),
      ])
      .mockResolvedValueOnce([])
    prisma.userDevice.count.mockResolvedValue(2)
    const service = new LiveDeviceService(prisma as unknown as PrismaService, new LiveClientRegistry())

    const result = await service.listUserDevices("user-1", {
      page: 1,
      pageSize: 20,
      sortBy: "platform",
      sortOrder: "asc",
    })

    expect(result.data.map((row) => row.clientInstanceId)).toEqual(["client-a", "client-b"])
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

  it("creates a live-only user device when renaming an online client", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.update.mockRejectedValue(prismaNotFound())
    prisma.userDevice.upsert.mockResolvedValue(device({
      displayName: "Studio Mac",
      deviceName: "MacBook Pro",
      appVersion: "0.2.254",
      lastSeenAt: new Date("2026-06-06T10:05:00.000Z"),
    }))
    const registry = new LiveClientRegistry()
    registerClient(registry)
    const service = new LiveDeviceService(prisma as unknown as PrismaService, registry)

    const renamed = await service.renameUserDevice("user-1", "client-a", " Studio Mac ")

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
        displayName: "Studio Mac",
        deviceName: "MacBook Pro",
        platform: "darwin-arm64",
        appVersion: "0.2.254",
        firstSeenAt: new Date("2026-06-06T10:05:00.000Z"),
        lastSeenAt: new Date("2026-06-06T10:05:00.000Z"),
      },
      update: { displayName: "Studio Mac" },
    })
    expect(renamed).toMatchObject({
      clientInstanceId: "client-a",
      displayName: "Studio Mac",
      deviceName: "MacBook Pro",
      status: "online",
    })
  })

  it("throws not found when renaming a missing user device", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.update.mockRejectedValue(prismaNotFound())
    const service = new LiveDeviceService(prisma as unknown as PrismaService, new LiveClientRegistry())

    await expect(service.renameUserDevice("user-1", "client-a", "Studio Mac"))
      .rejects
      .toBeInstanceOf(NotFoundException)
    expect(prisma.userDevice.upsert).not.toHaveBeenCalled()
  })

  it("lists admin devices with user identity and pagination", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.findMany
      .mockResolvedValueOnce([
        device({
          user: {
            id: "user-1",
            email: "user@example.com",
            handle: "liyang",
          },
        }),
      ])
      .mockResolvedValueOnce([
        device({
          user: {
            id: "user-1",
            email: "user@example.com",
            handle: "liyang",
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

    expect(prisma.userDevice.findMany).toHaveBeenNthCalledWith(1, {
      skip: 0,
      take: 21,
      orderBy: { lastSeenAt: "desc" },
      include: {
        user: {
          select: { id: true, email: true, handle: true },
        },
      },
    })
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          userId: "user-1",
          userEmail: "user@example.com",
          userHandle: "liyang",
          clientInstanceId: "client-a",
          status: "online",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  })

  it("keeps admin device rows ordered by the requested sort field", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.findMany
      .mockResolvedValueOnce([
        device({
          clientInstanceId: "client-a",
          platform: "darwin-arm64",
          lastSeenAt: new Date("2026-06-06T09:00:00.000Z"),
          user: { id: "user-1", email: "user@example.com", handle: "liyang" },
        }),
        device({
          id: "device-b",
          clientInstanceId: "client-b",
          platform: "win32-x64",
          lastSeenAt: new Date("2026-06-06T10:00:00.000Z"),
          user: { id: "user-1", email: "user@example.com", handle: "liyang" },
        }),
      ])
      .mockResolvedValueOnce([])
    prisma.userDevice.count.mockResolvedValue(2)
    const service = new LiveDeviceService(prisma as unknown as PrismaService, new LiveClientRegistry())

    const result = await service.listAdminDevices({
      page: 1,
      pageSize: 20,
      sortBy: "platform",
      sortOrder: "asc",
    })

    expect(result.data.map((row) => row.clientInstanceId)).toEqual(["client-a", "client-b"])
  })

  it("includes live-only clients in the first admin device page", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    prisma.userDevice.count.mockResolvedValue(0)
    const registry = new LiveClientRegistry()
    registerClient(registry, {
      clientInstanceId: "client-live-only",
      connectionId: "conn-live-only",
      deviceName: "Live Mac",
    })
    const service = new LiveDeviceService(prisma as unknown as PrismaService, registry)

    const result = await service.listAdminDevices({
      page: 1,
      pageSize: 20,
      sortBy: "lastSeenAt",
      sortOrder: "desc",
    })

    expect(prisma.userDevice.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        OR: [{
          userId: "user-1",
          clientInstanceId: "client-live-only",
        }],
      },
      include: {
        user: {
          select: { id: true, email: true, handle: true },
        },
      },
    })
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          userId: "user-1",
          clientInstanceId: "client-live-only",
          deviceName: "Live Mac",
          status: "online",
          connectedAt: "2026-06-06T10:05:00.000Z",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  })

  it("paginates admin live-only clients together with persisted device rows", async () => {
    const prisma = createPrismaMock()
    prisma.userDevice.findMany
      .mockResolvedValueOnce([
        device({
          clientInstanceId: "client-a",
          lastSeenAt: new Date("2026-06-06T10:00:00.000Z"),
          user: { id: "user-1", email: "user@example.com", handle: "liyang" },
        }),
        device({
          id: "device-b",
          clientInstanceId: "client-b",
          lastSeenAt: new Date("2026-06-06T09:59:00.000Z"),
          user: { id: "user-1", email: "user@example.com", handle: "liyang" },
        }),
      ])
      .mockResolvedValueOnce([])
    prisma.userDevice.count.mockResolvedValue(2)
    const registry = new LiveClientRegistry()
    registerClient(registry, {
      clientInstanceId: "client-live-only",
      connectionId: "conn-live-only",
      deviceName: "Live Mac",
    })
    const service = new LiveDeviceService(prisma as unknown as PrismaService, registry)

    const result = await service.listAdminDevices({
      page: 1,
      pageSize: 2,
      sortBy: "lastSeenAt",
      sortOrder: "desc",
    })

    expect(prisma.userDevice.findMany).toHaveBeenNthCalledWith(1, {
      skip: 0,
      take: 3,
      orderBy: { lastSeenAt: "desc" },
      include: {
        user: {
          select: { id: true, email: true, handle: true },
        },
      },
    })
    expect(result.total).toBe(3)
    expect(result.data).toHaveLength(2)
    expect(result.data.map((row) => row.clientInstanceId)).toEqual([
      "client-live-only",
      "client-a",
    ])
  })
})
