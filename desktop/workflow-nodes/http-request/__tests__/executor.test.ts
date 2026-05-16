import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))
vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { httpRequestNodeExecutor } from "../executor.main"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"
import type { HttpRequestNodeConfig } from "../schema"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }

function makeInput(config: Partial<HttpRequestNodeConfig>, runtimeDeps?: NodeRuntimeDeps): NodeExecutionInput<HttpRequestNodeConfig> {
  return {
    config: {
      method: "GET",
      url: "https://example.com/api",
      bodyType: "none",
      variables: [],
      ...config,
    } as HttpRequestNodeConfig,
    resolvedVariables: {},
    context: ctx,
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps,
  }
}

function fakeRuntimeDeps(response?: { status: number; statusText: string; headers: Record<string, string>; body: string }): NodeRuntimeDeps {
  return {
    processRunner: { run: vi.fn() },
    sendHttpRequest: vi.fn().mockResolvedValue(response ?? {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: '{"result":"ok"}',
    }),
  }
}

describe("httpRequestNodeExecutor", () => {
  it("returns success with response body as output", async () => {
    const deps = fakeRuntimeDeps()
    const result = await httpRequestNodeExecutor.execute(makeInput({}, deps))
    expect(result.status).toBe("success")
    expect(result.output).toBe('{"result":"ok"}')
    expect(result.outputs?.status).toBe(200)
  })

  it("fails gracefully when runtimeDeps is missing", async () => {
    const result = await httpRequestNodeExecutor.execute(makeInput({}))
    expect(result.status).toBe("failed")
    expect(result.error).toContain("HTTP 请求能力不可用")
  })

  it("passes method, url, headers, body to sendHttpRequest", async () => {
    const deps = fakeRuntimeDeps()
    await httpRequestNodeExecutor.execute(makeInput({
      method: "POST",
      url: "https://example.com/api",
      headers: { Authorization: "Bearer token" },
      bodyType: "json",
      body: '{"key":"value"}',
    }, deps))
    expect(deps.sendHttpRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      url: "https://example.com/api",
      headers: { Authorization: "Bearer token" },
      body: '{"key":"value"}',
    }))
  })

  it("appends query parameters to url", async () => {
    const deps = fakeRuntimeDeps()
    await httpRequestNodeExecutor.execute(makeInput({
      url: "https://example.com/api",
      query: { foo: "bar" },
    }, deps))
    expect(deps.sendHttpRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.com/api?foo=bar",
    }))
  })

  it("returns failed when sendHttpRequest throws", async () => {
    const deps: NodeRuntimeDeps = {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn().mockRejectedValue(new Error("Network error")),
    }
    const result = await httpRequestNodeExecutor.execute(makeInput({}, deps))
    expect(result.status).toBe("failed")
    expect(result.error).toContain("Network error")
  })

  it("does not call sendToAgent", async () => {
    const input = makeInput({}, fakeRuntimeDeps())
    await httpRequestNodeExecutor.execute(input)
    expect(input.agentDeps.sendToAgent).not.toHaveBeenCalled()
  })

  it("logs diagnostics without raw url or body", async () => {
    const secretUrl = "https://example.com/api?token=sk-secret"
    const deps = fakeRuntimeDeps()
    await httpRequestNodeExecutor.execute(makeInput({ url: secretUrl }, deps))

    const payload = JSON.stringify(logger.info.mock.calls)
    expect(payload).not.toContain("sk-secret")
    expect(logger.info).toHaveBeenCalledWith("http request node executing", expect.objectContaining({
      method: "GET",
      urlLength: expect.any(Number),
    }))
  })
})
