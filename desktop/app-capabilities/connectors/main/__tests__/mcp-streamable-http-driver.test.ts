import { describe, expect, it, vi } from "vitest"
import { figmaConnector } from "../definitions"
import { assertLocalMcpEndpoint, createMcpStreamableHttpDriver } from "../mcp-streamable-http-driver"

function createHarness(fetchImpl: typeof fetch, allowed = true) {
  const permissionGuard = { check: vi.fn(async () => allowed
    ? { allowed: true as const }
    : { allowed: false as const, reason: "blocked", policyId: "test" }) }
  const auditSink = { record: vi.fn() }
  const driver = createMcpStreamableHttpDriver({
    permissionGuard: permissionGuard as never,
    auditSink: auditSink as never,
    fetchImpl,
  })
  return { driver, permissionGuard, auditSink }
}

describe("mcp-streamable-http connector driver", () => {
  it("completes MCP initialization and validates required tools", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('data: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"Figma"}}}\n\n', {
        status: 200,
        headers: { "mcp-session-id": "session-1" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [{ name: "get_design_context" }, { name: "get_screenshot" }] },
      }), { status: 200 }))
    const { driver, permissionGuard, auditSink } = createHarness(fetchImpl as typeof fetch)

    await expect(driver.probe(figmaConnector)).resolves.toEqual({ ok: true, toolCount: 2 })
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "http://127.0.0.1:3845/mcp",
    }))
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "POST", redirect: "manual" })
    expect(auditSink.record).toHaveBeenLastCalledWith(expect.objectContaining({
      outcome: "allowed",
      metadata: expect.objectContaining({ connectorId: "figma", toolCount: 2 }),
    }))
  })

  it("fails when a required tool is missing", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [] } }), { status: 200 }))
    const { driver, auditSink } = createHarness(fetchImpl as typeof fetch)

    await expect(driver.probe(figmaConnector)).resolves.toEqual({
      ok: false,
      errorCode: "required_tools_missing",
    })
    expect(auditSink.record).toHaveBeenLastCalledWith(expect.objectContaining({
      outcome: "failed",
      metadata: expect.objectContaining({ errorCode: "required_tools_missing" }),
    }))
  })

  it("does not perform network IO when permission is denied", async () => {
    const fetchImpl = vi.fn()
    const { driver, auditSink } = createHarness(fetchImpl as typeof fetch, false)

    await expect(driver.probe(figmaConnector)).resolves.toEqual({ ok: false, errorCode: "permission_denied" })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
  })

  it("rejects redirects without following them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://example.com/mcp" },
    }))
    const { driver } = createHarness(fetchImpl as typeof fetch)

    await expect(driver.probe(figmaConnector)).resolves.toEqual({
      ok: false,
      errorCode: "redirect_not_allowed",
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("uses one bounded timeout for the full probe", async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      }))
      const { driver } = createHarness(fetchImpl as typeof fetch)

      const probe = driver.probe(figmaConnector)
      await vi.advanceTimersByTimeAsync(4_000)

      await expect(probe).resolves.toEqual({ ok: false, errorCode: "probe_timeout" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("accepts only explicit IPv4 loopback HTTP endpoints", () => {
    expect(() => assertLocalMcpEndpoint("http://127.0.0.1:3845/mcp")).not.toThrow()
    expect(() => assertLocalMcpEndpoint("http://localhost:3845/mcp")).toThrow()
    expect(() => assertLocalMcpEndpoint("https://127.0.0.1:3845/mcp")).toThrow()
    expect(() => assertLocalMcpEndpoint("http://user:pass@127.0.0.1:3845/mcp")).toThrow()
    expect(() => assertLocalMcpEndpoint("http://127.0.0.1:3845/mcp#fragment")).toThrow()
    expect(() => assertLocalMcpEndpoint("http://127.0.0.1/mcp")).toThrow()
  })
})
