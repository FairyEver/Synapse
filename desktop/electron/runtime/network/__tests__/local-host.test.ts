import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import WebSocket from "ws"

import { createNetworkServiceRegistry } from "../registry"
import { createLocalNetworkHostLifecycle } from "../local-host"

describe("Local network host", () => {
  it("registers through NetworkServiceRegistry, binds localhost, authenticates HTTP, and stops", async () => {
    const port = await getFreePort()
    const registry = createNetworkServiceRegistry()
    const binding = await registry.register({
      id: "local-http-test",
      role: "http",
      preferredPort: port,
      handler: { handle: () => ({ ok: true }) },
      start: (binding) => createLocalNetworkHostLifecycle(binding, {
        handleHttp: (request) => {
          if (request.headers.authorization !== "Bearer tok") {
            return { status: 401, body: { ok: false, error: "unauthorized" } }
          }
          return { status: 200, body: { ok: true } }
        },
      }),
    })

    expect(binding).toEqual({
      id: "local-http-test",
      port,
      bindAddress: "127.0.0.1",
    })

    const denied = await fetch(`http://127.0.0.1:${String(port)}/send`)
    expect(denied.status).toBe(401)
    const allowed = await fetch(`http://127.0.0.1:${String(port)}/send`, {
      headers: { Authorization: "Bearer tok" },
    })
    expect(await allowed.json()).toEqual({ ok: true })

    await registry.unregister("local-http-test")
    await expect(fetch(`http://127.0.0.1:${String(port)}/send`)).rejects.toThrow()
  })

  it("handles WebSocket upgrade and rejects failed auth before upgrade", async () => {
    const port = await getFreePort()
    const registry = createNetworkServiceRegistry()
    await registry.register({
      id: "local-ws-test",
      role: "websocket",
      preferredPort: port,
      handler: { handle: () => ({ ok: true }) },
      start: (binding) => createLocalNetworkHostLifecycle(binding, {
        handleHttp: () => ({ status: 404, body: { ok: false } }),
        acceptWebSocket: (request) => ({
          ok: request.headers.authorization === "Bearer tok",
          status: 401,
          message: "unauthorized",
        }),
        handleWebSocket: (connection) => {
          connection.onJsonMessage((message) => {
            connection.sendJson({ echo: message })
          })
        },
      }),
    })

    await expect(openWebSocket(`ws://127.0.0.1:${String(port)}/ws`)).rejects.toThrow()
    const ws = await openWebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      Authorization: "Bearer tok",
    })
    ws.send(JSON.stringify({ hello: "world" }))
    await expect(readJson(ws)).resolves.toEqual({ echo: { hello: "world" } })
    ws.close()
    await registry.unregister("local-ws-test")
  })
})

async function getFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return address.port
}

function openWebSocket(
  url: string,
  headers?: Record<string, string>,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    ws.once("open", () => resolve(ws))
    ws.once("error", reject)
  })
}

function readJson(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString()) as unknown))
  })
}
