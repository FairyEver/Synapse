import { describe, expect, it, vi } from "vitest"
import { LicenseClient, LicenseClientRequestError } from "../license/license-client"

describe("LicenseClient", () => {
  it("preserves server activation error codes", async () => {
    const client = new LicenseClient({
      permissionGuard: { check: vi.fn().mockResolvedValue({ allowed: true }) },
      auditSink: { record: vi.fn() },
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: "ACTIVATION_RISK_LOCKED",
        message: "激活码暂不可用，请联系管理员。",
      }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })),
    } as never)

    await expect(client.redeem("http://localhost:3000", {
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: {
        deviceId: "device-1",
        name: "MacBook",
        platform: "darwin",
        appVersion: "0.2.54",
      },
    })).rejects.toMatchObject({
      code: "ACTIVATION_RISK_LOCKED",
      message: "激活码暂不可用，请联系管理员。",
    } satisfies Partial<LicenseClientRequestError>)
  })

  it("logs failed license HTTP status with sanitized request metadata", async () => {
    const logger = { warn: vi.fn(), error: vi.fn() }
    const client = new LicenseClient({
      permissionGuard: { check: vi.fn().mockResolvedValue({ allowed: true }) },
      auditSink: { record: vi.fn() },
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: "NOPE",
        message: "failed",
      }), {
        status: 500,
        statusText: "Server Error",
        headers: { "content-type": "application/json" },
      })),
      logger,
    } as never)

    await expect(client.renew("http://localhost:3000?token=secret", {
      leaseToken: "lease-secret",
      device: {
        deviceId: "device-1",
        name: "MacBook",
        platform: "darwin",
        appVersion: "0.2.54",
      },
    })).rejects.toThrow("failed")

    expect(logger.warn).toHaveBeenCalledWith(
      "License HTTP request failed.",
      expect.objectContaining({
        path: "/v1/licenses/renew",
        status: 500,
        statusText: "Server Error",
        url: "http://localhost:3000/v1/licenses/renew",
      }),
    )
  })
})
