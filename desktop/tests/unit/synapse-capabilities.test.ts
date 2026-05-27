import { describe, expect, it } from "vitest"

import { DATABASE_DOMAIN } from "../../database/shared/capability-registry"
import {
  MODEL_PRICE_DOMAIN,
  MODEL_PRICE_MCP_TOOL_ACTIONS,
  buildModelPriceTools,
} from "../../synapse-capabilities/shared/model-price-domain"
import {
  REPOSITORY_DOMAIN,
  REPOSITORY_MCP_TOOL_ACTIONS,
  buildRepositoryTools,
} from "../../synapse-capabilities/shared/repository-domain"
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "../../synapse-capabilities/shared/scheduler-domain"
import {
  VARIABLE_DOMAIN,
  VARIABLE_MCP_TOOL_ACTIONS,
  buildVariableTools,
} from "../../synapse-capabilities/shared/variable-domain"
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

describe("Model price capability domain", () => {
  it("registers model price actions separately from usage analysis internals", () => {
    expect(MODEL_PRICE_DOMAIN.id).toBe("model_price")
    expect(MODEL_PRICE_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "model_price.used_model.list",
      "model_price.rule.list",
      "model_price.rule.get",
      "model_price.rule.create",
      "model_price.rule.update",
      "model_price.rule.delete",
      "model_price.rule.enable",
      "model_price.rule.disable",
    ])
  })

  it("maps model price MCP tools to canonical actions", () => {
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_used_model_list).toBe("model_price.used_model.list")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_update).toBe("model_price.rule.update")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_disable).toBe("model_price.rule.disable")
  })

  it("defines model price MCP schemas with ruleId-based mutations", () => {
    const tools = buildModelPriceTools()
    expect(tools.find((tool) => tool.name === "model_price_rule_get")?.inputSchema.required).toEqual(["ruleId"])
    expect(tools.find((tool) => tool.name === "model_price_rule_update")?.inputSchema.required).toEqual(["ruleId"])
    expect(tools.find((tool) => tool.name === "model_price_rule_delete")?.inputSchema.required).toEqual(["ruleId"])
    expect(tools.find((tool) => tool.name === "model_price_rule_update")?.inputSchema.properties).not.toHaveProperty("enabled")
  })

  it("combines model price tools with all MCP tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("model_price_used_model_list")
    expect(toolNames).toContain("model_price_rule_create")
    expect(toolNames).toContain("model_price_rule_delete")
    expect(MCP_TOOL_ACTIONS.model_price_rule_enable).toBe("model_price.rule.enable")
    expect(getActionDomainId("model_price.rule.list")).toBe("model_price")
  })
})

describe("Repository capability domain", () => {
  it("registers read-only repository discovery", () => {
    expect(REPOSITORY_DOMAIN.id).toBe("repository")
    expect(REPOSITORY_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "repository.item.list",
    ])
    expect(REPOSITORY_DOMAIN.capabilities.every((capability) => capability.mutates === false)).toBe(true)
  })

  it("maps repository MCP tools to canonical actions", () => {
    expect(REPOSITORY_MCP_TOOL_ACTIONS.repository_item_list).toBe("repository.item.list")
    expect(buildRepositoryTools().map((tool) => tool.name)).toEqual(["repository_item_list"])
  })
})

describe("Variable capability domain", () => {
  it("registers repository-scoped variable CRUD actions", () => {
    expect(VARIABLE_DOMAIN.id).toBe("variable")
    expect(VARIABLE_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "variable.item.list",
      "variable.item.get",
      "variable.item.create",
      "variable.item.update",
      "variable.item.upsert",
      "variable.item.delete",
    ])
  })

  it("maps variable MCP tools to canonical actions", () => {
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_list).toBe("variable.item.list")
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_get).toBe("variable.item.get")
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_upsert).toBe("variable.item.upsert")
    expect(buildVariableTools().map((tool) => tool.name)).toEqual([
      "variable_item_list",
      "variable_item_get",
      "variable_item_create",
      "variable_item_update",
      "variable_item_upsert",
      "variable_item_delete",
    ])
  })

  it("keeps variable list from exposing a value field", () => {
    const listTool = buildVariableTools().find((tool) => tool.name === "variable_item_list")
    expect(listTool?.inputSchema.properties).not.toHaveProperty("includeValue")
    expect(listTool?.inputSchema.properties).not.toHaveProperty("value")
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

describe("Repository and Variable combined MCP tools", () => {
  it("combines Repository and Variable tools with all MCP tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("repository_item_list")
    expect(toolNames).toContain("variable_item_list")
    expect(toolNames).toContain("variable_item_upsert")
    expect(MCP_TOOL_ACTIONS.repository_item_list).toBe("repository.item.list")
    expect(MCP_TOOL_ACTIONS.variable_item_delete).toBe("variable.item.delete")
    expect(getActionDomainId("repository.item.list")).toBe("repository")
    expect(getActionDomainId("variable.item.upsert")).toBe("variable")
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
