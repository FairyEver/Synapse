import { describe, expect, it, vi } from "vitest"

import {
  buildSynapseToolCatalog,
  createSynapseToolRouterServer,
  invokeSynapseTool,
  isSynapseToolReadOnly,
  parseSynapseToolRouterInvoke,
  searchSynapseTools,
} from "../synapse-tool-router"
import { buildAllMcpTools } from "../../../../synapse-capabilities/shared/registry"

describe("Synapse tool router catalog", () => {
  it("indexes every public Synapse MCP tool with action, domain, description, and schema", () => {
    const catalog = buildSynapseToolCatalog()

    expect(catalog).toHaveLength(223)
    expect(new Set(catalog.map((entry) => entry.name)).size).toBe(223)
    expect(catalog.every((entry) => (
      entry.actionId.length > 0
      && entry.domain.length > 0
      && entry.description.length > 0
      && entry.inputSchema.type === "object"
    ))).toBe(true)
  })

  it("prioritizes exact names and returns complete input schemas", async () => {
    const result = await searchSynapseTools({ query: "app_database_table_list", limit: 1 })

    expect(result.tools).toEqual([
      expect.objectContaining({
        name: "app_database_table_list",
        domain: "database",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
    ])
  })

  it("searches Chinese domain aliases and schema fields with stable limits", async () => {
    const chinese = await searchSynapseTools({ query: "数据库表", domain: "database", limit: 3 })
    const schema = await searchSynapseTools({ query: "tableName", domain: "database", limit: 5 })

    expect(chinese.tools).toHaveLength(3)
    expect(chinese.tools.every((tool) => tool.domain === "database")).toBe(true)
    expect(schema.tools.some((tool) => JSON.stringify(tool.inputSchema).includes("tableName"))).toBe(true)
    await expect(searchSynapseTools({ query: "数据库表", domain: "database", limit: 3 })).resolves.toEqual(chinese)
  })

  it("prioritizes the general Drive item listing for a natural-language file list query", async () => {
    const english = await searchSynapseTools({ query: "list files drive", domain: "drive", limit: 3 })
    const chinese = await searchSynapseTools({ query: "查看云盘文件列表", limit: 3 })

    expect(english.tools.map((tool) => tool.name)).toEqual([
      "app_drive_item_list",
      expect.any(String),
      expect.any(String),
    ])
    expect(chinese.tools.map((tool) => tool.name)).toEqual([
      "app_drive_item_list",
      expect.any(String),
      expect.any(String),
    ])
  })

  it("returns no tools and lists domains when no reliable match exists", async () => {
    const result = await searchSynapseTools({ query: "zzzz-no-synapse-tool-匹配-999999" })

    expect(result.tools).toEqual([])
    expect(result.domains).toContain("database")
    expect(result.domains).toContain("drive")
  })

  it("validates query and limit", async () => {
    await expect(searchSynapseTools({ query: " " })).rejects.toThrow("query must not be empty")
    await expect(searchSynapseTools({ query: "table", limit: 6 })).rejects.toThrow("limit must be an integer from 1 to 5")
  })

  it("reduces the initial Synapse tool definition payload by at least 90 percent", async () => {
    const sdk = await import("@anthropic-ai/claude-agent-sdk")
    const server = createSynapseToolRouterServer(sdk, vi.fn())
    const registeredTools = (server.instance as unknown as {
      readonly _registeredTools: Record<string, unknown>
    })._registeredTools
    const fullBytes = Buffer.byteLength(JSON.stringify(buildAllMcpTools()))
    const routerBytes = Buffer.byteLength(JSON.stringify(registeredTools))

    expect(Object.keys(registeredTools)).toEqual(["search", "invoke"])
    expect(routerBytes).toBeLessThanOrEqual(fullBytes * 0.1)
  })
})

describe("Synapse tool router invocation", () => {
  it("rejects unknown names without calling the executor", async () => {
    const execute = vi.fn()

    const result = await invokeSynapseTool({ toolName: "missing_tool" }, execute)

    expect(result.isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it("passes arguments and cancellation through the shared MCP result normalization", async () => {
    const controller = new AbortController()
    const execute = vi.fn(async () => ({ ok: true, data: [{ name: "projects" }] }))

    const result = await invokeSynapseTool({
      toolName: "app_database_table_list",
      arguments: { includeSystem: false },
    }, execute, controller.signal)

    expect(execute).toHaveBeenCalledWith(
      "app_database_table_list",
      { includeSystem: false },
      controller.signal,
    )
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual([{ name: "projects" }])
  })

  it("parses only exact registered invoke envelopes and exposes mutability", () => {
    expect(parseSynapseToolRouterInvoke({
      toolName: "app_database_table_list",
      arguments: {},
    })).toEqual({ toolName: "app_database_table_list", arguments: {} })
    expect(parseSynapseToolRouterInvoke({ toolName: "missing" })).toBeNull()
    expect(isSynapseToolReadOnly("app_database_table_list")).toBe(true)
  })
})
