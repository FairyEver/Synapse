import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import {
  allPermissionKeys,
  assertActivePermissionKey,
  normalizePermissionKeys,
  permissionDefinitions,
} from "./permission-registry"
import { PermissionsService } from "./permissions.service"

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

  it("rejects role permissions outside team entitlements", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamEntitlement.findMany.mockResolvedValue([{ permissionKey: "database.use" }])
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceRolePermissions({
      teamId: "team-1",
      roleId: "role-1",
      permissionKeys: ["workflow.use"],
    })).rejects.toThrow(BadRequestException)
  })

  it("intersects role permissions with entitlements for effective permissions", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.teamEntitlement.findMany.mockResolvedValue([
      { permissionKey: "database.use" },
      { permissionKey: "workflow.use" },
    ])
    prisma.teamMemberAccessRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permissionKey: "database.use" }, { permissionKey: "team.role.manage" }] } },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.getEffectivePermissions("user-1", "team-1")).resolves.toEqual(["database.use"])
  })
})
