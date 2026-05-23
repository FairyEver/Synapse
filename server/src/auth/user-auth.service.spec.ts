import { UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "./password"
import { hashToken } from "./token"
import { UserAuthService, type UserMeResponse } from "./user-auth.service"

function createPrismaMock() {
  return {
    $transaction: vi.fn((callback) => callback({
      user: {
        create: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com", status: "active" }),
      },
      userSession: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
      },
    })),
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    userSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  }
}

function createPermissionsMock() {
  return {
    getEffectivePermissions: vi.fn(),
  }
}

describe("UserAuthService", () => {
  it("rejects login for unknown users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
    )

    await expect(service.login({ email: "missing@example.com", password: "x" }))
      .rejects
      .toThrow(UnauthorizedException)
  })

  it("rejects disabled users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      passwordHash: await hashPassword("StrongPassword123!"),
      status: "disabled",
    })
    const auditLog = { record: vi.fn() }
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
      auditLog as never,
    )

    await expect(service.login({ email: "u@example.com", password: "StrongPassword123!" }, "203.0.113.22"))
      .rejects
      .toThrow("账号已停用。")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.login.disabled",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.22",
    })
  })

  it("records login failure audits with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const auditLog = { record: vi.fn() }
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
      auditLog as never,
    )

    await expect(service.login({ email: "missing@example.com", password: "x" }, "203.0.113.23"))
      .rejects
      .toThrow(UnauthorizedException)

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "missing@example.com",
      action: "user.login.failure",
      targetType: "user",
      targetId: "unknown",
      ipAddress: "203.0.113.23",
    })
  })

  it("records login success audits with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      passwordHash: await hashPassword("StrongPassword123!"),
      status: "active",
    })
    const auditLog = { record: vi.fn() }
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
      auditLog as never,
    )

    await service.login({ email: "u@example.com", password: "StrongPassword123!" }, "203.0.113.24")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.login.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.24",
    })
  })

  it("records registration success audits with the request ip", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
      auditLog as never,
    )

    await service.register({
      invitationToken: "invite-token",
      email: "U@example.com",
      password: "StrongPassword123!",
    }, "203.0.113.25")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.register.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.25",
    })
  })

  it("rejects refresh when another request already rotated the session token", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      refreshTokenHash: hashToken("refresh-token"),
      revokedAt: null,
      expiresAt: new Date("2026-05-24T12:00:00.000Z"),
      user: {
        id: "user-1",
        email: "u@example.com",
        status: "active",
      },
    })
    prisma.userSession.updateMany.mockResolvedValue({ count: 0 })
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
    )

    await expect(service.refresh({ refreshToken: "refresh-token" }))
      .rejects
      .toThrow("未登录或登录已过期。")

    expect(prisma.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "session-1",
        refreshTokenHash: hashToken("refresh-token"),
      },
    }))
  })

  it("records disabled user refresh attempts with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      refreshTokenHash: hashToken("refresh-token"),
      revokedAt: null,
      expiresAt: new Date("2026-05-24T12:00:00.000Z"),
      user: {
        id: "user-1",
        email: "u@example.com",
        status: "disabled",
      },
    })
    const auditLog = { record: vi.fn() }
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
      auditLog as never,
    )

    await expect(service.refresh({ refreshToken: "refresh-token" }, "203.0.113.26"))
      .rejects
      .toThrow("账号已停用。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.refresh.disabled",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.26",
    })
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled()
  })

  it("cleans expired and stale revoked sessions", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.deleteMany.mockResolvedValue({ count: 3 })
    const permissions = createPermissionsMock()
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
    )
    const now = new Date("2026-05-23T12:00:00.000Z")

    await expect(service.cleanupExpiredSessions(now)).resolves.toBe(3)

    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: new Date("2026-05-16T12:00:00.000Z") } },
        ],
      },
    })
  })

  it("returns team roles and effective permissions for the current user", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      status: "active",
      memberships: [
        {
          id: "membership-1",
          teamId: "team-1",
          role: "owner",
          accessRoles: [
            { role: { id: "role-1", name: "团队管理员" } },
            { role: { id: "role-2", name: "普通成员" } },
          ],
          team: { id: "team-1", name: "Team One" },
        },
        {
          id: "membership-2",
          teamId: "team-2",
          role: "member",
          accessRoles: [
            { role: { id: "role-3", name: "普通成员" } },
          ],
          team: { id: "team-2", name: "Team Two" },
        },
      ],
    })
    const permissions = createPermissionsMock()
    permissions.getEffectivePermissions.mockImplementation(async (_userId: string, teamId: string) => {
      if (teamId === "team-1") return ["database.use", "team.member.manage"]
      return ["agent.chat.use"]
    })
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      permissions as never,
    )

    const expected: UserMeResponse = {
      user: { id: "user-1", email: "u@example.com", status: "active" },
      teams: [
        {
          id: "team-1",
          name: "Team One",
          membershipId: "membership-1",
          membershipRole: "owner",
          roles: [
            { id: "role-1", name: "团队管理员" },
            { id: "role-2", name: "普通成员" },
          ],
          effectivePermissions: ["database.use", "team.member.manage"],
        },
        {
          id: "team-2",
          name: "Team Two",
          membershipId: "membership-2",
          membershipRole: "member",
          roles: [{ id: "role-3", name: "普通成员" }],
          effectivePermissions: ["agent.chat.use"],
        },
      ],
    }

    await expect(service.getMe("user-1")).resolves.toEqual(expected)

    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        id: true,
        email: true,
        status: true,
        memberships: {
          select: {
            id: true,
            teamId: true,
            role: true,
            accessRoles: {
              select: {
                role: { select: { id: true, name: true } },
              },
              orderBy: { assignedAt: "asc" },
            },
            team: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })
    expect(permissions.getEffectivePermissions).toHaveBeenNthCalledWith(1, "user-1", "team-1")
    expect(permissions.getEffectivePermissions).toHaveBeenNthCalledWith(2, "user-1", "team-2")
  })
})
