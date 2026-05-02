import { describe, expect, it } from "vitest"

import { DATA_STORE_DOMAIN } from "../../data-store/shared/capability-registry"
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "../../synapse-capabilities/shared/scheduler-domain"
import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
} from "../../synapse-capabilities/shared/registry"

describe("Synapse capability domains", () => {
  it("keeps Data Store capabilities in the Data Store domain", () => {
    expect(DATA_STORE_DOMAIN.id).toBe("data-store")
    expect(DATA_STORE_DOMAIN.capabilities.map((capability) => capability.action)).toContain("listTables")
    expect(DATA_STORE_DOMAIN.capabilities.map((capability) => capability.mcpTool)).toContain("list_tables")
    expect(DATA_STORE_DOMAIN.capabilities.some((capability) => capability.action.startsWith("scheduler"))).toBe(false)
  })
})

describe("Scheduler capability domain", () => {
  it("registers Scheduler actions separately from Data Store", () => {
    expect(SCHEDULER_DOMAIN.id).toBe("scheduler")
    expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.action)).toEqual([
      "schedulerTaskList",
      "schedulerTaskGet",
      "schedulerTaskCreate",
      "schedulerTaskEnable",
      "schedulerTaskDisable",
    ])
    expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.mcpTool)).toEqual([
      "scheduler_task_list",
      "scheduler_task_get",
      "scheduler_task_create",
      "scheduler_task_enable",
      "scheduler_task_disable",
    ])
  })

  it("combines Data Store and Scheduler MCP tools without renaming Data Store tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("list_tables")
    expect(toolNames).toContain("query")
    expect(toolNames).toContain("operation_log")
    expect(toolNames).toContain("scheduler_task_list")
    expect(toolNames).toContain("scheduler_task_create")
    expect(MCP_TOOL_ACTIONS.scheduler_task_create).toBe("schedulerTaskCreate")
    expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_task_disable).toBe("schedulerTaskDisable")
    expect(getActionDomainId("listTables")).toBe("data-store")
    expect(getActionDomainId("schedulerTaskList")).toBe("scheduler")
  })

  it("defines Scheduler MCP schemas with taskId-only detail lookup", () => {
    const tools = buildSchedulerTools()
    const getTool = tools.find((tool) => tool.name === "scheduler_task_get")
    expect(getTool?.inputSchema.required).toEqual(["taskId"])
    expect(Object.keys(getTool?.inputSchema.properties ?? {})).toEqual(["taskId"])
  })
})
