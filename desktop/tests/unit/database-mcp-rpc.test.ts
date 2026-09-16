import { describe, expect, it } from "vitest"
import { processMcpRequest, sanitizeMcpErrorMessage } from "../../database/shared/mcp-rpc"
import { MCP_TOOL_ACTIONS, buildAllMcpTools, getActionDomainId } from "../../synapse-capabilities/shared/registry"
import { createSynapseToolRouterSurface } from "../../electron/services/agent-runtime/synapse-tool-router"

const identity = { name: "test-database", version: "0.0.0" }

// Every call below goes through the production surface, so these assertions
// exercise the real search/invoke path rather than a bespoke shortcut.
function surfaceFor(dispatcherResult: unknown) {
  return createSynapseToolRouterSurface(async () => dispatcherResult)
}

async function callTool(toolName: string, dispatcherResult: unknown): Promise<unknown> {
  const result = await callToolResult(toolName, dispatcherResult)
  return JSON.parse(result.content[0].text)
}

async function callToolResult(
  toolName: string,
  dispatcherResult: unknown,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const response = await processMcpRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "invoke",
        arguments: { toolName, arguments: {} },
      },
    },
    identity,
    surfaceFor(dispatcherResult),
  )

  expect(response.kind).toBe("result")
  if (response.kind !== "result") throw new Error("Expected result response")

  return response.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
}

describe("Workflow MCP RPC", () => {
  it("returns workflow list data without the internal dispatcher envelope", async () => {
    const payload = await callTool("app_workflow_definition_list", {
      ok: true,
      data: [{ id: "wf-1", name: "Test", version: "v1", nodeCount: 2 }],
    })
    expect(payload).toEqual([{ id: "wf-1", name: "Test", version: "v1", nodeCount: 2 }])
  })

  it("returns workflow create data with id and versionHash", async () => {
    const payload = await callTool("app_workflow_definition_create", {
      ok: true,
      data: { id: "wf-new", versionHash: "v_abc" },
    })
    expect(payload).toEqual({ id: "wf-new", versionHash: "v_abc" })
  })

  it("returns runId from app_workflow_run_execute", async () => {
    const payload = await callTool("app_workflow_run_execute", {
      ok: true,
      data: { runId: "run-123" },
    })
    expect(payload).toEqual({ runId: "run-123" })
  })

  it("returns run status from app_workflow_run_get", async () => {
    const status = { runId: "run-1", workflowId: "wf-1", status: "completed", nodeResults: {} }
    const payload = await callTool("app_workflow_run_get", {
      ok: true,
      data: status,
    })
    expect(payload).toEqual(status)
  })

  it("returns node type summaries from app_workflow_node_type_list", async () => {
    const summaries = [{ type: "prompt", title: "AI 对话", subtitle: "", color: "#000" }]
    const payload = await callTool("app_workflow_node_type_list", {
      ok: true,
      data: summaries,
    })
    expect(payload).toEqual(summaries)
  })

  it("returns null for workflow actions with no data field (e.g. delete)", async () => {
    const payload = await callTool("app_workflow_definition_delete", { ok: true })
    expect(payload).toBeNull()
  })
})

describe("Terminal MCP RPC", () => {
  it("preserves the versioned Terminal result envelope", async () => {
    const envelope = {
      ok: true,
      contractVersion: "2.0",
      correlationId: "correlation-1",
      outcome: "accepted",
      data: { capabilitySetVersion: "2.0.0" },
    }
    await expect(callTool("app_terminal_capabilities_get", envelope)).resolves.toEqual(envelope)
  })
})

