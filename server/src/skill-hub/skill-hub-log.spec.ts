import { describe, expect, it } from "vitest"
import { isHubUploadPath, skillHubLogRequest } from "./skill-hub-log"

describe("Skill Hub HTTP logging", () => {
  it("classifies the actual Express upload path including case and trailing slash", () => {
    expect(isHubUploadPath("/API/SKILL-HUB/UPLOADS/?name=secret")).toBe(true)
    expect(isHubUploadPath("/api/skill-hub/uploads/other")).toBe(false)
  })

  it("drops request material and uses fixed paths even for unrecognized Hub paths", () => {
    expect(skillHubLogRequest({ method: "GET", url: "/Api/Skill-Hub/skills/id/main?token=test", headers: { authorization: "secret" }, body: "file" }))
      .toEqual({ method: "GET", url: "/api/skill-hub/skills/:id/main" })
    expect(skillHubLogRequest({ method: "POST", url: "/API/ADMIN/SKILL-HUB/sensitive-token" }))
      .toEqual({ method: "POST", url: "/api/admin/skill-hub" })
    expect(skillHubLogRequest({ url: "/api/skill-hub-other" })).toBeUndefined()
  })
})
