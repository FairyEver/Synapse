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
      path: "/mcp",
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

  it("rejects local MCP requests without Authorization", async () => {
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

    expect(response.status).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: "Unauthorized" })
  })

  it("rejects local MCP requests with invalid Authorization", async () => {
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

    expect(response.status).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: "Unauthorized" })
  })

  it("rejects localhost-origin tool calls without Authorization", async () => {
    const dispatch = vi.fn()
    const { startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({ dispatch })

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "automation_item_create",
        arguments: { name: "unsafe" },
      },
    }, undefined, "http://localhost:5173")

    expect(response.status).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: "Unauthorized" })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("accepts local MCP requests with the server Bearer token", async () => {
    const { getMcpServerToken, startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({
      dispatch: vi.fn(),
    })
    const token = getMcpServerToken()

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }, `Bearer ${token}`)

    expect(token).not.toBe("")
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: { name: "synapse-mcp" },
      },
    })
  })

  it("lists Automation MCP tools", async () => {
    const { getMcpServerToken, startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({
      dispatch: vi.fn(),
    })
    const token = getMcpServerToken()

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }, `Bearer ${token}`)

    expect(response.status).toBe(200)
    const payload = JSON.parse(response.body)
    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
      "automation_item_list",
      "automation_item_create",
      "automation_run_execute",
      "automation_webhook_list",
      "automation_trigger_type_list",
      "automation_executor_type_list",
    ]))
  })

  it("calls Automation tools through the action router", async () => {
    const dispatch = vi.fn(async () => ({ ok: true, data: [{ id: "automation:1" }] }))
    const { getMcpServerToken, startMcpServer } = await import("../mcp-server")
    const port = await startMcpServer({ dispatch })
    const token = getMcpServerToken()

    const response = await postJson(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "automation_item_list",
        arguments: { enabled: true },
      },
    }, `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(dispatch).toHaveBeenCalledWith("automation.item.list", { enabled: true }, {
      source: "mcp-http",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
    })
    expect(JSON.parse(response.body).result.content[0].text).toBe(JSON.stringify([{ id: "automation:1" }], null, 2))
  })
})
