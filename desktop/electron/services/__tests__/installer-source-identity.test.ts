import { describe, expect, it } from "vitest"
import {
  createInlineRuleSourceIdentity,
  createLocalSkillSourceIdentity,
} from "../installer-source-identity"

describe("installer-source-identity", () => {
  it("creates deterministic inline rule identities without exposing body text", () => {
    const first = createInlineRuleSourceIdentity("Release.Rule", "# Release\nUse checks.")
    const second = createInlineRuleSourceIdentity("release.rule", "# Release\nUse checks.")

    expect(first).toBe(second)
    expect(first).toMatch(/^inline-rule:[a-f0-9]{64}$/)
    expect(first).not.toContain("Release")
    expect(first).not.toContain("checks")
  })

  it("creates deterministic local skill identities without exposing the path", () => {
    const identity = createLocalSkillSourceIdentity("/Users/example/skills/demo")

    expect(identity).toMatch(/^local-skill:[a-f0-9]{64}$/)
    expect(identity).not.toContain("/Users/example")
    expect(identity).not.toContain("demo")
  })
})
