import { describe, expect, it } from "vitest"
import { isCanonicalCapabilityId } from "../naming"
import { MAIL_DOMAIN } from "../mail-domain"
import { CAPABILITY_DOMAINS, MCP_TOOL_ACTIONS, getActionDomainId } from "../registry"

describe("mail capability registry", () => {
  it("uses canonical ids for every registered mail capability", () => {
    for (const capability of MAIL_DOMAIN.capabilities) {
      expect(isCanonicalCapabilityId(capability.id), capability.id).toBe(true)
    }
  })

  it("loads the complete registry with the conversation tool", () => {
    expect(CAPABILITY_DOMAINS).toContain(MAIL_DOMAIN)
    expect(getActionDomainId("app.mail.context.list")).toBe("mail")
    expect(MCP_TOOL_ACTIONS.app_mail_context_list).toBe("app.mail.context.list")
  })
})
