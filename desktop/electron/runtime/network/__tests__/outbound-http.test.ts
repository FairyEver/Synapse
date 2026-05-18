import { describe, expect, it, vi } from "vitest"

import { sendOutboundHttpRequest } from "../outbound-http"

describe("sendOutboundHttpRequest", () => {
  it("sends method, headers, body, and returns text response", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "text/plain" },
    }))

    const response = await sendOutboundHttpRequest({
      method: "POST",
      url: "https://example.com/api",
      headers: { Authorization: "Bearer token" },
      body: "hello",
      timeoutMs: 1000,
      fetchImpl,
    })

    expect(response).toEqual({
      status: 201,
      statusText: "Created",
      headers: { "content-type": "text/plain" },
      body: "ok",
    })
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/api", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: "hello",
    }))
  })

  it("logs failed responses without sensitive headers", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const fetchImpl = vi.fn(async () => new Response("nope", {
      status: 503,
      statusText: "Service Unavailable",
    }))

    await sendOutboundHttpRequest({
      method: "GET",
      url: "https://example.com/api?token=secret&query=ok",
      headers: { Authorization: "Bearer token", Accept: "application/json" },
      fetchImpl,
      logger,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      "Outbound HTTP request failed.",
      expect.objectContaining({
        method: "GET",
        status: 503,
        statusText: "Service Unavailable",
        url: "https://example.com/api?token=%5BREDACTED%5D&query=ok",
        requestHeaders: { Authorization: "[redacted]", Accept: "application/json" },
      }),
    )
  })

  it("logs network errors and rethrows them", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const failure = new Error("offline")
    const fetchImpl = vi.fn(async () => {
      throw failure
    })

    await expect(sendOutboundHttpRequest({
      method: "POST",
      url: "https://example.com/api",
      fetchImpl,
      logger,
    })).rejects.toThrow("offline")

    expect(logger.error).toHaveBeenCalledWith(
      "Outbound HTTP request errored.",
      expect.objectContaining({
        method: "POST",
        url: "https://example.com/api",
        error: failure,
      }),
    )
  })

  it("throws AbortError when abortSignal is already aborted before request starts", async () => {
    const controller = new AbortController()
    controller.abort()
    let signalWasAborted = false
    const fetchImpl = vi.fn(async (_url: string, opts: { signal: AbortSignal }) => {
      signalWasAborted = opts.signal?.aborted ?? false
      if (opts.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }
      return new Response("ok", { status: 200 })
    })

    await expect(sendOutboundHttpRequest({
      method: "GET",
      url: "https://example.com/api",
      abortSignal: controller.signal,
      fetchImpl,
    })).rejects.toThrow()

    expect(signalWasAborted).toBe(true)
  })
})
