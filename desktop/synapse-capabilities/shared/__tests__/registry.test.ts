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

it("publishes 18 internal mail tools and 44 separate external mail tools", () => {
  const tools = buildAllMcpTools()
  expect(tools.filter(t => t.name.startsWith("app_mail_internal_"))).toHaveLength(18)
  expect(tools.filter(t => t.name.startsWith("app_mail_") && !t.name.startsWith("app_mail_internal_"))).toHaveLength(44)
  expect(MAIL_INTERNAL_DOMAIN.capabilities.find(({ id }) => id === "app.mail_internal.recipient.resolve")?.mutates).toBe(false)
  expect(tools.find(tool => tool.name === "app_mail_internal_recipient_resolve")?.inputSchema).toMatchObject({
    required: ["nicknames"], properties: { nicknames: { type: "array", minItems: 1, maxItems: 50 } },
  })
})


it("registers exactly ten Skill Hub index entries without old Skill repository aliases", () => {
  const tools = buildAllMcpTools().filter((tool) => tool.name.startsWith("app_skill_hub_"))
  expect(tools).toHaveLength(10)
  expect(Object.keys(MCP_TOOL_ACTIONS).filter((name) => name.startsWith("app_skill_hub_"))).toHaveLength(10)
  expect(getActionDomainId("app.skill_hub.team.list")).toBe("skill_hub")
  expect(getActionDomainId("app.skill_hub.skill.restore")).toBeNull()
  expect(getActionDomainId("app.skill_repository.skill.list")).toBeNull()
})
