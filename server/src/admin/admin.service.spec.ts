import { afterEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

type DailyTrendCountMock = {
  readonly users?: number
  readonly auditLogs?: number
}

function createNotFoundError() {
  return new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "6.0.0",
  })
}

function createPrismaMock(counts: {
  readonly auditLogs?: number
  readonly users?: number
  readonly activeUsers?: number
  readonly disabledUsers?: number
  readonly dailyTrendCounts?: DailyTrendCountMock[]
} = {}) {
  const emptyDailyTrendCounts: DailyTrendCountMock[] = Array.from({ length: 7 }, () => ({}))
  const dailyTrendCounts = (counts.dailyTrendCounts ?? emptyDailyTrendCounts)
    .flatMap((item: DailyTrendCountMock) => [
      item.users ?? 0,
      item.auditLogs ?? 0,
    ])
  const prisma = {
    $transaction: vi.fn((input: unknown) => {
      if (typeof input === "function") return input(prisma)
      return Promise.resolve([
        counts.auditLogs ?? 0,
        counts.users ?? 0,
        counts.activeUsers ?? 0,
        counts.disabledUsers ?? 0,
        ...dailyTrendCounts,
      ])
    }),
    auditLog: { count: vi.fn(), findMany: vi.fn() },
    user: {
      count: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ status: "active" }),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    skillRepository: {
      count: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  }
  return prisma
}
function createAdminSkillRepositoryRow(overrides: Partial<{
  readonly id: string
  readonly name: string
  readonly title: string
  readonly visibility: string
  readonly status: string
  readonly owner: { readonly id: string; readonly handle: string }
  readonly updatedAt: Date
}> = {}) {
  return {
    id: overrides.id ?? "repo-1",
    name: overrides.name ?? "demo",
    title: overrides.title ?? "Demo",
    visibility: overrides.visibility ?? "public",
    status: overrides.status ?? "active",
    owner: overrides.owner ?? { id: "user-1", handle: "alice" },
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z"),
  }
}

