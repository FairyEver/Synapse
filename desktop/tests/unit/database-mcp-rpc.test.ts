import { describe, expect, it } from "vitest"
import { processMcpRequest } from "../../database/shared/mcp-rpc"

const identity = { name: "test-database", version: "0.0.0" }

async function callTool(toolName: string, dispatcherResult: unknown): Promise<unknown> {
  const response = await processMcpRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {},
      },
    },
    identity,
    async () => dispatcherResult,
  )

  expect(response.kind).toBe("result")
  if (response.kind !== "result") throw new Error("Expected result response")

  const result = response.result as { content: Array<{ type: string; text: string }> }
  return JSON.parse(result.content[0].text)
}

describe("Workflow MCP RPC", () => {
  it("returns workflow list data without the internal dispatcher envelope", async () => {
    const payload = await callTool("workflow_definition_list", {
      ok: true,
      data: [{ id: "wf-1", name: "Test", version: "v1", nodeCount: 2 }],
    })
    expect(payload).toEqual([{ id: "wf-1", name: "Test", version: "v1", nodeCount: 2 }])
  })

  it("returns workflow create data with id and versionHash", async () => {
    const payload = await callTool("workflow_definition_create", {
      ok: true,
      data: { id: "wf-new", versionHash: "v_abc" },
    })
    expect(payload).toEqual({ id: "wf-new", versionHash: "v_abc" })
  })

  it("returns runId from workflow_run_execute", async () => {
    const payload = await callTool("workflow_run_execute", {
      ok: true,
      data: { runId: "run-123" },
    })
    expect(payload).toEqual({ runId: "run-123" })
  })

  it("returns run status from workflow_run_get", async () => {
    const status = { runId: "run-1", workflowId: "wf-1", status: "completed", nodeResults: {} }
    const payload = await callTool("workflow_run_get", {
      ok: true,
      data: status,
    })
    expect(payload).toEqual(status)
  })

  it("returns node type summaries from workflow_node_type_list", async () => {
    const summaries = [{ type: "prompt", title: "AI 对话", subtitle: "", color: "#000" }]
    const payload = await callTool("workflow_node_type_list", {
      ok: true,
      data: summaries,
    })
    expect(payload).toEqual(summaries)
  })

  it("returns null for workflow actions with no data field (e.g. delete)", async () => {
    const payload = await callTool("workflow_definition_delete", { ok: true })
    expect(payload).toBeNull()
  })
})

describe("Database MCP RPC", () => {
  it("returns list results without the internal dispatcher envelope", async () => {
    const payload = await callTool("database_table_list", {
      ok: true,
      data: [{ name: "projects", description: "Project tracker" }],
    })

    expect(payload).toEqual([{ name: "projects", description: "Project tracker" }])
  })

  it("returns query rows and total in the advertised shape", async () => {
    const payload = await callTool("database_row_list", {
      ok: true,
      data: [{ id: 1, title: "Ship" }],
      total: 1,
    })

    expect(payload).toEqual({ rows: [{ id: 1, title: "Ship" }], total: 1 })
  })

  it("returns bulk mutation ids and affected count in the advertised shape", async () => {
    const payload = await callTool("database_rows_update", {
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
    const payload = await callTool("database_folder_list", {
      ok: true,
      data: folders,
    })

    expect(payload).toEqual(folders)
  })

  it("returns created folder id in the advertised shape", async () => {
    const payload = await callTool("database_folder_create", {
      ok: true,
      data: { id: 7 },
    })

    expect(payload).toEqual({ id: 7 })
  })
})

describe("Content MCP RPC", () => {
  it("returns content dispatcher data without the internal envelope", async () => {
    const payload = await callTool("content_skill_list", {
      ok: true,
      data: [{ id: "skill-1", title: "Skill" }],
      total: 1,
    })

    expect(payload).toEqual([{ id: "skill-1", title: "Skill" }])
  })
})
