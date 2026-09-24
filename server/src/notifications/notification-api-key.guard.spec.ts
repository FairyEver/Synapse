import { describe, expect, it, vi } from "vitest"
import { NotificationApiKeyGuard } from "./notification-api-key.guard"

function guard() {
  const principal = { userId: "user-1", apiKeyId: "key-1", scopes: ["notification.send"] }
  const apiKeys = {
    verifyOpenApiSecret: vi.fn(async () => principal),
    touchLastUsed: vi.fn(async () => undefined),
  }
  return { guard: new NotificationApiKeyGuard(apiKeys as never), apiKeys }
}

function context(request: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never
}

describe("NotificationApiKeyGuard", () => {
  it("reads the key from the path segment even when the body also carries one", async () => {
    const { guard: endpoint, apiKeys } = guard()
    const request: Record<string, unknown> = { params: { key: "syn_sk_path" }, body: { key: "syn_sk_body" } }

    await expect(endpoint.canActivate(context(request))).resolves.toBe(true)
    expect(apiKeys.verifyOpenApiSecret).toHaveBeenCalledWith("syn_sk_path")
    expect(request.openApiPrincipal).toMatchObject({ apiKeyId: "key-1" })
    expect(apiKeys.touchLastUsed).toHaveBeenCalledWith("key-1")
  })

  it("reads the key from the request body when the path has none", async () => {
    const { guard: endpoint, apiKeys } = guard()
    await expect(endpoint.canActivate(context({ params: {}, body: { key: "syn_sk_body" } }))).resolves.toBe(true)
    expect(apiKeys.verifyOpenApiSecret).toHaveBeenCalledWith("syn_sk_body")
  })

  it("rejects a request that carries no key at all without querying the key store", async () => {
    const { guard: endpoint, apiKeys } = guard()
    await expect(endpoint.canActivate(context({ params: {}, body: {} }))).rejects.toMatchObject({ statusCode: 401 })
    await expect(endpoint.canActivate(context({}))).rejects.toMatchObject({ statusCode: 401 })
    expect(apiKeys.verifyOpenApiSecret).not.toHaveBeenCalled()
  })
})
