import { BadRequestException, ForbiddenException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import {
  allPermissionKeys,
  assertActivePermissionKey,
  normalizePermissionKeys,
  permissionDefinitions,
} from "./permission-registry"
import { ordinaryMemberRoleName, PermissionsService, teamAdminRoleName } from "./permissions.service"

describe("permission registry", () => {
  it("keeps permission keys unique and kebab-case", () => {
    expect(new Set(allPermissionKeys).size).toBe(allPermissionKeys.length)
    for (const key of allPermissionKeys) {
      expect(key).toMatch(/^[a-z]+(?:-[a-z]+)*(?:\.[a-z]+(?:-[a-z]+)*){1,2}$/)
    }
  })

  it("rejects unknown permission keys", () => {
    expect(() => assertActivePermissionKey("database.use")).not.toThrow()
    expect(() => assertActivePermissionKey("page.database")).toThrow("Unknown permission key: page.database")
  })

  it("marks first-release permissions as active", () => {
    expect(permissionDefinitions.every((item) => item.status === "active")).toBe(true)
  })

  it("dedupes and sorts permission keys", () => {
    expect(normalizePermissionKeys(["workflow.use", "database.use", "workflow.use"])).toEqual([
      "database.use",
      "workflow.use",
    ])
  })

  it("rejects unknown keys when normalizing permissions", () => {
    expect(() => normalizePermissionKeys(["database.use", "page.database"])).toThrow(
      "Unknown permission key: page.database",
    )
  })
})

function createPermissionPrismaMock() {
  return {
    teamEntitlement: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    teamAccessRole: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    teamAccessRolePermission: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    teamMemberAccessRole: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    teamMembership: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(createPermissionPrismaMock())),
  }
}

