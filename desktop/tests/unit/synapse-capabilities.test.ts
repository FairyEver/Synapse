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
import { TERMINAL_MCP_TOOL_NAMES } from "../../app-capabilities/terminal/shared/capability"
import {
  SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
  SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
} from "../../app-capabilities/screenshot/shared/capability"
import { SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME } from "../../app-capabilities/sound-notifier/shared/capability"
import { SWARM_TASK_MCP_TOOL_NAMES } from "../../app-capabilities/swarm-task/shared/capability"
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
    expect(DATABASE_DOMAIN.capabilities.map((capability) => capability.id)).toContain("app.database.table.list")
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
    expect(buildAppTools().map((tool) => tool.name)).toEqual([
      "app_document_template_docx_generate",
      ...Object.values(TERMINAL_MCP_TOOL_NAMES),
      SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
      SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
      SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME,
      ...Object.values(SWARM_TASK_MCP_TOOL_NAMES),
    ])
    expect(APP_MCP_TOOL_ACTIONS.app_terminal_session_resize).toBe("app.terminal.session.resize")
    expect(APP_MCP_TOOL_ACTIONS.app_terminal_group_rename).toBe("app.terminal.group.rename")
    expect(APP_MCP_TOOL_ACTIONS.app_terminal_group_updateSettings).toBe("app.terminal.group.updateSettings")
    expect(APP_MCP_TOOL_ACTIONS.app_terminal_group_delete).toBe("app.terminal.group.delete")
  })
})

describe("Model price capability domain", () => {
  it("registers model price actions separately from usage analysis internals", () => {
    expect(MODEL_PRICE_DOMAIN.id).toBe("model_price")
    expect(MODEL_PRICE_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "app.model_price.used_model.list",
      "app.model_price.preset.list",
      "app.model_price.preset.import",
      "app.model_price.rule.list",
      "app.model_price.rule.get",
      "app.model_price.rule.create",
      "app.model_price.rule.update",
      "app.model_price.rule.clear",
      "app.model_price.rule.delete",
      "app.model_price.rule.enable",
      "app.model_price.rule.disable",
    ])
  })

  it("maps model price MCP tools to canonical actions", () => {
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_used_model_list).toBe("app.model_price.used_model.list")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_preset_import).toBe("app.model_price.preset.import")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_update).toBe("app.model_price.rule.update")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_clear).toBe("app.model_price.rule.clear")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.model_price_rule_disable).toBe("app.model_price.rule.disable")
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
    expect(MCP_TOOL_ACTIONS.model_price_rule_enable).toBe("app.model_price.rule.enable")
    expect(getActionDomainId("app.model_price.rule.list")).toBe("model_price")
  })
})

describe("Repository capability domain", () => {
  it("registers read-only repository discovery", () => {
    expect(REPOSITORY_DOMAIN.id).toBe("repository")
    expect(REPOSITORY_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "app.settings.repository.item.list",
    ])
    expect(REPOSITORY_DOMAIN.capabilities.every((capability) => capability.mutates === false)).toBe(true)
  })

  it("maps repository MCP tools to canonical actions", () => {
    expect(REPOSITORY_MCP_TOOL_ACTIONS.app_settings_repository_item_list).toBe("app.settings.repository.item.list")
    expect(REPOSITORY_MCP_TOOL_ACTIONS.repository_item_list).toBe("app.settings.repository.item.list")
    const tools = buildRepositoryTools()
    expect(tools.map((tool) => tool.name)).toEqual([
      "app_settings_repository_item_list",
      "repository_item_list",
    ])
    const legacyTool = tools.find((tool) => tool.name === "repository_item_list")
    expect(legacyTool?.description).toContain("uuid, name, local path, and active state")
    expect(legacyTool?.description).not.toContain("variable count")
  })
})

describe("Variable capability domain", () => {
  it("registers user-scoped variable CRUD actions", () => {
    expect(VARIABLE_DOMAIN.id).toBe("variable")
    expect(VARIABLE_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "app.settings.variable.item.list",
      "app.settings.variable.item.get",
      "app.settings.variable.item.create",
      "app.settings.variable.item.update",
      "app.settings.variable.item.upsert",
      "app.settings.variable.item.delete",
    ])
  })

  it("maps variable MCP tools to canonical actions", () => {
    expect(VARIABLE_MCP_TOOL_ACTIONS.app_settings_variable_item_list).toBe("app.settings.variable.item.list")
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_list).toBe("app.settings.variable.item.list")
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_get).toBe("app.settings.variable.item.get")
    expect(VARIABLE_MCP_TOOL_ACTIONS.variable_item_upsert).toBe("app.settings.variable.item.upsert")
    expect(buildVariableTools().map((tool) => tool.name)).toEqual([
      "app_settings_variable_item_list",
      "app_settings_variable_item_get",
      "app_settings_variable_item_create",
      "app_settings_variable_item_update",
      "app_settings_variable_item_upsert",
      "app_settings_variable_item_delete",
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
    expect(MCP_TOOL_ACTIONS.repository_item_list).toBe("app.settings.repository.item.list")
    expect(MCP_TOOL_ACTIONS.variable_item_delete).toBe("app.settings.variable.item.delete")
    expect(getActionDomainId("app.settings.repository.item.list")).toBe("repository")
    expect(getActionDomainId("app.settings.variable.item.upsert")).toBe("variable")
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
      "app.resource_repository.type.describe",
      "app.resource_repository.rule.list",
      "app.resource_repository.rule.get",
      "app.resource_repository.rule.create",
      "app.resource_repository.rule.update",
      "app.resource_repository.rule.delete",
      "app.resource_repository.skill.list",
      "app.resource_repository.skill.get",
      "app.resource_repository.skill.create",
      "app.resource_repository.skill.update",
      "app.resource_repository.skill.delete",
      "app.resource_repository.prompt.list",
      "app.resource_repository.prompt.get",
      "app.resource_repository.prompt.create",
      "app.resource_repository.prompt.update",
      "app.resource_repository.prompt.delete",
    ])
  })

  it("maps content MCP tool names to canonical actions", () => {
    expect(CONTENT_MCP_TOOL_ACTIONS.content_type_describe).toBe("app.resource_repository.type.describe")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_rule_create).toBe("app.resource_repository.rule.create")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_skill_update).toBe("app.resource_repository.skill.update")
    expect(CONTENT_MCP_TOOL_ACTIONS.content_prompt_delete).toBe("app.resource_repository.prompt.delete")
  })

  it("combines content tools with all MCP tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("content_type_describe")
    expect(toolNames).toContain("content_rule_create")
    expect(toolNames).toContain("content_skill_create")
    expect(toolNames).toContain("content_prompt_create")
    expect(MCP_TOOL_ACTIONS.content_skill_delete).toBe("app.resource_repository.skill.delete")
    expect(getActionDomainId("app.resource_repository.prompt.update")).toBe("content")
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
    expect(update?.description).toContain("app_resource_repository_skill_get")
    expect(update?.description).toContain("current icon/image appearance is preserved")
    expect(update?.description).toContain("name/title/description/category/content")
    expect(update?.description).toContain("sourceDirectoryPath")
    expect(update?.description).toContain("files and sourceDirectoryPath are mutually exclusive")
  })
})
