import { describe, expect, it } from "vitest"

import { DATABASE_DOMAIN } from "../../database/shared/capability-registry"
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "../../synapse-capabilities/shared/scheduler-domain"
import {
  CONTENT_DOMAIN,
  CONTENT_MCP_TOOL_ACTIONS,
  buildContentTools,
} from "../../synapse-capabilities/shared/content-domain"
import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
} from "../../synapse-capabilities/shared/registry"
import { buildWorkflowTools } from "../../synapse-capabilities/shared/workflow-domain"

describe("Synapse capability domains", () => {
  it("keeps Database capabilities in the Database domain", () => {
    expect(DATABASE_DOMAIN.id).toBe("database")
    expect(DATABASE_DOMAIN.capabilities.map((capability) => capability.id)).toContain("database.table.list")
    expect(DATABASE_DOMAIN.capabilities.some((capability) => capability.id.startsWith("scheduler."))).toBe(false)
  })
})

describe("Scheduler capability domain", () => {
  it("registers Scheduler actions separately from Database", () => {
    expect(SCHEDULER_DOMAIN.id).toBe("scheduler")
    expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "scheduler.task.list",
      "scheduler.task.get",
      "scheduler.task.create",
      "scheduler.task.enable",
      "scheduler.task.disable",
      "scheduler.run.list",
      "scheduler.runtime.inspect",
      "scheduler.action_type.list",
      "scheduler.task.update",
    ])
  })

  it("registers second-phase Scheduler external capabilities", () => {
    expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "scheduler.task.list",
      "scheduler.task.get",
      "scheduler.task.create",
      "scheduler.task.enable",
      "scheduler.task.disable",
      "scheduler.run.list",
      "scheduler.runtime.inspect",
      "scheduler.action_type.list",
      "scheduler.task.update",
    ])
    expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_run_list).toBe("scheduler.run.list")
    expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_runtime_inspect).toBe("scheduler.runtime.inspect")
    expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_action_type_list).toBe("scheduler.action_type.list")
    expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_task_update).toBe("scheduler.task.update")
  })

  it("does not expose destructive or execution-control Scheduler capabilities", () => {
    const actions = SCHEDULER_DOMAIN.capabilities.map((capability) => capability.id)
    const tools = buildSchedulerTools().map((tool) => tool.name)
    expect(actions).not.toContain("scheduler.task.delete")
    expect(actions).not.toContain("scheduler.task.run_now")
    expect(actions).not.toContain("scheduler.run.stop")
    expect(tools).not.toContain("scheduler_task_delete")
    expect(tools).not.toContain("scheduler_task_run_now")
    expect(tools).not.toContain("scheduler_run_stop")
  })

  it("combines Database and Scheduler MCP tools with canonical names", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("database_table_list")
    expect(toolNames).toContain("database_row_list")
    expect(toolNames).toContain("database_log_list")
    expect(toolNames).toContain("scheduler_task_list")
    expect(toolNames).toContain("scheduler_task_create")
    expect(MCP_TOOL_ACTIONS.database_table_list).toBe("database.table.list")
    expect(MCP_TOOL_ACTIONS.scheduler_task_create).toBe("scheduler.task.create")
    expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_task_disable).toBe("scheduler.task.disable")
    expect(getActionDomainId("database.table.list")).toBe("database")
    expect(getActionDomainId("scheduler.task.list")).toBe("scheduler")
  })

  it("defines Scheduler MCP schemas with taskId-only detail lookup", () => {
    const tools = buildSchedulerTools()
    const getTool = tools.find((tool) => tool.name === "scheduler_task_get")
    expect(getTool?.inputSchema.required).toEqual(["taskId"])
    expect(Object.keys(getTool?.inputSchema.properties ?? {})).toEqual(["taskId"])
  })
})

