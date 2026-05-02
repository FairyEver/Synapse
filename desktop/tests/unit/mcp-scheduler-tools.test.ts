import { describe, expect, it, vi } from "vitest"

import { processMcpRequest } from "../../data-store/shared/mcp-rpc"
import { SYNAPSE_DATA_SERVER_IDENTITY } from "../../data-store/shared/server-identity"
import { buildAllMcpTools, MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"

describe("MCP Scheduler tools", () => {
  it("lists existing Data Store tools and new Scheduler tools", () => {
    const names = buildAllMcpTools().map((tool) => tool.name)
    expect(names).toContain("list_tables")
    expect(names).toContain("query")
    expect(names).toContain("scheduler_task_list")
    expect(names).toContain("scheduler_task_get")
    expect(names).toContain("scheduler_task_create")
    expect(names).toContain("scheduler_task_enable")
    expect(names).toContain("scheduler_task_disable")
  })

  it("maps Scheduler MCP tools to Scheduler actions", () => {
    expect(MCP_TOOL_ACTIONS.scheduler_task_list).toBe("schedulerTaskList")
    expect(MCP_TOOL_ACTIONS.scheduler_task_get).toBe("schedulerTaskGet")
    expect(MCP_TOOL_ACTIONS.scheduler_task_create).toBe("schedulerTaskCreate")
    expect(MCP_TOOL_ACTIONS.scheduler_task_enable).toBe("schedulerTaskEnable")
    expect(MCP_TOOL_ACTIONS.scheduler_task_disable).toBe("schedulerTaskDisable")
  })

  it("normalizes Scheduler MCP tool results to data payload", async () => {
    const executeTool = vi.fn(async () => ({
      ok: true,
      data: [{ id: "task:1", name: "Daily" }],
      total: 1,
    }))
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "scheduler_task_list",
        arguments: {},
      },
    }, SYNAPSE_DATA_SERVER_IDENTITY, executeTool)

    expect(response.kind).toBe("result")
    if (response.kind !== "result") return
    expect(response.result).toEqual({
      content: [{
        type: "text",
        text: JSON.stringify([{ id: "task:1", name: "Daily" }], null, 2),
      }],
    })
  })
})
