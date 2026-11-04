import { describe, expect, it, vi } from "vitest"
import { requireSkillHubE2eDatabase, runSkillHubE2e } from "./run-skill-hub-e2e.mjs"

describe("Skill Hub database isolation", () => {
  it.each([undefined, "postgres://remote/skill_hub_e2e", "postgres://localhost/production",
    "postgres://127.0.0.1/skill_hub_e2e?host=remote", "postgres://localhost/%2fother_e2e"])("rejects %s before spawning", (value) => {
    const spawn = vi.fn()
    expect(() => runSkillHubE2e({ SKILL_HUB_E2E_DATABASE_URL: value }, spawn)).toThrow()
    expect(spawn).not.toHaveBeenCalled()
  })
  it("uses the isolated URL and does not inherit object storage credentials", () => {
    const database = "postgresql://127.0.0.1:56432/skill_hub_e2e"
    expect(requireSkillHubE2eDatabase(database)).toBe(database)
    const spawn = vi.fn(() => ({ status: 0 }))
    expect(runSkillHubE2e({ SKILL_HUB_E2E_DATABASE_URL: database, DATABASE_URL: "postgresql://other/business",
      SKILL_HUB_COS_BUCKET: "external", SKILL_HUB_COS_SECRET_KEY: "external" }, spawn)).toBe(0)
    expect(spawn.mock.calls.length).toBe(6)
    for (const call of spawn.mock.calls) {
      const options = (call as unknown as [string, string[], { env: Record<string, string> }])[2]
      expect(options.env.DATABASE_URL).toBe(database)
      expect(options.env.SKILL_HUB_COS_BUCKET).toBeUndefined()
      expect(options.env.SKILL_HUB_COS_SECRET_KEY).toBeUndefined()
    }
  })
})