describe("Database MCP RPC", () => {
  it("sanitizes tool execution errors before returning them to MCP clients", async () => {
    const response = await processMcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "invoke",
          arguments: { toolName: "app_database_table_list", arguments: {} },
        },
      },
      identity,
      createSynapseToolRouterSurface(async () => {
        throw new Error("open /Users/liyang/private/db.sqlite sk-ant-test123456")
      }),
    )

    expect(response.kind).toBe("result")
    if (response.kind !== "result") throw new Error("Expected result response")

    const result = response.result as { content: Array<{ type: string; text: string }>; isError: boolean }
    const text = result.content[0]?.text ?? ""

    expect(result.isError).toBe(true)
    expect(text).toContain("Error:")
    expect(text).not.toContain("/Users/liyang/private/db.sqlite")
    expect(text).not.toContain("sk-ant-test123456")
    expect(text).toContain("[path]")
    expect(text).toContain("[key]")
  })

  it("sanitizes top-level MCP bridge errors with the same helper", () => {
    const message = sanitizeMcpErrorMessage(new Error("connect failed at /Users/liyang/private/data.db Bearer sk-secret"))

    expect(message).not.toContain("/Users/liyang/private/data.db")
    expect(message).not.toContain("Bearer sk-secret")
    expect(message).toContain("[path]")
    expect(message).toContain("Bearer [redacted]")
  })

  it("returns list results without the internal dispatcher envelope", async () => {
    const payload = await callTool("app_database_table_list", {
      ok: true,
      data: [{ name: "projects", description: "Project tracker" }],
    })

    expect(payload).toEqual([{ name: "projects", description: "Project tracker" }])
  })

  it("returns query rows and total in the advertised shape", async () => {
    const payload = await callTool("app_database_row_list", {
      ok: true,
      data: [{ id: 1, title: "Ship" }],
      total: 1,
    })

    expect(payload).toEqual({ rows: [{ id: 1, title: "Ship" }], total: 1 })
  })

  it("returns bulk mutation ids and affected count in the advertised shape", async () => {
    const payload = await callTool("app_database_rows_update", {
      ok: true,
      data: { ids: [1, 3] },
      affected: 2,
    })

    expect(payload).toEqual({ affected: 2, ids: [1, 3] })
  })

  it("returns folder list data in the advertised shape", async () => {
    const folders = [{
      id: 1,
      name: "Planning",
      sortOrder: 0,
      members: [{ tableName: "projects", sortOrder: 0 }],
    }]
    const payload = await callTool("app_database_folder_list", {
      ok: true,
      data: folders,
    })

    expect(payload).toEqual(folders)
  })

  it("returns created folder id in the advertised shape", async () => {
    const payload = await callTool("app_database_folder_create", {
      ok: true,
      data: { id: 7 },
    })

    expect(payload).toEqual({ id: 7 })
  })

  it("preserves data for registered database actions without specialized output shaping", async () => {
    const payload = await callTool("app_database_table_create", {
      ok: true,
      data: { tableId: "table-1" },
    })

    expect(payload).toEqual({ tableId: "table-1" })
  })
})

