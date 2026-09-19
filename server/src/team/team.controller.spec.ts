import { GUARDS_METADATA } from "@nestjs/common/constants"
import { describe, expect, it, vi } from "vitest"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import type { AuditLogService } from "../common/audit-log.service"
import { TeamController } from "./team.controller"
import { teamMemberAddLimit, type TeamService } from "./team.service"

function createController(
  service: Partial<TeamService>,
  auditLog: Partial<AuditLogService> = {},
) {
  const ControllerCtor = TeamController as new (
    service: TeamService,
    auditLog: AuditLogService,
  ) => TeamController
  return new ControllerCtor(
    service as TeamService,
    { record: vi.fn().mockResolvedValue(undefined), ...auditLog } as AuditLogService,
  )
}

function adminRequest() {
  return { admin: { email: "platform_admin:s1" }, ip: "203.0.113.9" } as never
}

function createAuditLog() {
  return { record: vi.fn().mockResolvedValue(undefined) }
}

describe("TeamController", () => {
  it("keeps team routes behind the admin auth guard", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TeamController)).toContain(AdminAuthGuard)
  })

  it("lists teams and audits the read", async () => {
    const listTeams = vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 })
    const auditLog = createAuditLog()
    const controller = createController({ listTeams }, { record: auditLog.record })

    await expect(controller.listTeams(
      { page: "2", pageSize: "10", sortBy: "memberCount", sortOrder: "asc" },
      adminRequest(),
    )).resolves.toEqual({ data: [], total: 0, page: 2, pageSize: 10 })

    expect(listTeams).toHaveBeenCalledWith({ page: 2, pageSize: 10, sortBy: "memberCount", sortOrder: "asc" })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "platform_admin:s1",
      action: "admin.teams.list",
      targetType: "team",
      targetId: "list",
      detail: { page: 2, pageSize: 10 },
      ipAddress: "203.0.113.9",
    })
  })

  it("rejects unsupported team sort fields", async () => {
    const listTeams = vi.fn()
    const auditLog = createAuditLog()
    const controller = createController({ listTeams }, { record: auditLog.record })

    await expect(controller.listTeams({ sortBy: "members" }, adminRequest())).rejects.toThrow("排序字段无效。")
    expect(listTeams).not.toHaveBeenCalled()
  })

  it("creates a team with the admin actor", async () => {
    const createTeam = vi.fn().mockResolvedValue({ id: "team-1", name: "产品组" })
    const auditLog = createAuditLog()
    const controller = createController({ createTeam }, { record: auditLog.record })

    await expect(controller.createTeam({ name: "产品组" }, adminRequest()))
      .resolves.toEqual({ id: "team-1", name: "产品组" })

    expect(createTeam).toHaveBeenCalledWith({ name: "产品组" }, "platform_admin:s1", "203.0.113.9")
  })

  it("rejects blank and oversized team names before calling the service", async () => {
    const createTeam = vi.fn()
    const auditLog = createAuditLog()
    const controller = createController({ createTeam }, { record: auditLog.record })

    await expect(controller.createTeam({ name: "   " }, adminRequest())).rejects.toThrow("团队名称无效")
    await expect(controller.createTeam({ name: "团".repeat(31) }, adminRequest())).rejects.toThrow("不能超过 30 个字符")
    expect(createTeam).not.toHaveBeenCalled()
  })

  it("rejects unknown fields in the team name body", async () => {
    const createTeam = vi.fn()
    const auditLog = createAuditLog()
    const controller = createController({ createTeam }, { record: auditLog.record })

    await expect(controller.createTeam({ name: "产品组", role: "lead" }, adminRequest()))
      .rejects
      .toThrow("包含不支持的字段")
    expect(createTeam).not.toHaveBeenCalled()
  })

  it("renames a team", async () => {
    const renameTeam = vi.fn().mockResolvedValue({ id: "team-1", name: "研发组" })
    const auditLog = createAuditLog()
    const controller = createController({ renameTeam }, { record: auditLog.record })

    await expect(controller.renameTeam("team-1", { name: "研发组" }, adminRequest()))
      .resolves.toMatchObject({ name: "研发组" })

    expect(renameTeam).toHaveBeenCalledWith("team-1", { name: "研发组" }, "platform_admin:s1", "203.0.113.9")
  })

  it("deletes a team", async () => {
    const deleteTeam = vi.fn().mockResolvedValue({ ok: true })
    const auditLog = createAuditLog()
    const controller = createController({ deleteTeam }, { record: auditLog.record })

    await expect(controller.deleteTeam("team-1", adminRequest())).resolves.toEqual({ ok: true })
    expect(deleteTeam).toHaveBeenCalledWith("team-1", "platform_admin:s1", "203.0.113.9")
  })

  it("lists members with pagination", async () => {
    const listMembers = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const auditLog = createAuditLog()
    const controller = createController({ listMembers }, { record: auditLog.record })

    await controller.listMembers("team-1", { page: "1", pageSize: "20" })

    expect(listMembers).toHaveBeenCalledWith("team-1", { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" })
  })

  it("passes the trimmed candidate search to the service", async () => {
    const listMemberCandidates = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50 })
    const auditLog = createAuditLog()
    const controller = createController({ listMemberCandidates }, { record: auditLog.record })

    await controller.listMemberCandidates("team-1", { page: "1", pageSize: "50", query: "  liyang  " })

    expect(listMemberCandidates).toHaveBeenCalledWith(
      "team-1",
      { page: 1, pageSize: 50, sortBy: "createdAt", sortOrder: "desc" },
      "liyang",
    )
  })

  it("adds members in one batch", async () => {
    const addMembers = vi.fn().mockResolvedValue({ added: 2 })
    const auditLog = createAuditLog()
    const controller = createController({ addMembers }, { record: auditLog.record })

    await expect(controller.addMembers("team-1", { userIds: ["user-1", "user-2"] }, adminRequest()))
      .resolves.toEqual({ added: 2 })

    expect(addMembers).toHaveBeenCalledWith("team-1", ["user-1", "user-2"], "platform_admin:s1", "203.0.113.9")
  })

  it("rejects member batches over the limit before calling the service", async () => {
    const addMembers = vi.fn()
    const auditLog = createAuditLog()
    const controller = createController({ addMembers }, { record: auditLog.record })

    await expect(controller.addMembers(
      "team-1",
      { userIds: Array.from({ length: teamMemberAddLimit + 1 }, (_, index) => `user-${index}`) },
      adminRequest(),
    )).rejects.toThrow(`一次最多添加 ${teamMemberAddLimit} 名成员`)
    expect(addMembers).not.toHaveBeenCalled()
  })

  it("removes a single member", async () => {
    const removeMember = vi.fn().mockResolvedValue({ ok: true })
    const auditLog = createAuditLog()
    const controller = createController({ removeMember }, { record: auditLog.record })

    await expect(controller.removeMember("team-1", "user-1", adminRequest())).resolves.toEqual({ ok: true })
    expect(removeMember).toHaveBeenCalledWith("team-1", "user-1", "platform_admin:s1", "203.0.113.9")
  })

  it("keeps the team list response when audit writes fail", async () => {
    const result = { data: [], total: 0, page: 1, pageSize: 20 }
    const listTeams = vi.fn().mockResolvedValue(result)
    const record = vi.fn().mockRejectedValue(new Error("audit database unavailable"))
    const auditLog = { record }
    const controller = createController({ listTeams }, auditLog)

    await expect(controller.listTeams({}, adminRequest())).resolves.toEqual(result)
    expect(auditLog.record).toHaveBeenCalledOnce()
  })
})
