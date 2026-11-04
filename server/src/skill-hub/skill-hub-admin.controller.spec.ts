import { GUARDS_METADATA } from "@nestjs/common/constants"
import { describe, expect, it } from "vitest"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { SkillHubAdminController } from "./skill-hub-admin.controller"

describe("Skill Hub administrator API", () => {
  it("uses the existing separate administrator guard and has no package or main read action", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SkillHubAdminController)).toEqual([AdminAuthGuard])
    expect(Object.getOwnPropertyNames(SkillHubAdminController.prototype).sort()).toEqual(["assignMaintainer", "constructor", "list", "restore"])
  })
})
