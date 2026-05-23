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