describe("Workflow MCP tool schemas", () => {
  function tool(name: string) {
    const found = buildWorkflowTools().find((item) => item.name === name)
    if (!found) throw new Error(`Missing workflow tool ${name}`)
    return found
  }

  it("exposes workflow-level default project, provider, model tier, and timeout fields", () => {
    const createProperties = tool("workflow_definition_create").inputSchema.properties
    expect(createProperties).toHaveProperty("defaultProjectId")
    expect(createProperties).toHaveProperty("defaultProviderId")
    expect(createProperties).toHaveProperty("defaultModelTier")
    expect(createProperties).toHaveProperty("defaultNodeTimeoutMins")

    const updateDefinition = tool("workflow_definition_update").inputSchema.properties.definition as {
      properties?: Record<string, unknown>
    }
    expect(updateDefinition.properties).toHaveProperty("defaultProjectId")
    expect(updateDefinition.properties).toHaveProperty("defaultProviderId")
    expect(updateDefinition.properties).toHaveProperty("defaultModelTier")
    expect(updateDefinition.properties).toHaveProperty("defaultNodeTimeoutMins")
  })

  it("documents executable workflow errors with node and timeout diagnostics", () => {
    expect(tool("workflow_definition_inspect").description).toContain("field")
    expect(tool("workflow_definition_inspect").description).toContain("nodeName")
    expect(tool("workflow_run_get").description).toContain("durationMs")
    expect(tool("workflow_run_get").description).toContain("timeoutMs")
    expect(tool("workflow_run_get").description).toContain("retryable")
  })
})

describe("Content capability domain", () => {
  it("registers content actions separately from other domains", () => {
    expect(CONTENT_DOMAIN.id).toBe("content")
    expect(CONTENT_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "content.type.describe",
      "content.rule.list",
      "content.rule.get",
      "content.rule.create",
      "content.rule.update",
      "content.rule.delete",
      "content.skill.list",
      "content.skill.get",
      "content.skill.create",
      "content.skill.update",
      "content.skill.delete",
      "content.prompt.list",
      "content.prompt.get",
      "content.prompt.create",
      "content.prompt.update",
      "content.prompt.delete",
    ])
  })

  it("maps content MCP tool names to canonical actions", () => {
    expect(CONTENT_MCP_TOOL_ACTIONS.content_type_describe).toBe("content.type.describe")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_rule_create).toBe("content.rule.create")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_skill_update).toBe("content.skill.update")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_prompt_delete).toBe("content.prompt.delete")
  })

  it("combines content tools with all MCP tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("content_type_describe")
    expect(toolNames).toContain("content_rule_create")
    expect(toolNames).toContain("content_skill_create")
    expect(toolNames).toContain("content_prompt_create")
    expect(MCP_TOOL_ACTIONS.content_skill_delete).toBe("content.skill.delete")
    expect(getActionDomainId("content.prompt.update")).toBe("content")
  })

  it("documents list/get/create/update/delete tool schemas for each content type", () => {
    const tools = buildContentTools()
    for (const type of ["rule", "skill", "prompt"] as const) {
      expect(tools.find((tool) => tool.name === `content_${type}_list`)).toBeDefined()
      expect(tools.find((tool) => tool.name === `content_${type}_get`)?.inputSchema.required).toEqual(["id"])
      expect(tools.find((tool) => tool.name === `content_${type}_create`)).toBeDefined()
      expect(tools.find((tool) => tool.name === `content_${type}_update`)?.inputSchema.required).toContain("baseHistoryDirname")
      expect(tools.find((tool) => tool.name === `content_${type}_delete`)?.inputSchema.required).toEqual(["id", "baseHistoryDirname"])
    }
  })

  it("allows Skill create and update schemas to use sourceDirectoryPath instead of inline fields", () => {
    const tools = buildContentTools()
    const create = tools.find((tool) => tool.name === "content_skill_create")
    const update = tools.find((tool) => tool.name === "content_skill_update")

    expect(create?.inputSchema.required).toBeUndefined()
    expect(create?.inputSchema.anyOf).toEqual([
      { required: ["name", "title", "description", "category", "content"] },
      { required: ["sourceDirectoryPath"] },
    ])
    expect(update?.inputSchema.required).toEqual(["id", "baseHistoryDirname"])
    expect(update?.inputSchema.anyOf).toEqual(create?.inputSchema.anyOf)
  })
})
