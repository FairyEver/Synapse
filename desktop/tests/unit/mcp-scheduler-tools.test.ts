import { describe, expect, it, vi } from "vitest"

import { processMcpRequest } from "../../data-store/shared/mcp-rpc"
import { SYNAPSE_DATA_SERVER_IDENTITY } from "../../data-store/shared/server-identity"
import { buildAllMcpTools, MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"

describe("MCP Scheduler tools", () => {
  it("lists existing Database tools and new Scheduler tools", () => {
    const names = buildAllMcpTools().map((tool) => tool.name)
    expect(names).toContain("database_table_list")
    expect(names).toContain("database_row_list")
    expect(names).toContain("scheduler_task_list")
    expect(names).toContain("scheduler_task_get")
    expect(names).toContain("scheduler_task_create")
    expect(names).toContain("scheduler_task_enable")
    expect(names).toContain("scheduler_task_disable")
  })

  it("lists second-phase Scheduler MCP tools and omits hidden tools", () => {
    const names = buildAllMcpTools().map((tool) => tool.name)
    expect(names).toContain("scheduler_run_list")
    expect(names).toContain("scheduler_runtime_inspect")
    expect(names).toContain("scheduler_action_type_list")
    expect(names).toContain("scheduler_task_update")
    expect(names).not.toContain("scheduler_task_delete")
    expect(names).not.toContain("scheduler_task_run_now")
    expect(names).not.toContain("scheduler_task_stop_run")
  })

  it("maps Scheduler MCP tools to Scheduler actions", () => {
    expect(MCP_TOOL_ACTIONS.scheduler_task_list).toBe("scheduler.task.list")
    expect(MCP_TOOL_ACTIONS.scheduler_task_get).toBe("scheduler.task.get")
    expect(MCP_TOOL_ACTIONS.scheduler_task_create).toBe("scheduler.task.create")
    expect(MCP_TOOL_ACTIONS.scheduler_task_enable).toBe("scheduler.task.enable")
    expect(MCP_TOOL_ACTIONS.scheduler_task_disable).toBe("scheduler.task.disable")
    expect(MCP_TOOL_ACTIONS.scheduler_run_list).toBe("scheduler.run.list")
    expect(MCP_TOOL_ACTIONS.scheduler_runtime_inspect).toBe("scheduler.runtime.inspect")
    expect(MCP_TOOL_ACTIONS.scheduler_action_type_list).toBe("scheduler.action_type.list")
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

  it("routes new Scheduler MCP tools through their action names", async () => {
    const executeTool = vi.fn(async () => ({
      ok: true,
      data: [{ id: "run:1", status: "success" }],
      total: 1,
    }))
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "scheduler_run_list",
        arguments: { taskId: "task:1" },
      },
    }, SYNAPSE_DATA_SERVER_IDENTITY, executeTool)

    expect(executeTool).toHaveBeenCalledWith("scheduler_run_list", { taskId: "task:1" })
    expect(response.kind).toBe("result")
    if (response.kind !== "result") return
    expect(response.result).toEqual({
      content: [{
        type: "text",
        text: JSON.stringify([{ id: "run:1", status: "success" }], null, 2),
      }],
    })
  })

  it("keeps hidden Scheduler MCP tools unknown", async () => {
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "scheduler_task_delete",
        arguments: { taskId: "task:1" },
      },
    }, SYNAPSE_DATA_SERVER_IDENTITY, async () => ({ ok: true }))

    expect(response.kind).toBe("result")
    if (response.kind !== "result") return
    expect(response.result).toEqual({
      content: [{ type: "text", text: "Unknown tool: scheduler_task_delete" }],
      isError: true,
    })
  })
})
