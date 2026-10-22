import { describe, expect, it } from "vitest"
import { isCanonicalCapabilityId } from "../naming"
import { WECOM_DOMAIN, buildWecomTools } from "../wecom-domain"

describe("Enterprise WeChat capability domain", () => {
  it("registers canonical mail capabilities", () => {
    expect(WECOM_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "app.wecom.mail.list",
      "app.wecom.mail.get",
      "app.wecom.mail.send",
    ])
    for (const capability of WECOM_DOMAIN.capabilities) {
      expect(isCanonicalCapabilityId(capability.id), capability.id).toBe(true)
    }
  })

  it("publishes the three mail tools with pagination and confirmation contracts", () => {
    const tools = buildWecomTools()
    expect(tools.map((tool) => tool.name)).toEqual([
      "app_wecom_mail_list",
      "app_wecom_mail_get",
      "app_wecom_mail_send",
    ])
    expect(tools.find((tool) => tool.name === "app_wecom_mail_list")?.description)
      .toContain("Pagination: cursor-based")
    expect(tools.find((tool) => tool.name === "app_wecom_mail_send")?.inputSchema.required)
      .toContain("confirmed")
  })
})
