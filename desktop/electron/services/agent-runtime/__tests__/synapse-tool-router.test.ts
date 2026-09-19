import { describe, expect, it, vi } from "vitest"

import {
  buildSynapseToolCatalog,
  buildSynapseToolRouterTools,
  createSynapseToolRouterServer,
  createSynapseToolRouterSurface,
  invokeSynapseTool,
  isSynapseToolReadOnly,
  parseSynapseToolRouterInvoke,
  searchSynapseTools,
  SYNAPSE_TOOL_ROUTER_INSTRUCTIONS,
  SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS,
} from "../synapse-tool-router"
import { buildAllMcpTools } from "../../../../synapse-capabilities/shared/registry"

describe("Synapse tool router catalog", () => {
  it("indexes every public Synapse MCP tool with action, domain, description, and schema", () => {
    const catalog = buildSynapseToolCatalog()

    expect(catalog.map((entry) => entry.name).sort()).toEqual(buildAllMcpTools().map((tool) => tool.name).sort())
    expect(new Set(catalog.map((entry) => entry.name)).size).toBe(catalog.length)
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

  it("hints at a small page size only when a match accepts a limit", async () => {
    const paginated = await searchSynapseTools({ query: "list drive files", limit: 3 })
    const noMatch = await searchSynapseTools({ query: "zzzz-no-synapse-tool-匹配-999999" })

    expect(paginated.tools.length).toBeGreaterThan(0)
    expect(paginated.guidance).toContain("limit")
    expect(paginated.guidance).toContain("nextOffset")
    expect(noMatch.guidance).toBeUndefined()
  })

  it("scopes the recursive drive tree to organizing instead of browsing", () => {
    const tools = buildAllMcpTools()
    const treeList = tools.find((tool) => tool.name === "app_drive_item_tree_list")
    const itemList = tools.find((tool) => tool.name === "app_drive_item_list")

    expect(treeList?.description).toContain("organizing")
    expect(treeList?.description).toContain("non-recursive listing tool")
    // Naming app_drive_item_list here would hand the tree tool every browse query
    // alias token (drive/item/list) and let it outrank the listing tool, which is
    // the opposite of the intent. Referring to it descriptively keeps the ordering.
    expect(treeList?.description).not.toContain("app_drive_item_list")
    expect(itemList?.description).not.toContain("organizing")
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
    expect(registeredTools).toMatchObject({
      search: {
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      invoke: {
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      },
    })
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

describe("Published tool definitions", () => {
  it("derives every property from the same zod shapes the SDK consumes", () => {
    const tools = buildSynapseToolRouterTools()

    expect(tools.map((tool) => tool.name)).toEqual(["search", "invoke"])

    tools.forEach((tool, index) => {
      const shape = SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS[index].inputShape
      const expectedRequired = Object.entries(shape)
        .filter(([, schema]) => !(schema as { safeParse(value: unknown): { success: boolean } })
          .safeParse(undefined).success)
        .map(([key]) => key)

      expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(Object.keys(shape).sort())
      expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(expectedRequired.sort())
      expect(tool.description).toBe(SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS[index].description)
    })
  })

  it("avoids top-level combinators that some MCP clients reject", () => {
    for (const tool of buildSynapseToolRouterTools()) {
      expect(tool.inputSchema.type).toBe("object")
      expect(tool.inputSchema).not.toHaveProperty("oneOf")
      expect(tool.inputSchema).not.toHaveProperty("anyOf")
      expect(tool.inputSchema).not.toHaveProperty("allOf")
    }
  })

  it("ships instructions a model can act on", () => {
    const bytes = Buffer.byteLength(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS)

    expect(bytes).toBeLessThanOrEqual(2048)
    expect(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS).toContain("search")
    expect(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS).toContain("invoke")
    expect(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS).toContain("app_*")
    expect(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS).toContain("toolName")
    /*
     * 曾经这里只说「domains 列表展示了存在的域」。终端里的 agent 读到列表里没有 `terminal`，就据此
     * 断定终端能力不存在。必须写明列表只装顶层命名空间，终端工具在 `app` 下。
     */
    expect(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS).toContain("top-level namespaces")
  })

  it("keeps the worked example consistent with the page-size rule", () => {
    const example = /"arguments":\{"limit":(\d+)\}/.exec(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS)
    const advised = /for example (\d+)\)/.exec(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS)

    expect(example?.[1]).toBeDefined()
    expect(advised?.[1]).toBeDefined()
    // Models follow the example over the prose, so a larger example would quietly
    // undo the rule.
    expect(Number(example?.[1])).toBeLessThanOrEqual(Number(advised?.[1]))
  })

  it("exposes the surface without reaching the executor for unknown names", async () => {
    const execute = vi.fn(async () => ({ ok: true, data: [] }))
    const surface = createSynapseToolRouterSurface(execute)

    expect(surface.listTools().map((tool) => tool.name).sort()).toEqual(["invoke", "search"])
    expect(surface.instructions).toBe(SYNAPSE_TOOL_ROUTER_INSTRUCTIONS)

    const invoked = await surface.callTool("invoke", { toolName: "app_database_table_list", arguments: {} })
    expect(execute).toHaveBeenCalledWith("app_database_table_list", {}, undefined)
    expect(invoked.isError).toBeUndefined()

    const unknown = await surface.callTool("invoke", { toolName: "missing_tool" })
    expect(unknown.isError).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)

    const bare = await surface.callTool("app_database_table_list", {})
    expect(bare.isError).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
