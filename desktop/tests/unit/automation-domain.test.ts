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
      "automation.item.list",
      "automation.item.get",
      "automation.item.create",
      "automation.item.update",
      "automation.item.delete",
      "automation.item.enable",
      "automation.item.disable",
      "automation.run.execute",
      "automation.run.disable",
      "automation.run.list",
      "automation.runtime.inspect",
      "automation.trigger_type.list",
      "automation.executor_type.list",
    ])
  })

  it("maps Automation MCP tool names to canonical actions", () => {
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_item_list).toBe("automation.item.list")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_item_create).toBe("automation.item.create")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_run_execute).toBe("automation.run.execute")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_trigger_type_list).toBe("automation.trigger_type.list")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_executor_type_list).toBe("automation.executor_type.list")
  })

  it("registers Automation tools with the global MCP registry", () => {
    expect(CAPABILITY_DOMAINS.map((domain) => domain.id)).toContain("automation")
    expect(MCP_TOOL_ACTIONS.automation_item_delete).toBe("automation.item.delete")
    expect(MCP_TOOL_ACTIONS.automation_run_disable).toBe("automation.run.disable")
    expect(getActionDomainId("automation.item.list")).toBe("automation")
    expect(getMcpToolDomainId("automation_runtime_inspect")).toBe("automation")

    const tools = buildAllMcpTools()
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "automation_item_list",
      "automation_item_create",
      "automation_item_update",
      "automation_item_delete",
      "automation_run_execute",
      "automation_runtime_inspect",
      "automation_trigger_type_list",
      "automation_executor_type_list",
    ]))
  })

  it("declares required input schema fields for mutating tools", () => {
    const tools = buildAutomationTools()
    expect(tools.find((tool) => tool.name === "automation_item_get")?.inputSchema.required).toEqual(["automationId"])
    expect(tools.find((tool) => tool.name === "automation_item_create")?.inputSchema.required).toEqual([
      "name",
      "scope",
      "trigger",
      "executor",
    ])
    expect(tools.find((tool) => tool.name === "automation_item_update")?.inputSchema.required).toEqual([
      "automationId",
      "patch",
    ])
    expect(tools.find((tool) => tool.name === "automation_run_disable")?.inputSchema.required).toEqual(["runId"])
  })
})
