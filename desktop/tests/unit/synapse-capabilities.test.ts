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
  APP_DOMAIN,
  APP_MCP_TOOL_ACTIONS,
  buildAppTools,
} from "../../synapse-capabilities/shared/app-domain"
import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
} from "../../synapse-capabilities/shared/registry"
import { isCanonicalCapabilityId } from "../../synapse-capabilities/shared/naming"
import { buildWorkflowTools } from "../../synapse-capabilities/shared/workflow-domain"

describe("Synapse capability domains", () => {
  it("keeps Database capabilities in the Database domain", () => {
    expect(DATABASE_DOMAIN.id).toBe("database")
    expect(DATABASE_DOMAIN.capabilities.map((capability) => capability.id)).toContain("database.table.list")
  })
})

describe("App capability naming", () => {
  it("accepts generate as a canonical app capability action", () => {
    expect(isCanonicalCapabilityId("app.document_template.docx.generate")).toBe(true)
  })
})

describe("App capability domain", () => {
  it("registers document template docx generation", () => {
    expect(APP_DOMAIN.id).toBe("app")
    expect(APP_DOMAIN.capabilities.map((capability) => capability.id)).toContain("app.document_template.docx.generate")
    expect(APP_MCP_TOOL_ACTIONS.app_document_template_docx_generate).toBe("app.document_template.docx.generate")
    expect(buildAppTools().map((tool) => tool.name)).toEqual(["app_document_template_docx_generate"])
  })
})

describe("Model price capability domain", () => {
  it("registers model price actions separately from usage analysis internals", () => {
    expect(MODEL_PRICE_DOMAIN.id).toBe("model_price")
    expect(MODEL_PRICE_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "model_price.used_model.list",
      "model_price.preset.list",
      "model_price.preset.import",
      "model_price.rule.list",
      "model_price.rule.get",
      "model_price.rule.create",
      "model_price.rule.update",
      "model_price.rule.clear",
      "model_price.rule.delete",
      "model_price.rule.enable",
      "model_price.rule.disable",
    ])
  })

  it("maps model price MCP tools to canonical actions", () => {
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_used_model_list).toBe("model_price.used_model.list")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_preset_import).toBe("model_price.preset.import")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_update).toBe("model_price.rule.update")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_clear).toBe("model_price.rule.clear")
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
    const tools = buildRepositoryTools()
    expect(tools.map((tool) => tool.name)).toEqual(["repository_item_list"])
    expect(tools[0]?.description).toContain("uuid, name, local path, and active state")
    expect(tools[0]?.description).not.toContain("variable count")
  })
})

describe("Variable capability domain", () => {
  it("registers user-scoped variable CRUD actions", () => {
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
    expect(listTool?.inputSchema.properties).not.toHaveProperty("repositoryUuid")
    expect(listTool?.description).not.toContain("repository")
  })

  it("does not expose repositoryUuid on variable tools", () => {
    for (const tool of buildVariableTools()) {
      expect(tool.inputSchema.properties).not.toHaveProperty("repositoryUuid")
    }
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

  it("keeps Skill create and update schemas compatible with strict MCP clients", () => {
    const tools = buildContentTools()
    const create = tools.find((tool) => tool.name === "content_skill_create")
    const update = tools.find((tool) => tool.name === "content_skill_update")

    expect(create?.inputSchema.required).toBeUndefined()
    expect(create?.inputSchema).not.toHaveProperty("anyOf")
    expect(create?.inputSchema).not.toHaveProperty("oneOf")
    expect(create?.inputSchema).not.toHaveProperty("allOf")
    expect(create?.description).toContain("inline")
    expect(create?.description).toContain("name/title/description/category/content")
    expect(create?.description).toContain("sourceDirectoryPath")
    expect(create?.description).toContain("files and sourceDirectoryPath are mutually exclusive")
    expect(update?.inputSchema.required).toEqual(["id", "baseHistoryDirname"])
    expect(update?.inputSchema).not.toHaveProperty("anyOf")
    expect(update?.inputSchema).not.toHaveProperty("oneOf")
    expect(update?.inputSchema).not.toHaveProperty("allOf")
    expect(update?.description).toContain("content_skill_get")
    expect(update?.description).toContain("current icon/image appearance is preserved")
    expect(update?.description).toContain("name/title/description/category/content")
    expect(update?.description).toContain("sourceDirectoryPath")
    expect(update?.description).toContain("files and sourceDirectoryPath are mutually exclusive")
  })
})
