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
})
