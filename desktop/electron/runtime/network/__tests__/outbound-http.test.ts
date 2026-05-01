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
})
