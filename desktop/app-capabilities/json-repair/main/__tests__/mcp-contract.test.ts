import { describe, expect, it } from "vitest"
import { processMcpRequest } from "../../../../database/shared/mcp-rpc"
import { JSON_REPAIR_MCP_TOOL_NAME } from "../../shared/capability"

const identity = { name: "test", version: "1.0.0" }

describe("JSON Repair MCP contract", () => {
  it("returns only { json } for a successful tool call", async () => {
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: JSON_REPAIR_MCP_TOOL_NAME,
        arguments: { text: "{ok:true}" },
      },
    }, identity, async () => ({
      ok: true,
      data: { json: "{\"ok\":true}" },
    }))

    expect(response).toMatchObject({
      kind: "result",
      result: {
        content: [{
          type: "text",
          text: "{\n  \"json\": \"{\\\"ok\\\":true}\"\n}",
        }],
      },
    })
    expect(JSON.stringify(response)).not.toContain("affected")
  })

  it("marks failures as errors and exposes only the shared error payload", async () => {
    const error = {
      code: "NO_JSON_FOUND",
      message: "未找到可修复的 JSON 数据。",
      retryable: false,
    }
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: JSON_REPAIR_MCP_TOOL_NAME,
        arguments: { text: "no json" },
      },
    }, identity, async () => ({
      ok: false,
      code: error.code,
      error: error.message,
      data: error,
    }))

    expect(response).toMatchObject({
      kind: "result",
      result: {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify(error, null, 2),
        }],
      },
    })
  })
})
