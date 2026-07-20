import { request } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../services/log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function postJson(
  port: number,
  payload: unknown,
  authorization?: string,
  origin?: string,
  path = "/mcp",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8")
    const headers: Record<string, string | number> = {
      "Content-Type": "application/json; charset=utf-8",
      "Connection": "close",
      "Content-Length": body.length,
    }
    if (authorization) {
      headers.Authorization = authorization
    }
    if (origin) {
      headers.Origin = origin
    }
    const req = request({
      method: "POST",
      hostname: "127.0.0.1",
      port,
      path,
      agent: false,
      headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      })
    })
    req.on("error", reject)
    req.end(body)
  })
}

describe("MCP HTTP server", () => {
  afterEach(async () => {
    const { stopMcpServer } = await import("../mcp-server")
    await stopMcpServer()
    vi.resetModules()
  })

  it("accepts local MCP initialize requests without Authorization", async () => {
    const { startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({
      dispatch: vi.fn(),
    })

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "synapse-mcp" },
      },
    })
  })

  it("accepts local MCP requests even when an invalid Authorization header is present", async () => {
    const { startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({
      dispatch: vi.fn(),
    })

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }, "Bearer wrong-token")

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "synapse-mcp" },
      },
    })
  })

  it("rejects non-local origins before dispatching tool calls", async () => {
    const dispatch = vi.fn()
    const { startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({ dispatch })

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "app_automation_item_create",
        arguments: { name: "unsafe" },
      },
    }, undefined, "https://example.com")

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({ error: "Forbidden origin" })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("returns 404 for non-MCP paths", async () => {
    const { startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({
      dispatch: vi.fn(),
    })

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }, undefined, undefined, "/not-mcp")

    expect(response.status).toBe(404)
    expect(JSON.parse(response.body)).toEqual({ error: "Not found" })
  })

  it("lists Automation MCP tools", async () => {
    const { startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({
      dispatch: vi.fn(),
    })

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })

    expect(response.status).toBe(200)
    const payload = JSON.parse(response.body)
    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
      "app_automation_item_list",
      "app_automation_item_create",
      "app_automation_run_execute",
      "app_automation_webhook_list",
      "app_automation_trigger_type_list",
      "app_automation_executor_type_list",
    ]))
    expect(payload.result.tools.map((tool: { name: string }) => tool.name))
      .not.toContain("automation_item_list")
  })

  it("calls Automation tools through the action router", async () => {
    const dispatch = vi.fn(async () => ({ ok: true, data: [{ id: "automation:1" }] }))
    const { startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({ dispatch })

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "app_automation_item_list",
        arguments: { enabled: true },
      },
    })

    expect(response.status).toBe(200)
    expect(dispatch).toHaveBeenCalledWith("app.automation.item.list", { enabled: true }, {
      source: "mcp-http",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
    })
    expect(JSON.parse(response.body).result.content[0].text).toBe(JSON.stringify([{ id: "automation:1" }], null, 2))
  })
})
