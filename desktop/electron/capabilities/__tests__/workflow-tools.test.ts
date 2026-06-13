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
  it("teaches agents that workflow_call and codex are supported node types", () => {
    expect(toolByName("workflow_node_type_list").description).toContain("workflow_call")
    expect(toolByName("workflow_node_type_list").description).toContain("codex")

    const describeProperties = toolByName("workflow_node_type_describe").inputSchema.properties
    const describeNodeType = objectProperty(describeProperties, "nodeType")
    expect(stringProperty(describeNodeType, "description")).toContain("workflow_call")
    expect(stringProperty(describeNodeType, "description")).toContain("codex")

    const createProperties = toolByName("workflow_node_create").inputSchema.properties
    const nodeSchema = objectProperty(createProperties, "node")
    const nodeProperties = objectProperty(nodeSchema, "properties")
    const typeSchema = objectProperty(nodeProperties, "type")
    expect(stringProperty(typeSchema, "description")).toContain("workflow_call")
    expect(stringProperty(typeSchema, "description")).toContain("codex")
  })

  it("documents workflow_call and codex config fields in the full definition schema", () => {
    const inspectProperties = toolByName("workflow_definition_inspect").inputSchema.properties
    const definitionSchema = objectProperty(inspectProperties, "definition")
    const definitionProperties = objectProperty(definitionSchema, "properties")
    const nodesSchema = objectProperty(definitionProperties, "nodes")
    const nodeItems = objectProperty(nodesSchema, "items")
    const nodeProperties = objectProperty(nodeItems, "properties")
    const configSchema = objectProperty(nodeProperties, "config")
    const configDescription = stringProperty(configSchema, "description")

    expect(configDescription).toContain("workflow_call")
    expect(configDescription).toContain("workflowId")
    expect(configDescription).toContain("paramTemplates")
    expect(configDescription).toContain("codex")
    expect(configDescription).toContain("approvalPolicy")
    expect(configDescription).toContain("configOverrides")
  })

  it("documents atomic edge creation fields on workflow_node_create", () => {
    const createProperties = toolByName("workflow_node_create").inputSchema.properties
    expect(createProperties).toHaveProperty("incomingEdges")
    expect(createProperties).toHaveProperty("outgoingEdges")

    const incomingEdges = objectProperty(createProperties, "incomingEdges")
    const outgoingEdges = objectProperty(createProperties, "outgoingEdges")
    expect(stringProperty(incomingEdges, "description")).toContain("same validated mutation")
    expect(stringProperty(outgoingEdges, "description")).toContain("same validated mutation")
  })

  it("documents safe workflow node id constraints", () => {
    const inspectProperties = toolByName("workflow_definition_inspect").inputSchema.properties
    const definitionSchema = objectProperty(inspectProperties, "definition")
    const definitionProperties = objectProperty(definitionSchema, "properties")
    const nodesSchema = objectProperty(definitionProperties, "nodes")
    const nodeItems = objectProperty(nodesSchema, "items")
    const nodeProperties = objectProperty(nodeItems, "properties")
    const nodeIdSchema = objectProperty(nodeProperties, "id")

    expect(stringProperty(nodeIdSchema, "pattern")).toBe("^[A-Za-z0-9_-]+$")
    expect(stringProperty(nodeIdSchema, "description")).toContain("underscore")

    const updateProperties = toolByName("workflow_node_update").inputSchema.properties
    const updateNodeIdSchema = objectProperty(updateProperties, "nodeId")
    expect(stringProperty(updateNodeIdSchema, "pattern")).toBe("^[A-Za-z0-9_-]+$")
  })
})
