import { describe, expect, it } from "vitest"
import { skillHubCreateInputSchema, skillHubTeamPageSchema, skillHubUpdateInputSchema } from "./skill-hub-contracts.js"

const create = { teamId: "team", packageUploadId: "upload", requestId: "request", displayName: "团队助手", displayDescription: "处理团队资料" }

describe("Skill Hub contracts", () => {
  it("accepts Chinese store metadata without admitting legacy access or package fields", () => {
    expect(skillHubCreateInputSchema.parse(create)).toEqual(create)
    for (const field of ["visibility", "teamIds", "ownerId", "name", "description", "userId"]) {
      expect(skillHubCreateInputSchema.safeParse({ ...create, [field]: "unexpected" }).success).toBe(false)
      expect(skillHubUpdateInputSchema.safeParse({ requestId: "r", expectedRevision: 1, [field]: "unexpected" }).success).toBe(false)
    }
  })

  it("counts Unicode code points for display names and rejects blank descriptions", () => {
    expect(skillHubCreateInputSchema.safeParse({ ...create, displayName: "𠮷".repeat(100) }).success).toBe(true)
    expect(skillHubCreateInputSchema.safeParse({ ...create, displayName: "𠮷".repeat(101) }).success).toBe(false)
    expect(skillHubCreateInputSchema.safeParse({ ...create, displayDescription: "  " }).success).toBe(false)
  })

  it("does not infer a default from a single row in a paginated multi-team response", () => {
    const page = { items: [{ id: "one", name: "一队" }], nextCursor: "next", selectionState: "multiple", defaultTeamId: null }
    expect(skillHubTeamPageSchema.parse(page)).toEqual(page)
    expect(skillHubTeamPageSchema.safeParse({ ...page, defaultTeamId: "one" }).success).toBe(false)
  })
})
