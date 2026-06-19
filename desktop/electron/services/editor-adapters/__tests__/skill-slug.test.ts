import { describe, expect, it } from "vitest"

import { resolveSkillSlug } from "../skill-slug"

describe("resolveSkillSlug", () => {
  it("falls back when title-derived slugs are Windows reserved names", () => {
    expect(resolveSkillSlug(undefined, "CON", "skill-123")).toBe("skill-123")
    expect(resolveSkillSlug(undefined, "LPT1", "skill-123")).toBe("skill-123")
  })

  it("does not use explicit Windows reserved skill names as directory slugs", () => {
    expect(resolveSkillSlug("aux", "Review", "skill-123")).toBe("review")
    expect(resolveSkillSlug("nul", "CON", "skill-123")).toBe("skill-123")
  })
})
