import { describe, expect, it, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../prisma/prisma.service"
import { SkillHubRepository } from "./skill-hub.repository"
import { SkillHubTeamService } from "./skill-hub-team.service"

const rows = [
  { userId: "multi", team: { id: "a", name: "一队" }, status: "active" },
  { userId: "multi", team: { id: "b", name: "二队" }, status: "active" },
  { userId: "single", team: { id: "b", name: "二队" }, status: "active" },
  { userId: "other", team: { id: "c", name: "三队" }, status: "active" },
  { userId: "disabled", team: { id: "a", name: "一队" }, status: "disabled" },
]

function fixture() {
  const findMany = vi.fn(async ({ where, take }: { where: Prisma.TeamMembershipWhereInput; take: number }) => rows
    .filter((row) => row.userId === where.userId && row.status === (where.user as { status: string }).status)
    .filter((row) => where.teamId === undefined || (typeof where.teamId === "string" ? row.team.id === where.teamId : row.team.id > String(where.teamId.gt)))
    .slice(0, take)
    .map(({ team }) => ({ team })))
  const teamMembership = { findMany }
  const $transaction = vi.fn(async (run) => run({ teamMembership }))
  const repository = new SkillHubRepository({ $transaction, teamMembership } as unknown as PrismaService)
  return { service: new SkillHubTeamService(repository), $transaction, findMany }
}

describe("Skill Hub personal team directory", () => {
  it("classifies all effective memberships while paginating the caller's own rows", async () => {
    const { service, $transaction } = fixture()
    const first = await service.listForUser("multi", { limit: 1 })
    expect(first).toEqual({ items: [rows[0].team], nextCursor: expect.any(String), selectionState: "multiple", defaultTeamId: null })
    await expect(service.listForUser("multi", { limit: 1, cursor: first.nextCursor! })).resolves.toEqual({
      items: [rows[1].team], nextCursor: null, selectionState: "multiple", defaultTeamId: null,
    })
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" })
    await expect(service.listForUser("single", { limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({
      response: { code: "HUB_INVALID_CURSOR" },
    })
  })

  it("selects only the unique active membership or a requested team the caller belongs to", async () => {
    const { service } = fixture()
    await expect(service.listForUser("disabled", {})).resolves.toEqual({
      items: [], nextCursor: null, selectionState: "none", defaultTeamId: null,
    })
    await expect(service.resolveUploadTeam("none")).rejects.toMatchObject({ response: { code: "HUB_NO_TEAM" } })
    await expect(service.resolveUploadTeam("multi")).rejects.toMatchObject({ response: { code: "HUB_TEAM_REQUIRED" } })
    await expect(service.resolveUploadTeam("single")).resolves.toEqual(rows[2].team)
    await expect(service.resolveUploadTeam("multi", "b")).resolves.toEqual(rows[1].team)
    await expect(service.resolveUploadTeam("multi", "c")).rejects.toMatchObject({ response: { code: "HUB_TEAM_UNAVAILABLE" } })
  })
})
