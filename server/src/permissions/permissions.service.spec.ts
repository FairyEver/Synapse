import { BadRequestException } from "@nestjs/common"
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
    },
    teamMembership: {
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
      select: { id: true },
    })
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
        source: "migration",
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
