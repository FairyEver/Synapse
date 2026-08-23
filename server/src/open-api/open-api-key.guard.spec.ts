import { describe, expect, it, vi } from "vitest"
import { OpenApiKeyGuard } from "./open-api-key.guard"

describe("OpenApiKeyGuard", () => {
  it("accepts one Bearer API key and projects a minimal principal", async () => {
    const apiKeys = {
      verifyOpenApiSecret: vi.fn().mockResolvedValue({
        userId: "user-1",
        apiKeyId: "key-1",
        scopes: ["drive.share_link.download"],
      }),
      touchLastUsed: vi.fn().mockResolvedValue(undefined),
    }
    const request: Record<string, unknown> = {
      headers: { authorization: "Bearer syn_sk_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" },
    }
    const guard = new OpenApiKeyGuard(apiKeys as never)

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.openApiPrincipal).toEqual({
      userId: "user-1",
      apiKeyId: "key-1",
      scopes: ["drive.share_link.download"],
    })
    expect(apiKeys.touchLastUsed).toHaveBeenCalledWith("key-1")
  })

  it("returns the same public error for missing and unknown keys", async () => {
    const apiKeys = {
      verifyOpenApiSecret: vi.fn().mockResolvedValue(null),
      touchLastUsed: vi.fn(),
    }
    const guard = new OpenApiKeyGuard(apiKeys as never)

    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_API_KEY",
    })
    await expect(guard.canActivate(contextFor({ headers: { authorization: "Bearer unknown" } }))).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_API_KEY",
    })
  })
})

function contextFor(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never
}
