import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuditLogService } from "../common/audit-log.service"
import type { PrismaService } from "../prisma/prisma.service"
import { TeamService, teamMemberAddLimit } from "./team.service"

function createPrismaKnownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Request failed", {
    code,
    clientVersion: "6.0.0",
  })
}

function createTeamRecord(overrides: Partial<{
  readonly id: string
  readonly name: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly memberCount: number
}> = {}) {
  return {
    id: overrides.id ?? "team-1",
    name: overrides.name ?? "产品组",
    createdAt: overrides.createdAt ?? new Date("2026-09-10T06:22:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-09-10T06:22:00.000Z"),
    _count: { members: overrides.memberCount ?? 0 },
  }
}

function createPrismaMock() {
  const prisma = {
    $transaction: vi.fn((input: unknown) => {
      if (typeof input === "function") return input(prisma)
      return Promise.all(input as Promise<unknown>[])
    }),
    team: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue({ id: "team-1", name: "产品组" }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    teamMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
  return prisma
}

function createService(prisma: ReturnType<typeof createPrismaMock>, record = vi.fn().mockResolvedValue(undefined)) {
  const ServiceCtor = TeamService as new (
    prisma: PrismaService,
    auditLog: AuditLogService,
  ) => TeamService
  const service = new ServiceCtor(
    prisma as unknown as PrismaService,
    { record } as unknown as AuditLogService,
  )
  return { service, record }
}

describe("TeamService", () => {
  let prisma: ReturnType<typeof createPrismaMock>

  beforeEach(() => {
    prisma = createPrismaMock()
  })

  describe("listTeams", () => {
    it("counts members through _count instead of loading them", async () => {
      prisma.team.findMany.mockResolvedValue([createTeamRecord({ memberCount: 3 })])
      prisma.team.count.mockResolvedValue(1)
      const { service } = createService(prisma)

      const result = await service.listTeams({ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" })

      expect(result.data).toEqual([
        {
          id: "team-1",
          name: "产品组",
          createdAt: new Date("2026-09-10T06:22:00.000Z"),
          updatedAt: new Date("2026-09-10T06:22:00.000Z"),
          memberCount: 3,
        },
      ])
      expect(result.total).toBe(1)
      expect(prisma.team.findMany).toHaveBeenCalledWith(expect.objectContaining({
        select: expect.objectContaining({ _count: { select: { members: true } } }),
      }))
    })

    it("sorts by member count through the members relation", async () => {
      const { service } = createService(prisma)

      await service.listTeams({ page: 2, pageSize: 10, sortBy: "memberCount", sortOrder: "asc" })

      expect(prisma.team.findMany).toHaveBeenCalledWith(expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: { members: { _count: "asc" } },
      }))
    })
  })

  describe("getTeam", () => {
    it("returns the team row including the member count", async () => {
      prisma.team.findUnique.mockResolvedValue(createTeamRecord({ memberCount: 2 }))
      const { service } = createService(prisma)

      await expect(service.getTeam("team-1")).resolves.toMatchObject({ id: "team-1", memberCount: 2 })
    })

    it("rejects an unknown team", async () => {
      prisma.team.findUnique.mockResolvedValue(null)
      const { service } = createService(prisma)

      await expect(service.getTeam("team-404")).rejects.toThrow("团队不存在。")
    })
  })

  describe("createTeam", () => {
    it("creates a team and records an audit entry", async () => {
      prisma.team.create.mockResolvedValue(createTeamRecord({ name: "产品组" }))
      const { service, record } = createService(prisma)

      await expect(service.createTeam({ name: "  产品组  " }, "platform_admin:s1", "203.0.113.9"))
        .resolves.toMatchObject({ id: "team-1", name: "产品组", memberCount: 0 })

      expect(prisma.team.create).toHaveBeenCalledWith({
        data: { name: "产品组" },
        select: expect.anything(),
      })
      expect(record).toHaveBeenCalledWith({
        adminEmail: "platform_admin:s1",
        action: "admin.team.create",
        targetType: "team",
        targetId: "team-1",
        detail: { name: "产品组" },
        ipAddress: "203.0.113.9",
      })
    })

    it("rejects a duplicate name through the database unique constraint", async () => {
      prisma.team.create.mockRejectedValue(createPrismaKnownRequestError("P2002"))
      const { service, record } = createService(prisma)

      await expect(service.createTeam({ name: "产品组" })).rejects.toThrow(ConflictException)
      await expect(service.createTeam({ name: "产品组" })).rejects.toThrow("已存在同名团队。")
      // 靠唯一约束抛错，不做先查后写：创建只查了一次（没有额外的 findUnique）。
      expect(prisma.team.findUnique).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it("rejects a blank name without touching the database", async () => {
      const { service } = createService(prisma)

      await expect(service.createTeam({ name: "   " })).rejects.toThrow(BadRequestException)
      expect(prisma.team.create).not.toHaveBeenCalled()
    })

    it("rejects a name longer than 30 characters without touching the database", async () => {
      const { service } = createService(prisma)

      await expect(service.createTeam({ name: "团".repeat(31) })).rejects.toThrow(BadRequestException)
      expect(prisma.team.create).not.toHaveBeenCalled()
    })
  })

  describe("renameTeam", () => {
    it("renames a team and audits the old and new name", async () => {
      prisma.team.findUnique.mockResolvedValue({ name: "产品组" })
      prisma.team.update.mockResolvedValue(createTeamRecord({ name: "研发组" }))
      const { service, record } = createService(prisma)

      await expect(service.renameTeam("team-1", { name: "研发组" }, "platform_admin:s1", "203.0.113.9"))
        .resolves.toMatchObject({ name: "研发组" })

      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        action: "admin.team.rename",
        targetType: "team",
        targetId: "team-1",
        detail: { from: "产品组", to: "研发组" },
      }))
    })

    it("rejects a duplicate name", async () => {
      prisma.team.update.mockRejectedValue(createPrismaKnownRequestError("P2002"))
      const { service } = createService(prisma)

      await expect(service.renameTeam("team-1", { name: "研发组" })).rejects.toThrow("已存在同名团队。")
    })

    it("rejects an unknown team", async () => {
      prisma.team.findUnique.mockResolvedValue(null)
      const { service } = createService(prisma)

      await expect(service.renameTeam("team-404", { name: "研发组" })).rejects.toThrow(NotFoundException)
      expect(prisma.team.update).not.toHaveBeenCalled()
    })
  })

  describe("deleteTeam", () => {
    it("deletes the team with its memberships and audits the member count", async () => {
      prisma.team.findUnique.mockResolvedValue(createTeamRecord({ name: "产品组", memberCount: 3 }))
      prisma.team.delete.mockResolvedValue(createTeamRecord())
      const { service, record } = createService(prisma)

      await expect(service.deleteTeam("team-1", "platform_admin:s1", "203.0.113.9")).resolves.toEqual({ ok: true })

      expect(prisma.team.delete).toHaveBeenCalledWith({ where: { id: "team-1" } })
      // 删除只碰团队表；用户账号与其他团队的成员关系都不在删除范围内。
      expect(prisma.user.count).not.toHaveBeenCalled()
      expect(prisma.user.deleteMany).not.toHaveBeenCalled()
      expect(prisma.user.updateMany).not.toHaveBeenCalled()
      expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled()
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        action: "admin.team.delete",
        targetType: "team",
        targetId: "team-1",
        detail: { name: "产品组", memberCount: 3 },
      }))
    })

    it("rejects an unknown team", async () => {
      prisma.team.findUnique.mockResolvedValue(null)
      const { service } = createService(prisma)

      await expect(service.deleteTeam("team-404")).rejects.toThrow("团队不存在。")
      expect(prisma.team.delete).not.toHaveBeenCalled()
    })
  })

  describe("listMembers", () => {
    it("maps memberships to the member row shape", async () => {
      prisma.teamMembership.findMany.mockResolvedValue([
        {
          userId: "user-1",
          createdAt: new Date("2026-09-11T00:00:00.000Z"),
          user: { email: "liyang@example.com", handle: "liyang", status: "disabled" },
        },
      ])
      prisma.teamMembership.count.mockResolvedValue(1)
      const { service } = createService(prisma)

      const result = await service.listMembers("team-1", { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" })

      expect(result.data).toEqual([
        {
          userId: "user-1",
          email: "liyang@example.com",
          handle: "liyang",
          status: "disabled",
          joinedAt: new Date("2026-09-11T00:00:00.000Z"),
        },
      ])
      expect(result.total).toBe(1)
    })

    it("rejects an unknown team", async () => {
      prisma.team.findUnique.mockResolvedValue(null)
      const { service } = createService(prisma)

      await expect(service.listMembers("team-404")).rejects.toThrow("团队不存在。")
    })
  })

  describe("listMemberCandidates", () => {
    it("excludes users who are already in the team on the server side", async () => {
      const { service } = createService(prisma)

      await service.listMemberCandidates("team-1", { page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" })

      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { teamMemberships: { none: { teamId: "team-1" } } },
      }))
      expect(prisma.user.count).toHaveBeenCalledWith({ where: { teamMemberships: { none: { teamId: "team-1" } } } })
    })

    it("matches the query against email and handle", async () => {
      const { service } = createService(prisma)

      await service.listMemberCandidates(
        "team-1",
        { page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" },
        "  liyang ",
      )

      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          teamMemberships: { none: { teamId: "team-1" } },
          OR: [
            { email: { contains: "liyang", mode: "insensitive" } },
            { handle: { contains: "liyang", mode: "insensitive" } },
          ],
        },
      }))
    })

    it("returns the plain candidate row shape", async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: "user-2", email: "z@example.com", handle: "zhang", status: "active" },
      ])
      prisma.user.count.mockResolvedValue(1)
      const { service } = createService(prisma)

      await expect(service.listMemberCandidates(
        "team-1",
        { page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" },
      )).resolves.toEqual({
        data: [{ id: "user-2", email: "z@example.com", handle: "zhang", status: "active" }],
        total: 1,
        page: 1,
        pageSize: 50,
      })
    })
  })

  describe("addMembers", () => {
    it("adds members and reports how many were actually added", async () => {
      prisma.user.count.mockResolvedValue(2)
      prisma.teamMembership.createMany.mockResolvedValue({ count: 1 })
      const { service, record } = createService(prisma)

      await expect(service.addMembers("team-1", ["user-1", "user-2"], "platform_admin:s1", "203.0.113.9"))
        .resolves.toEqual({ added: 1 })

      expect(prisma.teamMembership.createMany).toHaveBeenCalledWith({
        data: [
          { teamId: "team-1", userId: "user-1" },
          { teamId: "team-1", userId: "user-2" },
        ],
        skipDuplicates: true,
      })
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        action: "admin.team.member_add",
        targetType: "team",
        targetId: "team-1",
        detail: { count: 1 },
      }))
    })

    it("rejects the whole batch when one user does not exist", async () => {
      prisma.user.count.mockResolvedValue(1)
      const { service, record } = createService(prisma)

      await expect(service.addMembers("team-1", ["user-1", "user-404"])).rejects.toThrow("部分用户不存在。")
      expect(prisma.teamMembership.createMany).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it("deduplicates user ids before validating them", async () => {
      prisma.user.count.mockResolvedValue(1)
      prisma.teamMembership.createMany.mockResolvedValue({ count: 1 })
      const { service } = createService(prisma)

      await service.addMembers("team-1", ["user-1", "user-1", " "])

      expect(prisma.user.count).toHaveBeenCalledWith({ where: { id: { in: ["user-1"] } } })
    })

    it("rejects more than the per-request member limit", async () => {
      const { service } = createService(prisma)

      await expect(service.addMembers(
        "team-1",
        Array.from({ length: teamMemberAddLimit + 1 }, (_, index) => `user-${index}`),
      )).rejects.toThrow(`一次最多添加 ${teamMemberAddLimit} 名成员。`)
      expect(prisma.teamMembership.createMany).not.toHaveBeenCalled()
    })

    it("rejects an empty selection", async () => {
      const { service } = createService(prisma)

      await expect(service.addMembers("team-1", [])).rejects.toThrow("请选择要添加的用户。")
    })

    it("rejects an unknown team", async () => {
      prisma.team.findUnique.mockResolvedValue(null)
      const { service } = createService(prisma)

      await expect(service.addMembers("team-404", ["user-1"])).rejects.toThrow("团队不存在。")
      expect(prisma.teamMembership.createMany).not.toHaveBeenCalled()
    })
  })

  describe("removeMember", () => {
    it("removes one membership and audits it", async () => {
      const { service, record } = createService(prisma)

      await expect(service.removeMember("team-1", "user-1", "platform_admin:s1", "203.0.113.9")).resolves.toEqual({ ok: true })

      expect(prisma.teamMembership.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team-1", userId: "user-1" } })
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        action: "admin.team.member_remove",
        targetType: "team",
        targetId: "team-1",
        detail: { userId: "user-1" },
      }))
    })

    it("rejects a user who is not in the team", async () => {
      prisma.teamMembership.deleteMany.mockResolvedValue({ count: 0 })
      const { service, record } = createService(prisma)

      await expect(service.removeMember("team-1", "user-404")).rejects.toThrow("该用户不在这个团队中。")
      expect(record).not.toHaveBeenCalled()
    })
  })

  it("keeps the business result when audit writes fail", async () => {
    prisma.team.create.mockResolvedValue(createTeamRecord())
    const record = vi.fn().mockRejectedValue(new Error("audit database unavailable"))
    const { service } = createService(prisma, record)

    await expect(service.createTeam({ name: "产品组" })).resolves.toMatchObject({ id: "team-1" })
    expect(record).toHaveBeenCalledOnce()
  })
})
