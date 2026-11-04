import { GUARDS_METADATA } from "@nestjs/common/constants"
import { describe, expect, it, vi } from "vitest"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { SkillHubController } from "./skill-hub.controller"
import type { SkillHubService } from "./skill-hub.service"

describe("Skill Hub user API", () => {
  it("uses ordinary authentication and rejects old fields before publishing", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SkillHubController)).toContain(UserAuthGuard)
    const create = vi.fn()
    const controller = new SkillHubController({ create } as unknown as SkillHubService)
    const request = { user: { id: "caller" }, headers: {}, userAuthMethod: "bearer" } as AuthenticatedUserRequest
    expect(() => controller.create(request, { visibility: "public" })).toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})
