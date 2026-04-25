import { describe, expect, it } from "vitest"
import { createNetworkServiceRegistry } from "../../electron/runtime/network"
import { WebhookService } from "../../electron/services/webhook-service"

describe("webhook service", () => {
  it("uses CC Connect defaults and normalizes path before network registration", async () => {
    const service = new WebhookService({ path: "hook", tokenSecretRef: "secret:webhook" })
    const registry = createNetworkServiceRegistry({ probePort: async () => true })

    const binding = await registry.register(service.createNetworkDescriptor())

    expect(service.port).toBe(9111)
    expect(service.path).toBe("/hook")
    expect(binding).toEqual({ id: "connectors.webhook", port: 9111, bindAddress: "127.0.0.1" })
    expect(service.createNetworkDescriptor().auth).toEqual({
      kind: "bearer",
      tokenSecretRef: "secret:webhook",
    })
  })

  it("authenticates Bearer, X-Webhook-Token, and query token without exposing raw token in delivery", () => {
    const service = new WebhookService({ tokenValue: "my-secret" })

    expect(service.authenticate({ authorization: "Bearer my-secret" })).toBe(true)
    expect(service.authenticate({ webhookToken: "my-secret" })).toBe(true)
    expect(service.authenticate({ queryToken: "my-secret" })).toBe(true)
    expect(service.authenticate({ authorization: "Bearer wrong" })).toBe(false)

    const result = service.handle({
      method: "POST",
      auth: { authorization: "Bearer my-secret" },
      body: {
        session_key: "telegram:123:123",
        prompt: "review latest commit",
        event: "git:commit",
        payload: { commit: "abc" },
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error)
    }
    expect(result.delivery).toMatchObject({
      id: "webhook-1",
      event: "git:commit",
      sessionKey: "telegram:123:123",
      action: "prompt",
      requiresPermission: false,
    })
    expect(JSON.stringify(result.delivery)).not.toContain("my-secret")
    expect(result.delivery.payloadDigest).toHaveLength(64)
  })

  it("rejects method, auth, missing session, missing action, and prompt/exec conflicts like CC Connect", () => {
    const service = new WebhookService({ tokenValue: "secret" })

    expect(service.handle({ method: "GET" })).toMatchObject({ ok: false, statusCode: 405, error: "POST only" })
    expect(service.handle({
      method: "POST",
      body: { session_key: "tg:1:1", prompt: "hi" },
    })).toMatchObject({ ok: false, statusCode: 401, error: "unauthorized" })

    const authed = { authorization: "Bearer secret" }
    expect(service.handle({
      method: "POST",
      auth: authed,
      body: { prompt: "hi" },
    })).toMatchObject({ ok: false, statusCode: 400, error: "session_key is required" })
    expect(service.handle({
      method: "POST",
      auth: authed,
      body: { session_key: "tg:1:1" },
    })).toMatchObject({ ok: false, statusCode: 400, error: "either prompt or exec is required" })
    expect(service.handle({
      method: "POST",
      auth: authed,
      body: { session_key: "tg:1:1", prompt: "hi", exec: "ls" },
    })).toMatchObject({ ok: false, statusCode: 400, error: "prompt and exec are mutually exclusive" })
  })

  it("marks exec webhook deliveries as permission-gated without running shell commands", () => {
    const service = new WebhookService({
      now: () => new Date("2026-04-26T00:30:00.000Z"),
    })

    const result = service.handle({
      method: "POST",
      body: {
        session_key: "telegram:123:123",
        exec: "git log -3 --oneline",
        event: "git:push",
        work_dir: "/repo",
        silent: true,
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error)
    }
    expect(result.statusCode).toBe(202)
    expect(result.body).toEqual({
      status: "accepted",
      event: "git:push",
      deliveryId: "webhook-1",
    })
    expect(result.delivery).toMatchObject({
      action: "exec",
      acceptedAt: "2026-04-26T00:30:00.000Z",
      silent: true,
      requiresPermission: true,
    })
  })
})
