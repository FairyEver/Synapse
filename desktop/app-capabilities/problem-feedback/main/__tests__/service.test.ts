import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ProblemFeedbackService,
  resolveProblemFeedbackEndpoint,
} from "../service"

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

describe("ProblemFeedbackService", () => {
  it("accepts only HTTPS or development loopback HTTP endpoints", () => {
    expect(resolveProblemFeedbackEndpoint("https://synapse.example/api", false)?.href)
      .toBe("https://synapse.example/api/problem-feedback")
    expect(resolveProblemFeedbackEndpoint("http://127.0.0.1:3000/api", true)?.href)
      .toBe("http://127.0.0.1:3000/api/problem-feedback")
    expect(resolveProblemFeedbackEndpoint("http://192.168.1.2/api", true)).toBeNull()
    expect(resolveProblemFeedbackEndpoint("http://localhost/api", false)).toBeNull()
    expect(resolveProblemFeedbackEndpoint("https://user:secret@synapse.example/api", false))
      .toBeNull()
  })

  it("sends one anonymous request with the exact content", async () => {
    let requests = 0
    let receivedHeaders: Record<string, string | string[] | undefined> = {}
    let receivedBody = ""
    const apiBaseUrl = await listen((request, response) => {
      requests += 1
      receivedHeaders = request.headers
      request.setEncoding("utf8")
      request.on("data", (chunk) => {
        receivedBody += chunk
      })
      request.on("end", () => {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        })
        response.end('{"success":true}')
      })
    })
    const content = "场景：合成测试。\n实际情况：结果不符。"
    const service = new ProblemFeedbackService(apiBaseUrl, {
      allowDevelopmentLoopbackHttp: true,
    })

    await expect(service.submit(content)).resolves.toEqual({
      ok: true,
      data: { success: true },
    })
    expect(requests).toBe(1)
    expect(receivedBody).toBe(JSON.stringify({ content }))
    expect(receivedHeaders.authorization).toBeUndefined()
    expect(receivedHeaders.cookie).toBeUndefined()
    expect(receivedHeaders.origin).toBeUndefined()
    expect(receivedHeaders.referer).toBeUndefined()
    expect(receivedHeaders["user-agent"]).toBeUndefined()
    expect(receivedHeaders["accept-language"]).toBeUndefined()
    expect(receivedHeaders["sec-fetch-mode"]).toBeUndefined()
    expect(receivedHeaders["accept-encoding"]).toBeUndefined()
  })

  it("maps only strict documented responses", async () => {
    const apiBaseUrl = await listen((_request, response) => {
      response.writeHead(422, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      response.end('{"code":"PRIVACY_RISK","data":{"category":"local_path"}}')
    })
    const service = new ProblemFeedbackService(apiBaseUrl, {
      allowDevelopmentLoopbackHttp: true,
    })

    await expect(service.submit("synthetic")).resolves.toEqual({
      ok: false,
      code: "PRIVACY_RISK",
      data: { category: "local_path" },
    })
  })

  it.each([
    [
      400,
      '{"code":"INVALID_INPUT","data":{"field":"content","reason":"too_large"}}',
      { ok: false, code: "INVALID_INPUT", data: { field: "content", reason: "too_large" } },
    ],
    [429, '{"code":"RATE_LIMITED"}', { ok: false, code: "RATE_LIMITED" }],
    [503, '{"code":"SUBMISSION_FAILED"}', { ok: false, code: "SUBMISSION_FAILED" }],
    [
      200,
      '{"success":true,"recordId":"synthetic"}',
      { ok: false, code: "SUBMISSION_OUTCOME_UNKNOWN" },
    ],
    [401, '{"code":"SUBMISSION_FAILED"}', { ok: false, code: "SUBMISSION_OUTCOME_UNKNOWN" }],
  ] as const)("maps HTTP %s with a strict finite body", async (status, body, expected) => {
    const apiBaseUrl = await listen((_request, response) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      response.end(body)
    })
    const service = new ProblemFeedbackService(apiBaseUrl, {
      allowDevelopmentLoopbackHttp: true,
    })

    await expect(service.submit("synthetic")).resolves.toEqual(expected)
  })

  it("treats oversized or non-JSON responses as unknown", async () => {
    const apiBaseUrl = await listen((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      response.end("x".repeat(16 * 1024 + 1))
    })
    const service = new ProblemFeedbackService(apiBaseUrl, {
      allowDevelopmentLoopbackHttp: true,
    })

    await expect(service.submit("synthetic")).resolves.toEqual({
      ok: false,
      code: "SUBMISSION_OUTCOME_UNKNOWN",
    })
  })

  it("does not follow redirects and reports an unknown outcome", async () => {
    let requests = 0
    const apiBaseUrl = await listen((_request, response) => {
      requests += 1
      response.writeHead(307, {
        Location: "/api/elsewhere",
        "Content-Type": "application/json",
      })
      response.end('{"code":"SUBMISSION_FAILED"}')
    })
    const service = new ProblemFeedbackService(apiBaseUrl, {
      allowDevelopmentLoopbackHttp: true,
    })

    await expect(service.submit("synthetic")).resolves.toEqual({
      ok: false,
      code: "SUBMISSION_OUTCOME_UNKNOWN",
    })
    expect(requests).toBe(1)
  })

  it("does not start a request when already cancelled", async () => {
    const requestPort = vi.fn()
    const controller = new AbortController()
    controller.abort()
    const service = new ProblemFeedbackService("https://synapse.example/api", {
      allowDevelopmentLoopbackHttp: false,
      request: requestPort,
    })

    await expect(service.submit("synthetic", controller.signal)).resolves.toEqual({
      ok: false,
      code: "SUBMISSION_FAILED",
    })
    expect(requestPort).not.toHaveBeenCalled()
  })

  it("distinguishes a proven connect failure from an in-flight timeout", async () => {
    const connectFailure = new TypeError("fetch failed", {
      cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
    })
    const failedService = new ProblemFeedbackService("https://synapse.example/api", {
      allowDevelopmentLoopbackHttp: false,
      request: vi.fn().mockRejectedValue(connectFailure),
    })
    await expect(failedService.submit("synthetic")).resolves.toEqual({
      ok: false,
      code: "SUBMISSION_FAILED",
    })

    const timeoutService = new ProblemFeedbackService("https://synapse.example/api", {
      allowDevelopmentLoopbackHttp: false,
      timeoutMs: 1,
      request: vi.fn((_endpoint, _body, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        })
      })),
    })
    await expect(timeoutService.submit("synthetic")).resolves.toEqual({
      ok: false,
      code: "SUBMISSION_OUTCOME_UNKNOWN",
    })
  })
})

async function listen(
  handler: Parameters<typeof createServer>[0],
): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Test server did not bind.")
  return `http://127.0.0.1:${address.port}/api`
}
