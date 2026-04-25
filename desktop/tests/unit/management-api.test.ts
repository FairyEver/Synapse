import { describe, expect, it } from "vitest"
import { createNetworkServiceRegistry } from "../../electron/runtime/network"
import { ManagementApiService } from "../../electron/services/management-api-service"

describe("management API service", () => {
  it("registers as a bearer-protected local network descriptor", async () => {
    const service = new ManagementApiService({ tokenSecretRef: "secret:management" })
    const registry = createNetworkServiceRegistry({ probePort: async () => true })

    await expect(registry.register(service.createNetworkDescriptor())).resolves.toEqual({
      id: "management-api",
      port: 9820,
      bindAddress: "127.0.0.1",
    })
    expect(service.createNetworkDescriptor().auth).toEqual({
      kind: "bearer",
      tokenSecretRef: "secret:management",
    })
  })

  it("authenticates bearer and query token without exposing token in status", async () => {
    const service = new ManagementApiService({
      tokenValue: "secret-token",
      version: "1.2.3",
      startedAt: new Date(Date.now() - 10_000),
      projects: () => [{
        name: "demo",
        agentType: "codex",
        platforms: ["telegram"],
        sessionsCount: 2,
        heartbeatEnabled: true,
      }],
    })

    await expect(service.handle({ method: "GET", path: "/api/v1/status" })).resolves.toMatchObject({
      statusCode: 401,
      body: { ok: false, error: "unauthorized: missing or invalid token" },
    })
    await expect(service.handle({
      method: "GET",
      path: "/api/v1/status",
      headers: { Authorization: "Bearer wrong" },
    })).resolves.toMatchObject({ statusCode: 401 })

    const response = await service.handle({
      method: "GET",
      path: "/api/v1/status",
      headers: { Authorization: "Bearer secret-token" },
    })
    expect(response).toMatchObject({
      statusCode: 200,
      body: {
        ok: true,
        data: {
          version: "1.2.3",
          connected_platforms: ["telegram"],
          projects_count: 1,
          token_set: true,
        },
      },
    })
    expect(JSON.stringify(response.body)).not.toContain("secret-token")

    await expect(service.handle({
      method: "GET",
      path: "/api/v1/status",
      query: { token: "secret-token" },
    })).resolves.toMatchObject({ statusCode: 200 })
  })

  it("allows no-token mode and returns projects in CC management shape", async () => {
    const service = new ManagementApiService({
      projects: () => [{
        name: "demo",
        agentType: "codex",
        platforms: ["telegram", "slack"],
        sessionsCount: 3,
      }],
    })

    await expect(service.handle({ method: "GET", path: "/api/v1/projects" })).resolves.toEqual({
      statusCode: 200,
      body: {
        ok: true,
        data: {
          projects: [{
            name: "demo",
            agent_type: "codex",
            platforms: ["telegram", "slack"],
            sessions_count: 3,
            heartbeat_enabled: false,
          }],
        },
      },
    })
  })

  it("handles restart, reload, method errors, and not found without starting a server", async () => {
    const calls: unknown[] = []
    const service = new ManagementApiService({
      restart: (input) => {
        calls.push(input)
      },
      reload: () => ["demo"],
    })

    await expect(service.handle({
      method: "POST",
      path: "/api/v1/restart",
      body: { session_key: "telegram:1:2", platform: "telegram" },
    })).resolves.toEqual({
      statusCode: 200,
      body: { ok: true, data: { message: "restart initiated" } },
    })
    expect(calls).toEqual([{ sessionKey: "telegram:1:2", platform: "telegram" }])

    await expect(service.handle({ method: "POST", path: "/api/v1/reload" })).resolves.toEqual({
      statusCode: 200,
      body: {
        ok: true,
        data: {
          message: "config reloaded",
          projects_updated: ["demo"],
        },
      },
    })
    await expect(service.handle({ method: "POST", path: "/api/v1/status" })).resolves.toMatchObject({
      statusCode: 405,
      body: { ok: false, error: "GET only" },
    })
    await expect(service.handle({ method: "GET", path: "/api/v1/missing" })).resolves.toMatchObject({
      statusCode: 404,
      body: { ok: false, error: "not found" },
    })
  })

  it("surfaces restart and reload failures as JSON errors", async () => {
    const service = new ManagementApiService({
      restart: () => {
        throw new Error("restart failed")
      },
      reload: () => {
        throw new Error("reload demo: invalid config")
      },
    })

    await expect(service.handle({ method: "POST", path: "/api/v1/restart" })).resolves.toMatchObject({
      statusCode: 500,
      body: { ok: false, error: "restart failed" },
    })
    await expect(service.handle({ method: "POST", path: "/api/v1/reload" })).resolves.toMatchObject({
      statusCode: 500,
      body: { ok: false, error: "reload demo: invalid config" },
    })
  })
})
