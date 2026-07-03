import { afterEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService, maxBulkInvitationDeleteIds } from "./admin.service"

type DailyTrendCountMock = {
  readonly users?: number
  readonly teams?: number
  readonly invitations?: number
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
  readonly teams?: number
  readonly invitations?: number
  readonly activeUsers?: number
  readonly disabledUsers?: number
  readonly pendingInvitations?: number
  readonly usedInvitations?: number
  readonly expiredInvitations?: number
  readonly dailyTrendCounts?: DailyTrendCountMock[]
} = {}) {
  const emptyDailyTrendCounts: DailyTrendCountMock[] = Array.from({ length: 7 }, () => ({}))
  const dailyTrendCounts = (counts.dailyTrendCounts ?? emptyDailyTrendCounts)
    .flatMap((item: DailyTrendCountMock) => [
      item.users ?? 0,
      item.teams ?? 0,
      item.invitations ?? 0,
      item.auditLogs ?? 0,
    ])
  const prisma = {
    $executeRaw: vi.fn(),
    $transaction: vi.fn((input: unknown) => {
      if (typeof input === "function") return input(prisma)
      return Promise.resolve([
        counts.auditLogs ?? 0,
        counts.users ?? 0,
        counts.teams ?? 0,
        counts.invitations ?? 0,
        counts.activeUsers ?? 0,
        counts.disabledUsers ?? 0,
        counts.pendingInvitations ?? 0,
        counts.usedInvitations ?? 0,
        counts.expiredInvitations ?? 0,
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
    teamMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    team: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ id: "team-1" }),
    },
    invitation: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    skillRepository: {
      count: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  }
  return prisma
}

function createInvitationRow(overrides: {
  readonly id?: string
  readonly expiresAt?: Date
  readonly usedAt?: Date | null
} = {}) {
  return {
    id: overrides.id ?? "invite-1",
    type: "team_join",
    expiresAt: overrides.expiresAt ?? new Date("2026-06-15T12:01:00.000Z"),
    usedAt: overrides.usedAt ?? null,
    acceptedByUser: null,
    createdByAdmin: { email: "admin@example.com" },
    createdByUser: null,
    createdAt: new Date("2026-06-15T10:00:00.000Z"),
    team: { name: "Core Team" },
  }
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
      teams: 1,
      invitations: 4,
      activeUsers: 2,
      disabledUsers: 1,
      pendingInvitations: 1,
      usedInvitations: 2,
      expiredInvitations: 1,
      dailyTrendCounts: [
        {},
        {},
        {},
        {},
        { invitations: 1 },
        { teams: 1 },
        { users: 1, auditLogs: 1 },
      ],
    })
    const service = new AdminService(prisma as unknown as PrismaService)

    const result = await service.getSystemOverview()

    expect(result.counts).toEqual({
      auditLogs: 2,
      users: 3,
      teams: 1,
      invitations: 4,
    })
    expect(result.userStatus).toEqual({ active: 2, disabled: 1 })
    expect(result.invitationStatus).toEqual({ pending: 1, used: 2, expired: 1 })
    expect(result.dailyTrend).toHaveLength(7)
    expect(result.dailyTrend.at(-1)).toMatchObject({
      date: "2026-05-21",
      users: 1,
      auditLogs: 1,
    })
    expect(result.dailyTrend.at(-2)).toMatchObject({
      date: "2026-05-20",
      teams: 1,
    })
    expect(result.dailyTrend.at(-3)).toMatchObject({
      date: "2026-05-19",
      invitations: 1,
    })
    expect(prisma.invitation.count).toHaveBeenCalledWith()
    expect(prisma.user.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      select: { createdAt: true },
    }))
    expect(prisma.team.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      select: { createdAt: true },
    }))
    expect(prisma.invitation.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
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
        memberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            team: { select: { id: true, name: true } },
          },
        },
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
        memberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            team: { select: { id: true, name: true } },
          },
        },
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
      memberships: [],
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

  it("rejects disabling the only active owner of a team", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findMany.mockResolvedValue([{ teamId: "team-1" }])
    prisma.teamMembership.findFirst.mockResolvedValue(null)
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.updateUserStatus("user-1", { status: "disabled" }))
      .rejects
      .toThrow("不能停用团队唯一所有者。")

    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("locks owner teams before disabling a user", async () => {
    const prisma = createPrismaMock()
    prisma.teamMembership.findMany.mockResolvedValue([{ teamId: "team-1" }])
    prisma.teamMembership.findFirst.mockResolvedValue({ id: "membership-2" })
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.updateUserStatus("user-1", { status: "disabled" })

    expect(prisma.teamMembership.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", role: "owner" },
      select: { teamId: true },
      orderBy: { teamId: "asc" },
    })
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.teamMembership.findFirst).toHaveBeenCalledWith({
      where: {
        teamId: "team-1",
        userId: { not: "user-1" },
        role: "owner",
        user: { status: "active" },
      },
      select: { id: true },
    })
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.user.update.mock.invocationCallOrder[0])
  })

  it("loads teams with member counts instead of membership rows", async () => {
    const prisma = createPrismaMock()
    prisma.$transaction.mockImplementationOnce((input: unknown) => Promise.all(input as Array<Promise<unknown>>))
    prisma.team.findMany.mockResolvedValue([{
      id: "team-1",
      name: "研发",
      createdByUser: { email: "admin@example.com" },
      _count: { memberships: 3 },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }])
    prisma.team.count.mockResolvedValue(1)
    const service = new AdminService(prisma as unknown as PrismaService)

    const result = await service.listTeams()

    expect(prisma.team.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        id: true,
        name: true,
        createdByUser: { select: { email: true } },
        _count: { select: { memberships: true } },
        createdAt: true,
        updatedAt: true,
      }),
    }))
    expect(prisma.team.findMany.mock.calls[0]?.[0]).not.toHaveProperty("include")
    expect(prisma.team.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("memberships")
    expect(result.data).toEqual([expect.objectContaining({
      id: "team-1",
      memberCount: 3,
    })])
    expect(JSON.stringify(result.data)).not.toContain("_count")
  })

  it("filters teams by name search when listing teams", async () => {
    const prisma = createPrismaMock()
    prisma.$transaction.mockImplementationOnce((input: unknown) => Promise.all(input as Array<Promise<unknown>>))
    prisma.team.findMany.mockResolvedValue([])
    prisma.team.count.mockResolvedValue(0)
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.listTeams(undefined, { search: "  研发  " })

    expect(prisma.team.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        name: {
          contains: "研发",
          mode: "insensitive",
        },
      },
    }))
    expect(prisma.team.count).toHaveBeenCalledWith({
      where: {
        name: {
          contains: "研发",
          mode: "insensitive",
        },
      },
    })
  })

  it("loads invitations without exposing token hashes or invite URLs", async () => {
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([[], 0]),
      invitation: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    }
    const service = new AdminService(prisma as unknown as PrismaService)

    await service.listInvitations()

    expect(prisma.invitation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        id: true,
        type: true,
        expiresAt: true,
        usedAt: true,
        acceptedByUser: { select: { email: true } },
        createdByAdmin: { select: { email: true } },
        createdByUser: { select: { email: true } },
        createdAt: true,
        team: { select: { name: true } },
      },
    }))
    expect(prisma.invitation.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("tokenHash")
    expect(prisma.invitation.findMany.mock.calls[0]?.[0].select).not.toHaveProperty("inviteUrl")
    expect(prisma.invitation.count).toHaveBeenCalledWith()
  })

  it("returns invitation status using server time", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"))
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([
        [
          createInvitationRow({
            id: "pending",
            expiresAt: new Date("2026-06-15T12:01:00.000Z"),
          }),
          createInvitationRow({
            id: "expired",
            expiresAt: new Date("2026-06-15T11:59:00.000Z"),
          }),
          createInvitationRow({
            id: "used",
            expiresAt: new Date("2026-06-15T11:59:00.000Z"),
            usedAt: new Date("2026-06-15T11:00:00.000Z"),
          }),
        ],
        3,
      ]),
      invitation: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    }
    const service = new AdminService(prisma as unknown as PrismaService)

    const result = await service.listInvitations()

    expect(result.data).toEqual([
      expect.objectContaining({ id: "pending", status: "pending" }),
      expect.objectContaining({ id: "expired", status: "expired" }),
      expect.objectContaining({ id: "used", status: "used" }),
    ])
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

  it("creates admin team invitations and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.create.mockResolvedValue({
      id: "invite-1",
      expiresAt: new Date("2026-06-08T00:00:00.000Z"),
    })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.createInvitation(
      { teamId: "team-1" },
      { id: "admin-1", email: "admin@example.com" },
      "https://app.example.com",
      "203.0.113.44",
    )).resolves.toMatchObject({
      id: "invite-1",
      inviteUrl: expect.stringMatching(/^https:\/\/app\.example\.com\/console\/team-invite\?token=.+/),
    })
    expect(prisma.team.findUnique).toHaveBeenCalledWith({
      where: { id: "team-1" },
      select: { id: true },
    })
    expect(prisma.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "team_join",
        createdByAdminId: "admin-1",
        teamId: "team-1",
      }),
    })
    expect(prisma.invitation.create.mock.calls[0]?.[0].data).not.toHaveProperty("inviteUrl")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.create",
      targetType: "invitation",
      targetId: "invite-1",
      detail: { teamId: "team-1" },
      ipAddress: "203.0.113.44",
    })
  })

  it("deletes an invitation and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.delete.mockResolvedValue({ id: "invite-1" })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await service.deleteInvitation("invite-1", "admin@example.com", "203.0.113.20")

    expect(prisma.invitation.delete).toHaveBeenCalledWith({ where: { id: "invite-1" } })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.delete",
      targetType: "invitation",
      targetId: "invite-1",
      ipAddress: "203.0.113.20",
    })
  })

  it("records missing invitation delete attempts", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.delete.mockRejectedValue(createNotFoundError())
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitation("missing-invite", "admin@example.com", "203.0.113.50"))
      .rejects
      .toThrow("邀请不存在。")
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("deletes invitations in bulk and records an audit log", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.deleteMany.mockResolvedValue({ count: 2 })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitations(["invite-1", "invite-2"], "admin@example.com", "203.0.113.30"))
      .resolves
      .toEqual({ ok: true, count: 2 })

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["invite-1", "invite-2"] } },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.invitation.delete_many",
      targetType: "invitation",
      targetId: "batch:2",
      detail: { ids: ["invite-1", "invite-2"], idsTruncated: false, count: 2 },
      ipAddress: "203.0.113.30",
    })
  })

  it("rejects oversized bulk invitation deletes before touching the database", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitations(
      Array.from({ length: maxBulkInvitationDeleteIds + 1 }, (_, index) => `invite-${index}`),
      "admin@example.com",
      "203.0.113.30",
    ))
      .rejects
      .toThrow(`一次最多删除 ${maxBulkInvitationDeleteIds} 个邀请。`)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.invitation.deleteMany).not.toHaveBeenCalled()
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("truncates bulk invitation ids in audit details", async () => {
    const prisma = createPrismaMock()
    const ids = Array.from({ length: 12 }, (_, index) => `invite-${index + 1}`)
    prisma.invitation.deleteMany.mockResolvedValue({ count: ids.length })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitations(ids, "admin@example.com", "203.0.113.30"))
      .resolves
      .toEqual({ ok: true, count: ids.length })

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      detail: {
        count: ids.length,
        ids: ids.slice(0, 10),
        idsTruncated: true,
      },
    }))
  })

  it("returns successful invitation mutations when service-managed audit writes fail", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.create.mockResolvedValue({
      id: "invite-1",
      expiresAt: new Date("2026-06-08T00:00:00.000Z"),
    })
    prisma.invitation.delete.mockResolvedValue({ id: "invite-1" })
    prisma.invitation.deleteMany.mockResolvedValue({ count: 2 })
    const auditLog = { record: vi.fn().mockRejectedValue(new Error("audit unavailable")) }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.createInvitation(
      { teamId: "team-1" },
      { id: "admin-1", email: "admin@example.com" },
      "https://app.example.com",
      "203.0.113.44",
    )).resolves.toMatchObject({ id: "invite-1" })
    await expect(service.deleteInvitation("invite-1", "admin@example.com", "203.0.113.20"))
      .resolves
      .toEqual({ ok: true })
    await expect(service.deleteInvitations(["invite-1", "invite-2"], "admin@example.com", "203.0.113.30"))
      .resolves
      .toEqual({ ok: true, count: 2 })
    expect(auditLog.record).toHaveBeenCalledTimes(3)
  })

  it("rejects bulk invitation deletes when any id does not exist", async () => {
    const prisma = createPrismaMock()
    prisma.invitation.deleteMany.mockResolvedValue({ count: 1 })
    const auditLog = { record: vi.fn() }
    const service = new AdminService(prisma as unknown as PrismaService, auditLog as never)

    await expect(service.deleteInvitations(["invite-1", "missing-invite"], "admin@example.com", "203.0.113.31"))
      .rejects
      .toThrow("邀请不存在。")

    expect(prisma.invitation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["invite-1", "missing-invite"] } },
    })
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
