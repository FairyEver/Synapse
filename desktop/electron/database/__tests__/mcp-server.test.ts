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

function postJson(port: number, payload: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8")
    const req = request({
      method: "POST",
      hostname: "127.0.0.1",
      port,
      path: "/mcp",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.length,
      },
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

  it("accepts local MCP requests without Authorization", async () => {
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
})
