import { describe, expect, it } from "vitest"
import { processMcpRequest } from "../../data-store/shared/mcp-rpc"

const identity = { name: "test-data-store", version: "0.0.0" }

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
})
