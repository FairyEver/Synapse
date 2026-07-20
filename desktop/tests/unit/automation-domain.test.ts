import { describe, expect, it } from "vitest"

import {
  AUTOMATION_DOMAIN,
  AUTOMATION_MCP_TOOL_ACTIONS,
  buildAutomationTools,
} from "../../synapse-capabilities/shared/automation-domain"
import {
  CAPABILITY_DOMAINS,
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
  getMcpToolDomainId,
} from "../../synapse-capabilities/shared/registry"

describe("Automation capability domain", () => {
  it("defines the Automation capability ids", () => {
    expect(AUTOMATION_DOMAIN.id).toBe("automation")
    expect(AUTOMATION_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "app.automation.item.list",
      "app.automation.item.get",
      "app.automation.item.create",
      "app.automation.item.update",
      "app.automation.item.delete",
      "app.automation.item.enable",
      "app.automation.item.disable",
      "app.automation.run.execute",
      "app.automation.run.disable",
      "app.automation.run.list",
      "app.automation.runtime.inspect",
      "app.automation.webhook.list",
      "app.automation.trigger_type.list",
      "app.automation.executor_type.list",
    ])
  })

  it("maps Automation MCP tool names to canonical actions", () => {
    expect(AUTOMATION_MCP_TOOL_ACTIONS.app_automation_item_list).toBe("app.automation.item.list")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.app_automation_item_create).toBe("app.automation.item.create")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.app_automation_run_execute).toBe("app.automation.run.execute")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.app_automation_webhook_list).toBe("app.automation.webhook.list")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.app_automation_trigger_type_list).toBe("app.automation.trigger_type.list")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.app_automation_executor_type_list).toBe("app.automation.executor_type.list")
  })

  it("registers Automation tools with the global MCP registry", () => {
    expect(CAPABILITY_DOMAINS.map((domain) => domain.id)).toContain("automation")
    expect(MCP_TOOL_ACTIONS.app_automation_item_delete).toBe("app.automation.item.delete")
    expect(MCP_TOOL_ACTIONS.app_automation_run_disable).toBe("app.automation.run.disable")
    expect(MCP_TOOL_ACTIONS.app_automation_webhook_list).toBe("app.automation.webhook.list")
    expect(getActionDomainId("app.automation.item.list")).toBe("automation")
    expect(getMcpToolDomainId("app_automation_runtime_inspect")).toBe("automation")

    const tools = buildAllMcpTools()
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "app_automation_item_list",
      "app_automation_item_create",
      "app_automation_item_update",
      "app_automation_item_delete",
      "app_automation_run_execute",
      "app_automation_runtime_inspect",
      "app_automation_webhook_list",
      "app_automation_trigger_type_list",
      "app_automation_executor_type_list",
    ]))
  })

  it("declares required input schema fields for mutating tools", () => {
    const tools = buildAutomationTools()
    expect(tools.find((tool) => tool.name === "app_automation_item_get")?.inputSchema.required).toEqual(["automationId"])
    expect(tools.find((tool) => tool.name === "app_automation_item_create")?.inputSchema.required).toEqual([
      "name",
      "scope",
      "trigger",
      "executor",
    ])
    expect(tools.find((tool) => tool.name === "app_automation_item_update")?.inputSchema.required).toEqual([
      "automationId",
      "patch",
    ])
    expect(tools.find((tool) => tool.name === "app_automation_run_disable")?.inputSchema.required).toEqual(["runId"])
    expect(tools.find((tool) => tool.name === "app_automation_run_disable")?.description).toContain("stopRequested")
  })
})