describe("MCP RPC capability normalization coverage", () => {
  it("rejects retired MCP tool names and teaches the two-step flow", async () => {
    const result = await callToolResult("database_table_list", { ok: true, data: [] })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/^Unknown tool: database_table_list\./)
    expect(result.content[0]?.text).toContain("search")
    expect(result.content[0]?.text).toContain("invoke")
  })

  it("marks dispatcher ok false results as MCP tool errors while preserving the failure payload", async () => {
    const result = await callToolResult("app_workflow_run_execute", {
      ok: false,
      code: "WORKFLOW_VALIDATION_FAILED",
      errors: [{ message: "Start node is missing" }],
      data: { runId: "run-partial" },
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual({
      ok: false,
      code: "WORKFLOW_VALIDATION_FAILED",
      errors: [{ message: "Start node is missing" }],
      data: { runId: "run-partial" },
    })
  })

  it("unwraps dispatcher data for every registered non-database, non-Terminal capability", async () => {
    const entries = Object.entries(MCP_TOOL_ACTIONS)
      .filter(([, action]) => getActionDomainId(action) !== "database" && !action.startsWith("app.terminal."))

    expect(entries.length).toBeGreaterThan(0)

    for (const [toolName, action] of entries) {
      const payload = await callTool(toolName, {
        ok: true,
        data: { action },
      })

      expect(payload).toEqual({ action })
    }
  })
})

describe("Content MCP RPC", () => {
  it("returns content dispatcher data without the internal envelope", async () => {
    const payload = await callTool("app_resource_repository_skill_list", {
      ok: true,
      data: [{ id: "skill-1", title: "Skill" }],
      total: 1,
    })

    expect(payload).toEqual([{ id: "skill-1", title: "Skill" }])
  })
})

describe("Model Price MCP RPC", () => {
  it("returns model price dispatcher data without the internal envelope", async () => {
    const payload = await callTool("app_model_price_rule_list", {
      ok: true,
      data: [{ id: "deepseek-v4-pro", modelPattern: "deepseek-v4-pro", inputPer1M: 3 }],
    })

    expect(payload).toEqual([{ id: "deepseek-v4-pro", modelPattern: "deepseek-v4-pro", inputPer1M: 3 }])
  })
})

describe("Repository and Secrets MCP RPC", () => {
  it("returns repository data without the internal dispatcher envelope", async () => {
    const payload = await callTool("app_settings_repository_item_list", {
      ok: true,
      data: {
        activeRepositoryUuid: "repo-1",
        repositories: [{ uuid: "repo-1", name: "Main", localPath: "/repo", isActive: true }],
      },
      total: 1,
    })

    expect(payload).toEqual({
      activeRepositoryUuid: "repo-1",
      repositories: [{ uuid: "repo-1", name: "Main", localPath: "/repo", isActive: true }],
    })
  })

  it("returns secret data without the internal dispatcher envelope", async () => {
    const payload = await callTool("app_secrets_item_get", {
      ok: true,
      data: {
        secret: { id: "secret-1", name: "TOKEN", hasValue: true },
      },
    })

    expect(payload).toEqual({
      secret: { id: "secret-1", name: "TOKEN", hasValue: true },
    })
  })
})

describe("Public MCP surface", () => {
  async function request(
    method: string,
    params: Record<string, unknown> | undefined,
    executeTool: () => unknown = () => ({ ok: true }),
  ): Promise<Record<string, unknown>> {
    const response = await processMcpRequest(
      { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
      identity,
      createSynapseToolRouterSurface(async () => executeTool()),
    )
    expect(response.kind).toBe("result")
    if (response.kind !== "result") throw new Error("Expected result response")
    return response.result as Record<string, unknown>
  }

  it("publishes exactly the two router tools", async () => {
    const result = await request("tools/list", undefined)
    const tools = result.tools as Array<{ name: string }>

    expect(tools.map((tool) => tool.name).sort()).toEqual(["invoke", "search"])
    expect(tools.some((tool) => tool.name.startsWith("app_"))).toBe(false)
  })

  it("keeps the published payload far below the full registry", async () => {
    const result = await request("tools/list", undefined)
    const published = Buffer.byteLength(JSON.stringify(result.tools))

    expect(published).toBeLessThan(Buffer.byteLength(JSON.stringify(buildAllMcpTools())) * 0.02)
  })

  it("carries server instructions on initialize", async () => {
    const result = await request("initialize", { protocolVersion: "2024-11-05" })
    const instructions = result.instructions as string

    expect(typeof instructions).toBe("string")
    expect(Buffer.byteLength(instructions)).toBeLessThanOrEqual(2048)
    expect(instructions).toContain("search")
    expect(instructions).toContain("invoke")
  })

  it("refuses a bare capability name without executing it", async () => {
    let executed = 0
    const result = await request(
      "tools/call",
      { name: "app_database_table_list", arguments: {} },
      () => { executed += 1; return { ok: true } },
    )

    expect(result.isError).toBe(true)
    expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(/^Unknown tool: app_database_table_list\./)
    expect(executed).toBe(0)
  })

  it("refuses an invoke with an unregistered tool name without executing it", async () => {
    let executed = 0
    const result = await request(
      "tools/call",
      { name: "invoke", arguments: { toolName: "app_not_a_real_tool" } },
      () => { executed += 1; return { ok: true } },
    )

    expect(result.isError).toBe(true)
    expect(executed).toBe(0)
  })

  it("finds a capability through search and reaches it through invoke", async () => {
    const found = await request("tools/call", {
      name: "search",
      arguments: { query: "查看云盘文件列表", limit: 3 },
    })
    const matches = JSON.parse((found.content as Array<{ text: string }>)[0].text) as {
      tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>
    }
    const driveItemList = matches.tools.find((tool) => tool.name === "app_drive_item_list")

    expect(driveItemList).toBeDefined()
    expect(driveItemList?.inputSchema.properties).toHaveProperty("parentId")

    const invoked = await request("tools/call", {
      name: "invoke",
      arguments: { toolName: "app_drive_item_list", arguments: { limit: 2 } },
    })

    expect(invoked.isError).toBeUndefined()
  })
})
