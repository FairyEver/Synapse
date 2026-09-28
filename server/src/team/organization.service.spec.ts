import { BadRequestException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import type { AuditLogService } from "../common/audit-log.service"
import type { PrismaService } from "../prisma/prisma.service"
import { OrganizationService } from "./organization.service"

function harness() {
  const prisma = {
    $transaction: vi.fn((input: unknown) => typeof input === "function" ? input(prisma) : Promise.all(input as Promise<unknown>[])),
    team: { findUnique: vi.fn().mockResolvedValue({ id: "team-a" }) },
    organization: {
      findFirst: vi.fn().mockResolvedValue({ id: "parent", name: "开发中心", parentId: null }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "new", name: "设计中心", parentId: null }),
      update: vi.fn().mockResolvedValue({ id: "parent", name: "研发中心", parentId: null }),
      delete: vi.fn().mockResolvedValue({ id: "parent" }),
    },
    organizationMembership: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    teamMembership: { count: vi.fn().mockResolvedValue(2) },
  }
  const record = vi.fn().mockResolvedValue(undefined)
  const service = new OrganizationService(prisma as unknown as PrismaService, { record } as unknown as AuditLogService)
  return { service, prisma, record }
}

describe("OrganizationService", () => {
  it("counts unique members across descendants while keeping direct counts separate", async () => {
    const { service, prisma } = harness()
    prisma.organization.findMany.mockResolvedValue([
      { id: "parent", parentId: null, name: "开发中心" },
      { id: "child", parentId: "parent", name: "前端" },
    ])
    prisma.organizationMembership.findMany.mockResolvedValue([
      { organizationId: "parent", userId: "u1" },
      { organizationId: "child", userId: "u1" },
      { organizationId: "child", userId: "u2" },
    ])
    await expect(service.list("team-a")).resolves.toMatchObject([
      { id: "parent", directCount: 1, memberCount: 2 },
      { id: "child", directCount: 2, memberCount: 2 },
    ])
  })

  it("rejects a parent from another team", async () => {
    const { service, prisma } = harness()
    prisma.organization.findFirst.mockResolvedValue(null)
    await expect(service.create("team-a", { name: "设计中心", parentId: "foreign" })).rejects.toThrow(NotFoundException)
    expect(prisma.organization.create).not.toHaveBeenCalled()
  })

  it("rejects moving a parent under its descendant", async () => {
    const { service, prisma } = harness()
    prisma.organization.findMany.mockResolvedValue([
      { id: "parent", parentId: null },
      { id: "child", parentId: "parent" },
    ])
    await expect(service.update("team-a", "parent", { name: "开发中心", parentId: "child" })).rejects.toThrow(BadRequestException)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it("requires every added member to belong to the team", async () => {
    const { service, prisma } = harness()
    prisma.teamMembership.count.mockResolvedValue(1)
    await expect(service.addMembers("team-a", "parent", ["u1", "u2"])).rejects.toThrow("成员必须属于当前团队。")
    expect(prisma.organizationMembership.createMany).not.toHaveBeenCalled()
  })

  it("deletes the root and records an administrator audit", async () => {
    const { service, prisma, record } = harness()
    await expect(service.delete("team-a", "parent", "admin@example.com", "127.0.0.1")).resolves.toEqual({ ok: true })
    expect(prisma.organization.delete).toHaveBeenCalledWith({ where: { id: "parent" } })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.organization.delete", targetId: "parent" }))
  })
})
