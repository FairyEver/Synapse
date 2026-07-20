import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { buildWorkflowTools } from "../../../synapse-capabilities/shared/workflow-domain"
import type { McpToolDefinition } from "../../../synapse-capabilities/shared/types"

function toolByName(name: string): McpToolDefinition {
  const tool = buildWorkflowTools().find((item) => item.name === name)
  if (!tool) throw new Error(`Missing workflow MCP tool: ${name}`)
  return tool
}

function objectProperty(source: unknown, key: string): Record<string, unknown> {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`Expected object before reading ${key}`)
  }
  const value = (source as Record<string, unknown>)[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object property ${key}`)
  }
  return value as Record<string, unknown>
}

function stringProperty(source: unknown, key: string): string {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`Expected object before reading ${key}`)
  }
  const value = (source as Record<string, unknown>)[key]
  if (typeof value !== "string") throw new Error(`Expected string property ${key}`)
  return value
}

describe("workflow MCP tool definitions", () => {
  it("keeps the built-in workflow MCP API reference aligned with the end node schema", async () => {
    const reference = await readFile(
      path.join(
        process.cwd(),
        "app-capabilities",
        "synapse-skill",
        "skill-package",
        "workflow",
        "api-reference.md",
      ),
      "utf8",
    )

    expect(reference).not.toContain("outputTemplate")
    expect(reference).toContain("`outputType`")
    expect(reference).toContain("`template`")
  })

  it("teaches agents that workflow_call, codex, and claude_code are supported node types", () => {
    const listDescription = toolByName("app_workflow_node_type_list").description
    expect(listDescription).toContain("workflow_call")
    expect(listDescription).toContain('"app_workflow_call" is not a valid node type')
    expect(listDescription).toContain("script variables are injected as environment variables")
    expect(listDescription).toContain("codex")
    expect(listDescription).toContain("claude_code")

    const describeProperties = toolByName("app_workflow_node_type_describe").inputSchema.properties
    const describeNodeType = objectProperty(describeProperties, "nodeType")
    expect(stringProperty(describeNodeType, "description")).toContain("workflow_call")
    expect(stringProperty(describeNodeType, "description")).toContain("codex")
    expect(stringProperty(describeNodeType, "description")).toContain("claude_code")

    const createProperties = toolByName("app_workflow_node_create").inputSchema.properties
    const nodeSchema = objectProperty(createProperties, "node")
    const nodeProperties = objectProperty(nodeSchema, "properties")
    const typeSchema = objectProperty(nodeProperties, "type")
    expect(stringProperty(typeSchema, "description")).toContain("workflow_call")
    expect(stringProperty(typeSchema, "description")).toContain("codex")
    expect(stringProperty(typeSchema, "description")).toContain("claude_code")
  })

  it("teaches agents that app-provided Workflow node types are supported", () => {
    const listDescription = toolByName("app_workflow_node_type_list").description
    expect(listDescription).toContain("document_template_docx_generate")

    const describeProperties = toolByName("app_workflow_node_type_describe").inputSchema.properties
    const describeNodeType = objectProperty(describeProperties, "nodeType")
    expect(stringProperty(describeNodeType, "description")).toContain("document_template_docx_generate")

    const createProperties = toolByName("app_workflow_node_create").inputSchema.properties
    const nodeSchema = objectProperty(createProperties, "node")
    const nodeProperties = objectProperty(nodeSchema, "properties")
    const typeSchema = objectProperty(nodeProperties, "type")
    expect(stringProperty(typeSchema, "description")).toContain("document_template_docx_generate")
  })

  it("documents workflow_call, codex, and claude_code config fields in the full definition schema", () => {
    const inspectProperties = toolByName("app_workflow_definition_inspect").inputSchema.properties
    const definitionSchema = objectProperty(inspectProperties, "definition")
    const definitionProperties = objectProperty(definitionSchema, "properties")
    const nodesSchema = objectProperty(definitionProperties, "nodes")
    const nodeItems = objectProperty(nodesSchema, "items")
    const nodeProperties = objectProperty(nodeItems, "properties")
    const configSchema = objectProperty(nodeProperties, "config")
    const configDescription = stringProperty(configSchema, "description")

    expect(configDescription).toContain("workflow_call")
    expect(configDescription).toContain("not app_workflow_call")
    expect(configDescription).toContain("workflowId")
    expect(configDescription).toContain("paramTemplates")
    expect(configDescription).toContain("environment variables")
    expect(configDescription).toContain("codex")
    expect(configDescription).toContain("approvalPolicy")
    expect(configDescription).toContain("configOverrides")
    expect(configDescription).toContain("claude_code")
    expect(configDescription).toContain("permissionMode")
    expect(configDescription).toContain("settingSources")

    const configProperties = objectProperty(configSchema, "properties")
    expect(stringProperty(objectProperty(configProperties, "paramTemplates"), "description")).toContain("multi-select resource params cannot use templates")
    expect(stringProperty(objectProperty(configProperties, "paramBindings"), "description")).toContain("node_output")
    expect(stringProperty(objectProperty(configProperties, "paramBindings"), "description")).toContain("same resource kind and allowMultiple")
    expect(configProperties).toHaveProperty("enableSearch")
    expect(configProperties).toHaveProperty("features")
    expect(configProperties).toHaveProperty("skipGitRepoCheck")
    expect(configProperties).toHaveProperty("strictConfig")
    expect(configProperties).toHaveProperty("bypassApprovalsAndSandbox")
    expect(configProperties).toHaveProperty("bypassHookTrust")
    expect(configProperties).toHaveProperty("additionalWritableDirs")
    expect(configProperties).toHaveProperty("images")
    expect(configProperties).toHaveProperty("captureDebugArtifacts")
    expect(configProperties).toHaveProperty("permissionMode")
    expect(configProperties).toHaveProperty("additionalDirectories")
    expect(configProperties).toHaveProperty("settingSources")
  })

  it("documents app-provided node config fields in the full definition schema", () => {
    const inspectProperties = toolByName("app_workflow_definition_inspect").inputSchema.properties
    const definitionSchema = objectProperty(inspectProperties, "definition")
    const definitionProperties = objectProperty(definitionSchema, "properties")
    const nodesSchema = objectProperty(definitionProperties, "nodes")
    const nodeItems = objectProperty(nodesSchema, "items")
    const nodeProperties = objectProperty(nodeItems, "properties")
    const configSchema = objectProperty(nodeProperties, "config")
    const configDescription = stringProperty(configSchema, "description")
    const configProperties = objectProperty(configSchema, "properties")

    expect(configDescription).toContain("document_template_docx_generate")
    for (const property of [
      "templatePath",
      "outputPath",
      "dataSource",
      "dataPath",
      "dataJson",
      "overwrite",
      "variables",
    ]) {
      expect(configProperties).toHaveProperty(property)
    }
  })

  it("documents atomic edge creation fields on app_workflow_node_create", () => {
    const createProperties = toolByName("app_workflow_node_create").inputSchema.properties
    const nodeSchema = objectProperty(createProperties, "node")
    const nodeRequired = nodeSchema.required

    expect(Array.isArray(nodeRequired) ? nodeRequired : []).toContain("config")
    expect(stringProperty(objectProperty(objectProperty(nodeSchema, "properties"), "config"), "description"))
      .toContain("required")
    expect(createProperties).toHaveProperty("incomingEdges")
    expect(createProperties).toHaveProperty("outgoingEdges")

    const incomingEdges = objectProperty(createProperties, "incomingEdges")
    const outgoingEdges = objectProperty(createProperties, "outgoingEdges")
    expect(stringProperty(incomingEdges, "description")).toContain("same validated mutation")
    expect(stringProperty(outgoingEdges, "description")).toContain("same validated mutation")
  })

  it("documents safe workflow node id constraints", () => {
    const inspectProperties = toolByName("app_workflow_definition_inspect").inputSchema.properties
    const definitionSchema = objectProperty(inspectProperties, "definition")
    const definitionProperties = objectProperty(definitionSchema, "properties")
    const nodesSchema = objectProperty(definitionProperties, "nodes")
    const nodeItems = objectProperty(nodesSchema, "items")
    const nodeProperties = objectProperty(nodeItems, "properties")
    const nodeIdSchema = objectProperty(nodeProperties, "id")

    expect(stringProperty(nodeIdSchema, "pattern")).toBe("^[A-Za-z0-9_-]+$")
    expect(stringProperty(nodeIdSchema, "description")).toContain("underscore")

    const updateProperties = toolByName("app_workflow_node_update").inputSchema.properties
    const updateNodeIdSchema = objectProperty(updateProperties, "nodeId")
    expect(stringProperty(updateNodeIdSchema, "pattern")).toBe("^[A-Za-z0-9_-]+$")
  })
})