describe("AdminService", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns retained system overview counts", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-21T12:00:00.000Z"))
    const prisma = createPrismaMock({
      auditLogs: 2,
      users: 3,
      activeUsers: 2,
      disabledUsers: 1,
      dailyTrendCounts: [
        {},
        {},
        {},
        {},
        {},
        {},
        { users: 1, auditLogs: 1 },
      ],
    })
    const service = new AdminService(prisma as unknown as PrismaService)

    const result = await service.getSystemOverview()

    expect(result.counts).toEqual({
      auditLogs: 2,
      users: 3,
    })
    expect(result.userStatus).toEqual({ active: 2, disabled: 1 })
    expect(result.dailyTrend).toHaveLength(7)
    expect(result.dailyTrend.at(-1)).toMatchObject({
      date: "2026-05-21",
      users: 1,
      auditLogs: 1,
    })
    expect(prisma.user.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      select: { createdAt: true },
    }))
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date("2026-05-20T16:00:00.000Z"),
          lt: new Date("2026-05-21T16:00:00.000Z"),
        },
      },
    })
  })

  it("loads users without exposing password hashes", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.listUsers()

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        email: true,
        handle: true,
        adminNote: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.user.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
    expect(prisma.user.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("modulePermissions")
  })

  it("disables a user without returning the password hash", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.updateUserStatus("user-1", { status: "disabled" })

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" },
      data: { status: "disabled" },
      select: expect.objectContaining({
        id: true,
        email: true,
        handle: true,
        adminNote: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.user.update.mock.calls[0]?.[0].select).not.toHaveProperty("passwordHash")
    expect(prisma.user.update.mock.calls[0]?.[0].select).not.toHaveProperty("modulePermissions")
  })

  it("updates admin-only user notes without auditing note content", async () => {
    const prisma = createPrismaMock()
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      handle: "ada",
      adminNote: "important account",
      status: "active",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserAdminNote(
      "user-1",
      { adminNote: "  important account  " },
      "admin@example.com",
      "203.0.113.12",
    )).resolves.toMatchObject({
      id: "user-1",
      adminNote: "important account",
    })

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { adminNote: "important account" },
      select: expect.objectContaining({
        id: true,
        email: true,
        handle: true,
        adminNote: true,
        status: true,
      }),
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.user.admin_note_update",
      targetType: "user",
      targetId: "user-1",
      detail: {
        hasAdminNote: true,
        adminNoteLength: "important account".length,
      },
      ipAddress: "203.0.113.12",
    })
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("important account")
  })

  it("clears admin-only user notes when the value is blank", async () => {
    const prisma = createPrismaMock()
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.updateUserAdminNote("user-1", { adminNote: "   " })

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { adminNote: null },
    }))
  })

  it("reports a missing user when updating an admin note", async () => {
    const prisma = createPrismaMock()
    prisma.user.update.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserAdminNote("missing-user", { adminNote: "note" }))
      .rejects
      .toThrow("用户不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("disconnects active Live sockets after disabling a user", async () => {
    const prisma = createPrismaMock()
    const liveGateway = { disconnectUser: vi.fn() }
    const service = new AdminService(
      prisma as unknown as PrismaService,
      undefined,
      liveGateway as never,
    )

    await service.updateUserStatus("user-1", { status: "disabled" })

    expect(liveGateway.disconnectUser).toHaveBeenCalledWith("user-1")
  })

  it("does not disconnect Live sockets when enabling a user", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({ status: "disabled" })
    const liveGateway = { disconnectUser: vi.fn() }
    const service = new AdminService(
      prisma as unknown as PrismaService,
      undefined,
      liveGateway as never,
    )

    await service.updateUserStatus("user-1", { status: "active" })

    expect(liveGateway.disconnectUser).not.toHaveBeenCalled()
  })

  it("reports a missing user when updating status", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    prisma.user.update.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserStatus("missing-user", { status: "disabled" }))
      .rejects
      .toThrow("用户不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })
  it("lists public active skill repositories for administrators", async () => {
    const prisma = createPrismaMock()
    prisma.$transaction.mockImplementationOnce((input: unknown) => Promise.all(input as Array<Promise<unknown>>))
    prisma.skillRepository.findMany.mockResolvedValue([createAdminSkillRepositoryRow()])
    prisma.skillRepository.count.mockResolvedValue(1)
    const service = new AdminService(prisma as unknown as PrismaService)

    const result = await service.listSkillRepositories({ page: 2, pageSize: 10, sortBy: "updatedAt", sortOrder: "desc" })

    expect(prisma.skillRepository.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        visibility: "public",
        status: "active",
      },
      select: expect.objectContaining({
        id: true,
        name: true,
        title: true,
        visibility: true,
        status: true,
        owner: { select: { id: true, handle: true } },
        updatedAt: true,
      }),
    }))
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 10,
      data: [
        {
          id: "repo-1",
          owner: { handle: "alice" },
        },
      ],
    })
  })

  it("filters admin skill repositories by removed status and query", async () => {
    const prisma = createPrismaMock()
    prisma.$transaction.mockImplementationOnce((input: unknown) => Promise.all(input as Array<Promise<unknown>>))
    prisma.skillRepository.findMany.mockResolvedValue([])
    prisma.skillRepository.count.mockResolvedValue(0)
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.listSkillRepositories(undefined, { status: "removed", query: "  demo  " })

    expect(prisma.skillRepository.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        visibility: "public",
        status: "removed",
        OR: [
          { name: { contains: "demo", mode: "insensitive" } },
          { title: { contains: "demo", mode: "insensitive" } },
          { owner: { handle: { contains: "demo", mode: "insensitive" } } },
        ],
      },
    }))
  })

  it("marks a skill repository removed and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.skillRepository.update.mockResolvedValue(createAdminSkillRepositoryRow({ status: "removed" }))
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.setSkillRepositoryRemoved("repo-1", true, "admin@example.com", "203.0.113.70"))
      .resolves
      .toMatchObject({ id: "repo-1", status: "removed" })

    expect(prisma.skillRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "repo-1" },
      data: { status: "removed" },
    }))
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.skill_repository.remove",
      targetType: "skill_repository",
      targetId: "repo-1",
      detail: { status: "removed" },
      ipAddress: "203.0.113.70",
    })
  })

  it("restores a removed skill repository and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.skillRepository.update.mockResolvedValue(createAdminSkillRepositoryRow({ status: "active" }))
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.setSkillRepositoryRemoved("repo-1", false, "admin@example.com", "203.0.113.71"))
      .resolves
      .toMatchObject({ id: "repo-1", status: "active" })

    expect(prisma.skillRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "repo-1" },
      data: { status: "active" },
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.skill_repository.restore",
      detail: { status: "active" },
    }))
  })

  it("reports missing skill repositories when moderating", async () => {
    const prisma = createPrismaMock()
    prisma.skillRepository.update.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.setSkillRepositoryRemoved("missing-repo", true))
      .rejects
      .toThrow("Skill 仓库不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })
  it("records user status update audit logs with the request IP", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await service.updateUserStatus("user-1", { status: "disabled" }, "admin@example.com", "203.0.113.40")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.user.status_update",
      targetType: "user",
      targetId: "user-1",
      detail: { status: "disabled" },
      ipAddress: "203.0.113.40",
    })
  })

  it("returns the updated user when status update audit writes fail", async () => {
    const prisma = createPrismaMock()
    prisma.user.update.mockResolvedValue({ id: "user-1", status: "disabled" })
    const auditLog = { record: vi.fn().mockRejectedValue(new Error("audit unavailable")) }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserStatus("user-1", { status: "disabled" }, "admin@example.com", "203.0.113.40"))
      .resolves
      .toEqual({ id: "user-1", status: "disabled" })
    expect(prisma.user.update).toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.user.status_update",
      targetType: "user",
      targetId: "user-1",
      detail: { status: "disabled" },
      ipAddress: "203.0.113.40",
    })
  })

})
