import { describe, expect, it } from "vitest"
import { isCanonicalCapabilityId } from "../naming"
import { MAIL_INTERNAL_DOMAIN } from "../mail-internal-domain"
import { CAPABILITY_DOMAINS, MCP_TOOL_ACTIONS, getActionDomainId, buildAllMcpTools } from "../registry"
import { WECOM_DOMAIN } from "../wecom-domain"

describe("mail capability registry", () => {
  it("registers the Todo cloud domain", () => {
    expect(getActionDomainId("app.todos.item.list")).toBe("todos")
    expect(MCP_TOOL_ACTIONS.app_todos_item_list).toBe("app.todos.item.list")
  })
  it("uses canonical ids for every registered mail capability", () => {
    for (const capability of MAIL_INTERNAL_DOMAIN.capabilities) {
      expect(isCanonicalCapabilityId(capability.id), capability.id).toBe(true)
    }
  })

  it("loads the complete registry with the conversation tool", () => {
    expect(CAPABILITY_DOMAINS).toContain(MAIL_INTERNAL_DOMAIN)
    expect(CAPABILITY_DOMAINS).toContain(WECOM_DOMAIN)
    expect(getActionDomainId("app.mail_internal.context.list")).toBe("mail_internal")
    expect(getActionDomainId("app.wecom.cli.run")).toBe("wecom")
    expect(MCP_TOOL_ACTIONS.app_mail_internal_context_list).toBe("app.mail_internal.context.list")
    expect(MCP_TOOL_ACTIONS.app_wecom_cli_run).toBe("app.wecom.cli.run")
  })
})

it("publishes exactly 17 internal mail tools and no legacy mail tools", () => {
  const tools = buildAllMcpTools()
  expect(tools.filter(t => t.name.startsWith("app_mail_internal_"))).toHaveLength(17)
  expect(tools.filter(t => t.name.startsWith("app_mail_") && !t.name.startsWith("app_mail_internal_"))).toHaveLength(0)
})