describe("PermissionsService", () => {
  it("replaces team entitlements with normalized active keys", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    const service = new PermissionsService(prisma as never)

    await service.replaceTeamEntitlements({
      teamId: "team-1",
      permissionKeys: ["workflow.use", "database.use", "database.use"],
      grantedByAdminId: "admin-1",
      source: "manual",
    })

    expect(tx.teamEntitlement.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team-1" } })
    expect(tx.teamEntitlement.createMany).toHaveBeenCalledWith({
      data: [
        { teamId: "team-1", permissionKey: "database.use", grantedByAdminId: "admin-1", source: "manual" },
        { teamId: "team-1", permissionKey: "workflow.use", grantedByAdminId: "admin-1", source: "manual" },
      ],
    })
  })

  it("removes role permissions outside replacement team entitlements", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    const service = new PermissionsService(prisma as never)

    await service.replaceTeamEntitlements({
      teamId: "team-1",
      permissionKeys: ["database.use", "workflow.use"],
      grantedByAdminId: "admin-1",
      source: "manual",
    })

    expect(tx.teamAccessRolePermission.deleteMany).toHaveBeenCalledWith({
      where: {
        role: { teamId: "team-1" },
        permissionKey: { notIn: ["database.use", "workflow.use"] },
      },
    })
  })

  it("replaces team entitlements and role permissions in one transaction", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.teamEntitlement.findMany.mockResolvedValue([
      { permissionKey: "database.use" },
      { permissionKey: "workflow.use" },
    ])
    tx.teamAccessRole.findFirst.mockResolvedValue({ id: "role-1", locked: false })
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceTeamPermissions({
      teamId: "team-1",
      permissionKeys: ["workflow.use", "database.use", "database.use"],
      rolePermissions: [{
        roleId: "role-1",
        permissionKeys: ["workflow.use", "database.use"],
      }],
      grantedByAdminId: "admin-1",
      source: "manual",
    }))
      .resolves
      .toEqual({
        permissionKeys: ["database.use", "workflow.use"],
        rolePermissions: [{
          roleId: "role-1",
          permissionKeys: ["database.use", "workflow.use"],
        }],
      })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.teamEntitlement.deleteMany).toHaveBeenCalledWith({ where: { teamId: "team-1" } })
    expect(tx.teamEntitlement.createMany).toHaveBeenCalledWith({
      data: [
        { teamId: "team-1", permissionKey: "database.use", grantedByAdminId: "admin-1", source: "manual" },
        { teamId: "team-1", permissionKey: "workflow.use", grantedByAdminId: "admin-1", source: "manual" },
      ],
    })
    expect(tx.teamAccessRole.findFirst).toHaveBeenCalledWith({
      where: { id: "role-1", teamId: "team-1" },
      select: { id: true, locked: true },
    })
    expect(tx.teamAccessRolePermission.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        role: { teamId: "team-1" },
        permissionKey: { notIn: ["database.use", "workflow.use"] },
      },
    })
    expect(tx.teamAccessRolePermission.deleteMany).toHaveBeenNthCalledWith(2, {
      where: { roleId: "role-1" },
    })
    expect(tx.teamAccessRolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { roleId: "role-1", permissionKey: "database.use" },
        { roleId: "role-1", permissionKey: "workflow.use" },
      ],
    })
  })

  it("lists only active team entitlements in query order", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamEntitlement.findMany.mockResolvedValue([
      { permissionKey: "database.use" },
      { permissionKey: "workflow.use" },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.listTeamEntitlements("team-1")).resolves.toEqual(["database.use", "workflow.use"])
    expect(prisma.teamEntitlement.findMany).toHaveBeenCalledWith({
      where: {
        teamId: "team-1",
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      select: { permissionKey: true },
      orderBy: { permissionKey: "asc" },
    })
  })

  it("rejects role permissions outside team entitlements", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.teamAccessRole.findFirst.mockResolvedValue({ id: "role-1" })
    tx.teamEntitlement.findMany.mockResolvedValue([{ permissionKey: "database.use" }])
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceRolePermissions({
      teamId: "team-1",
      roleId: "role-1",
      permissionKeys: ["workflow.use"],
    })).rejects.toThrow(BadRequestException)
  })

  it("rejects role permissions when the role is not in the provided team", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    prisma.teamEntitlement.findMany.mockResolvedValue([{ permissionKey: "workflow.use" }])
    tx.teamEntitlement.findMany.mockResolvedValue([{ permissionKey: "workflow.use" }])
    tx.teamAccessRole.findFirst.mockResolvedValue(null)
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceRolePermissions({
      teamId: "team-a",
      roleId: "team-b-role",
      permissionKeys: ["workflow.use"],
    })).rejects.toThrow(BadRequestException)

    expect(tx.teamAccessRole.findFirst).toHaveBeenCalledWith({
      where: { id: "team-b-role", teamId: "team-a" },
      select: { id: true, locked: true },
    })
    expect(tx.teamAccessRolePermission.deleteMany).not.toHaveBeenCalled()
    expect(tx.teamAccessRolePermission.createMany).not.toHaveBeenCalled()
  })

  it("rejects replacing permissions on locked roles", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.teamAccessRole.findFirst.mockResolvedValue({ id: "role-1", locked: true })
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceRolePermissions({
      teamId: "team-1",
      roleId: "role-1",
      permissionKeys: ["database.use"],
    })).rejects.toThrow(ForbiddenException)

    expect(tx.teamAccessRole.findFirst).toHaveBeenCalledWith({
      where: { id: "role-1", teamId: "team-1" },
      select: { id: true, locked: true },
    })
    expect(tx.teamEntitlement.findMany).not.toHaveBeenCalled()
    expect(tx.teamAccessRolePermission.deleteMany).not.toHaveBeenCalled()
    expect(tx.teamAccessRolePermission.createMany).not.toHaveBeenCalled()
  })

  it("ensures default team access with admin assignment and ordinary member ceiling", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamAccessRole.findFirst.mockResolvedValue(null)
    prisma.teamAccessRole.create
      .mockResolvedValueOnce({ id: "admin-role" })
      .mockResolvedValueOnce({ id: "ordinary-role" })
    const service = new PermissionsService(prisma as never)

    await service.ensureDefaultTeamAccess({
      teamId: "team-1",
      ownerMembershipId: "membership-1",
      ownerUserId: "user-1",
    })

    expect(prisma.teamEntitlement.createMany).toHaveBeenCalledWith({
      data: normalizePermissionKeys(allPermissionKeys).map((permissionKey) => ({
        teamId: "team-1",
        permissionKey,
        source: "plan",
      })),
      skipDuplicates: true,
    })
    expect(prisma.teamAccessRole.create).toHaveBeenNthCalledWith(1, {
      data: {
        teamId: "team-1",
        name: teamAdminRoleName,
        kind: "system",
        locked: true,
        sortOrder: 0,
      },
      select: { id: true },
    })
    expect(prisma.teamAccessRole.create).toHaveBeenNthCalledWith(2, {
      data: {
        teamId: "team-1",
        name: ordinaryMemberRoleName,
        kind: "system",
        locked: true,
        sortOrder: 1,
      },
      select: { id: true },
    })
    expect(prisma.teamMemberAccessRole.createMany).toHaveBeenCalledWith({
      data: [{
        teamId: "team-1",
        teamMembershipId: "membership-1",
        roleId: "admin-role",
        assignedByUserId: "user-1",
      }],
      skipDuplicates: true,
    })

    const adminPermissionCreate = prisma.teamAccessRolePermission.createMany.mock.calls[0]?.[0]
    const ordinaryPermissionCreate = prisma.teamAccessRolePermission.createMany.mock.calls[1]?.[0]
    expect(adminPermissionCreate).toEqual({
      data: normalizePermissionKeys(allPermissionKeys).map((permissionKey) => ({
        roleId: "admin-role",
        permissionKey,
      })),
    })
    expect(ordinaryPermissionCreate.data).toEqual(
      normalizePermissionKeys(allPermissionKeys)
        .filter((permissionKey) => ![
          "team.member.manage",
          "team.role.manage",
          "team.invitation.manage",
        ].includes(permissionKey))
        .map((permissionKey) => ({ roleId: "ordinary-role", permissionKey })),
    )
  })

  it("assigns the ordinary member role with team scope", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamAccessRole.findFirst.mockResolvedValue({ id: "ordinary-role" })
    const service = new PermissionsService(prisma as never)

    await service.assignOrdinaryMemberRole({
      teamId: "team-1",
      teamMembershipId: "membership-1",
      assignedByUserId: "user-1",
    })

    expect(prisma.teamAccessRole.findFirst).toHaveBeenCalledWith({
      where: { teamId: "team-1", name: ordinaryMemberRoleName },
      select: { id: true },
    })
    expect(prisma.teamMemberAccessRole.createMany).toHaveBeenCalledWith({
      data: [{
        teamId: "team-1",
        teamMembershipId: "membership-1",
        roleId: "ordinary-role",
        assignedByUserId: "user-1",
      }],
      skipDuplicates: true,
    })
  })

  it("lists member access roles in assignment order", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamMembership.findFirst.mockResolvedValue({ id: "membership-1" })
    prisma.teamMemberAccessRole.findMany.mockResolvedValue([
      {
        assignedAt: new Date("2026-05-24T00:00:00.000Z"),
        role: {
          id: "role-1",
          name: "普通成员",
          description: null,
          kind: "system",
          locked: true,
          sortOrder: 1,
        },
      },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.listMemberAccessRoles("team-1", "membership-1"))
      .resolves
      .toEqual([
        {
          id: "role-1",
          name: "普通成员",
          description: null,
          kind: "system",
          locked: true,
          sortOrder: 1,
          assignedAt: new Date("2026-05-24T00:00:00.000Z"),
        },
      ])
    expect(prisma.teamMembership.findFirst).toHaveBeenCalledWith({
      where: { id: "membership-1", teamId: "team-1" },
      select: { id: true },
    })
    expect(prisma.teamMemberAccessRole.findMany).toHaveBeenCalledWith({
      where: { teamId: "team-1", teamMembershipId: "membership-1" },
      select: {
        assignedAt: true,
        role: {
          select: {
            id: true,
            name: true,
            description: true,
            kind: true,
            locked: true,
            sortOrder: true,
          },
        },
      },
      orderBy: { assignedAt: "asc" },
    })
  })

  it("assigns a member access role only within the same team", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.teamMembership.findFirst.mockResolvedValue({ id: "membership-1" })
    tx.teamAccessRole.findFirst.mockResolvedValue({ id: "role-1" })
    prisma.teamMembership.findFirst.mockResolvedValue({ id: "membership-1" })
    prisma.teamMemberAccessRole.findMany.mockResolvedValue([])
    const service = new PermissionsService(prisma as never)

    await service.assignAccessRole({
      teamId: "team-1",
      teamMembershipId: "membership-1",
      roleId: "role-1",
      assignedByUserId: "user-1",
    })

    expect(tx.teamMembership.findFirst).toHaveBeenCalledWith({
      where: { id: "membership-1", teamId: "team-1" },
      select: { id: true },
    })
    expect(tx.teamAccessRole.findFirst).toHaveBeenCalledWith({
      where: { id: "role-1", teamId: "team-1" },
      select: { id: true },
    })
    expect(tx.teamMemberAccessRole.createMany).toHaveBeenCalledWith({
      data: [{
        teamId: "team-1",
        teamMembershipId: "membership-1",
        roleId: "role-1",
        assignedByUserId: "user-1",
      }],
      skipDuplicates: true,
    })
  })

  it("rejects assigning a role from another team", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.teamMembership.findFirst.mockResolvedValue({ id: "membership-1" })
    tx.teamAccessRole.findFirst.mockResolvedValue(null)
    const service = new PermissionsService(prisma as never)

    await expect(service.assignAccessRole({
      teamId: "team-1",
      teamMembershipId: "membership-1",
      roleId: "other-team-role",
    })).rejects.toThrow(BadRequestException)

    expect(tx.teamMemberAccessRole.createMany).not.toHaveBeenCalled()
  })

  it("removes a member access role within the same team", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.teamMembership.findFirst.mockResolvedValue({ id: "membership-1" })
    tx.teamMemberAccessRole.deleteMany.mockResolvedValue({ count: 1 })
    prisma.teamMembership.findFirst.mockResolvedValue({ id: "membership-1" })
    prisma.teamMemberAccessRole.findMany.mockResolvedValue([])
    const service = new PermissionsService(prisma as never)

    await service.removeAccessRole({
      teamId: "team-1",
      teamMembershipId: "membership-1",
      roleId: "role-1",
    })

    expect(tx.teamMembership.findFirst).toHaveBeenCalledWith({
      where: { id: "membership-1", teamId: "team-1" },
      select: { id: true },
    })
    expect(tx.teamMemberAccessRole.deleteMany).toHaveBeenCalledWith({
      where: { teamId: "team-1", teamMembershipId: "membership-1", roleId: "role-1" },
    })
  })

  it("intersects role permissions with entitlements for effective permissions", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamEntitlement.findMany.mockResolvedValue([
      { permissionKey: "database.use" },
      { permissionKey: "workflow.use" },
    ])
    prisma.teamMemberAccessRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permissionKey: "workflow.use" }, { permissionKey: "team.role.manage" }] } },
      { role: { permissions: [{ permissionKey: "database.use" }] } },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.getEffectivePermissions("user-1", "team-1")).resolves.toEqual([
      "database.use",
      "workflow.use",
    ])
  })
})
