import { describe, expect, it, vi } from "vitest"
import { TeamsController } from "./teams.controller"
import type { TeamsService } from "./teams.service"

describe("TeamsController", () => {
  it("passes request IP to team creation", () => {
    const service = {
      createTeam: vi.fn().mockResolvedValue({ id: "team-1" }),
    }
    const controller = new TeamsController(service as unknown as TeamsService)

    controller.createTeam({
      user: { id: "user-1" },
      ip: "203.0.113.10",
    } as never, { name: "Team" })

    expect(service.createTeam).toHaveBeenCalledWith(
      "user-1",
      { name: "Team" },
      "203.0.113.10",
    )
  })

  it("rejects invalid team creation fields with field details", () => {
    const service = {
      createTeam: vi.fn(),
    }
    const controller = new TeamsController(service as unknown as TeamsService)

    expect(() => controller.createTeam({
      user: { id: "user-1" },
      ip: "203.0.113.10",
    } as never, { name: "" }))
      .toThrow("团队创建请求无效：name 至少 1 个字符")
    expect(service.createTeam).not.toHaveBeenCalled()
  })

  it("rejects invalid team join fields with field details", () => {
    const service = {
      joinTeam: vi.fn(),
    }
    const controller = new TeamsController(service as unknown as TeamsService)

    expect(() => controller.joinTeam({
      user: { id: "user-1" },
      ip: "203.0.113.10",
    } as never, { token: "" }))
      .toThrow("加入团队请求无效：token 至少 1 个字符")
    expect(service.joinTeam).not.toHaveBeenCalled()
  })

  it("passes request IP to member removal", () => {
    const service = {
      removeMember: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new TeamsController(service as unknown as TeamsService)

    controller.removeMember({
      user: { id: "owner-1" },
      ip: "203.0.113.20",
    } as never, "user-2")

    expect(service.removeMember).toHaveBeenCalledWith("owner-1", "user-2", "203.0.113.20")
  })
})
