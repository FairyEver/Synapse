import { describe, expect, it } from "vitest"
import { createNetworkServiceRegistry } from "../../electron/runtime/network"
import { AutomationCronScheduler } from "../../electron/services/automation-cron-service"
import { LocalApiService } from "../../electron/services/local-api-service"
import { RelayService } from "../../electron/services/relay-service"

describe("local API service", () => {
  it("registers through NetworkServiceRegistry without binding raw unix sockets", async () => {
    const service = new LocalApiService({ tokenSecretRef: "secret:local-api" })
    const registry = createNetworkServiceRegistry({ probePort: async () => true })

    await expect(registry.register(service.createNetworkDescriptor())).resolves.toEqual({
      id: "local-api",
      port: 9818,
      bindAddress: "127.0.0.1",
    })
    expect(service.createNetworkDescriptor().auth).toEqual({
      kind: "local-token",
      tokenSecretRef: "secret:local-api",
    })
  })

  it("accepts attachment-only send requests and returns JSON status", async () => {
    const calls: unknown[] = []
    const service = new LocalApiService({
      sendHandler: (request) => {
        calls.push(request)
      },
    })

    await expect(service.handle({
      method: "POST",
      path: "/send",
      body: {
        project: "demo",
        session_key: "telegram:1:2",
        images: [{ mime_type: "image/png", data: "img", file_name: "chart.png" }],
      },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: { status: "ok" },
      contentType: "application/json",
    })
    expect(calls).toEqual([{
      project: "demo",
      sessionKey: "telegram:1:2",
      message: "",
      images: [{ mimeType: "image/png", data: "img", fileName: "chart.png" }],
      files: [],
    }])
  })

  it("rejects wrong methods, invalid JSON shape, empty sends, and send failures", async () => {
    const service = new LocalApiService({
      sendHandler: () => {
        throw new Error("project not found")
      },
    })

    await expect(service.handle({ method: "GET", path: "/send" })).resolves.toMatchObject({ statusCode: 405, body: "POST only" })
    await expect(service.handle({ method: "POST", path: "/send", body: null })).resolves.toMatchObject({ statusCode: 400, body: "invalid JSON: object expected" })
    await expect(service.handle({ method: "POST", path: "/send", body: {} })).resolves.toMatchObject({ statusCode: 400, body: "message or attachment is required" })
    await expect(service.handle({
      method: "POST",
      path: "/send",
      body: { message: "hello" },
    })).resolves.toMatchObject({ statusCode: 500, body: "project not found" })
  })

  it("lists sessions and maps cron endpoints to the automation scheduler", async () => {
    const cron = new AutomationCronScheduler()
    const service = new LocalApiService({
      cron,
      sessions: () => [{ project: "demo", sessionKey: "telegram:1:2", platform: "telegram" }],
    })

    await expect(service.handle({ method: "GET", path: "/sessions" })).resolves.toMatchObject({
      statusCode: 200,
      body: [{ project: "demo", sessionKey: "telegram:1:2", platform: "telegram" }],
    })

    const added = await service.handle({
      method: "POST",
      path: "/cron/add",
      body: {
        id: "cron-1",
        project: "demo",
        session_key: "telegram:1:2",
        cron_expr: "0 9 * * *",
        prompt: "hello",
        description: "daily",
      },
    })
    expect(added.statusCode).toBe(200)
    await expect(service.handle({ method: "GET", path: "/cron/list", query: { project: "demo" } })).resolves.toMatchObject({
      statusCode: 200,
      body: [expect.objectContaining({ id: "cron-1", project: "demo" })],
    })
    await expect(service.handle({ method: "GET", path: "/cron/info", query: { id: "cron-1" } })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ id: "cron-1" }),
    })
    await expect(service.handle({
      method: "POST",
      path: "/cron/edit",
      body: { id: "cron-1", field: "enabled", value: false },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ enabled: false }),
    })
    await expect(service.handle({
      method: "POST",
      path: "/cron/del",
      body: { id: "cron-1" },
    })).resolves.toMatchObject({ statusCode: 200, body: { status: "ok" } })
  })

  it("maps relay endpoints without starting a socket server", async () => {
    const relay = new RelayService()
    relay.registerHandler("beta", () => ({
      status: "completed",
      response: "pong",
      textParts: ["pong"],
      autoApprovedRequestIds: [],
    }))
    const service = new LocalApiService({ relay })

    await expect(service.handle({
      method: "POST",
      path: "/relay/bind",
      body: { platform: "telegram", chat_id: "chat", bots: { alpha: "alpha", beta: "beta" } },
    })).resolves.toMatchObject({ statusCode: 200, body: { status: "ok" } })
    await expect(service.handle({
      method: "POST",
      path: "/relay/send",
      body: { from: "alpha", to: "beta", session_key: "telegram:chat:thread", message: "ping" },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ response: "pong" }),
    })
  })
})
