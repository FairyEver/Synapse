import { BadRequestException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import {
  allModulePermissionKeys,
  assertActiveModulePermissionKey,
  modulePermissionDefinitions,
  normalizeModulePermissionKeys,
} from "./permission-registry"
import { PermissionsService } from "./permissions.service"

describe("module permission registry", () => {
  it("keeps module permission keys unique", () => {
    expect(new Set(allModulePermissionKeys).size).toBe(allModulePermissionKeys.length)
    expect(allModulePermissionKeys).toEqual([
      "module.skill",
      "module.rule",
      "module.prompt",
      "module.agent",
      "module.database",
      "module.scheduler",
      "module.workflow",
      "module.tools",
      "module.local",
      "module.usage",
    ])
  })

  it("rejects old action-style keys", () => {
    expect(() => assertActiveModulePermissionKey("content.skill.use")).toThrow("Unknown module permission key: content.skill.use")
    expect(() => assertActiveModulePermissionKey("workflow.use")).toThrow("Unknown module permission key: workflow.use")
  })

  it("dedupes and sorts module permission keys by registry order", () => {
    expect(normalizeModulePermissionKeys(["module.workflow", "module.skill", "module.workflow"])).toEqual([
      "module.skill",
      "module.workflow",
    ])
  })

  it("marks all first-release module permissions active", () => {
    expect(modulePermissionDefinitions.every((item) => item.status === "active")).toBe(true)
  })
})

function createPermissionPrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
    },
    userModulePermission: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn((callback) => callback(createPermissionPrismaMock())),
  }
}

describe("PermissionsService", () => {
  it("lists user module permissions in registry order", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.userModulePermission.findMany.mockResolvedValue([
      { permissionKey: "module.workflow" },
      { permissionKey: "module.skill" },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.listUserModulePermissions("user-1")).resolves.toEqual([
      "module.skill",
      "module.workflow",
    ])

    expect(prisma.userModulePermission.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { permissionKey: true },
    })
  })

  it("replaces user module permissions in one transaction", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.user.findUnique.mockResolvedValue({ id: "user-1" })
    tx.userModulePermission.findMany.mockResolvedValue([
      { permissionKey: "module.database" },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceUserModulePermissions({
      userId: "user-1",
      permissionKeys: ["module.workflow", "module.skill", "module.workflow"],
      grantedByAdminId: "admin-1",
    })).resolves.toEqual({
      before: ["module.database"],
      after: ["module.skill", "module.workflow"],
    })

    expect(tx.userModulePermission.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    })
    expect(tx.userModulePermission.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", permissionKey: "module.skill", grantedByAdminId: "admin-1" },
        { userId: "user-1", permissionKey: "module.workflow", grantedByAdminId: "admin-1" },
      ],
      skipDuplicates: true,
    })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it("ignores stale stored permission keys when listing", async () => {
    const prisma = createPermissionPrismaMock()
    prisma.userModulePermission.findMany.mockResolvedValue([
      { permissionKey: "module.workflow" },
      { permissionKey: "workflow.use" },
      { permissionKey: "module.skill" },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.listUserModulePermissions("user-1")).resolves.toEqual([
      "module.skill",
      "module.workflow",
    ])
  })

  it("deletes all user module permissions when replacing with none", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.user.findUnique.mockResolvedValue({ id: "user-1" })
    tx.userModulePermission.findMany.mockResolvedValue([
      { permissionKey: "module.database" },
    ])
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceUserModulePermissions({
      userId: "user-1",
      permissionKeys: [],
      grantedByAdminId: "admin-1",
    })).resolves.toEqual({
      before: ["module.database"],
      after: [],
    })

    expect(tx.userModulePermission.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    })
    expect(tx.userModulePermission.createMany).not.toHaveBeenCalled()
  })

  it("throws when replacing permissions for a missing user", async () => {
    const prisma = createPermissionPrismaMock()
    const tx = createPermissionPrismaMock()
    prisma.$transaction.mockImplementationOnce((callback) => callback(tx))
    tx.user.findUnique.mockResolvedValue(null)
    const service = new PermissionsService(prisma as never)

    await expect(service.replaceUserModulePermissions({
      userId: "missing",
      permissionKeys: ["module.skill"],
      grantedByAdminId: "admin-1",
    })).rejects.toThrow(NotFoundException)

    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(tx.userModulePermission.findMany).not.toHaveBeenCalled()
    expect(tx.userModulePermission.deleteMany).not.toHaveBeenCalled()
    expect(tx.userModulePermission.createMany).not.toHaveBeenCalled()
  })

  it("rejects unknown module permission keys", async () => {
    const service = new PermissionsService(createPermissionPrismaMock() as never)

    await expect(service.replaceUserModulePermissions({
      userId: "user-1",
      permissionKeys: ["database.use"],
      grantedByAdminId: "admin-1",
    })).rejects.toThrow(BadRequestException)
  })
})
