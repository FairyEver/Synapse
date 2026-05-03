import { ForbiddenException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { LicensesController } from "./licenses.controller"
import { ActivationError } from "./license.types"

describe("LicensesController", () => {
  it("maps terminal renewal failures to forbidden responses", async () => {
    const controller = new LicensesController({
      getPublicConfig: vi.fn(),
      redeem: vi.fn(),
      renew: vi.fn().mockRejectedValue(new Error("授权不可用。")),
    } as never)

    await expect(controller.renew({
      leaseToken: "lease-token",
      device: {
        deviceId: "device-1",
        name: "MacBook",
        platform: "darwin",
        appVersion: "0.2.54",
      },
    })).rejects.toThrow(ForbiddenException)
  })

  it("maps activation rate limit errors to coded bad requests", async () => {
    const controller = new LicensesController({
      getPublicConfig: vi.fn(),
      redeem: vi.fn().mockRejectedValue(
        new ActivationError("ACTIVATION_RATE_LIMITED", "尝试过于频繁，请稍后再试。"),
      ),
      renew: vi.fn(),
      validate: vi.fn(),
    } as never)

    await expect(controller.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: {
        deviceId: "device-1",
        name: "MacBook",
        platform: "darwin",
        appVersion: "0.2.54",
      },
    }, {
      ip: "127.0.0.1",
      headers: { "user-agent": "Vitest" },
    } as never)).rejects.toMatchObject({
      response: {
        code: "ACTIVATION_RATE_LIMITED",
        message: "尝试过于频繁，请稍后再试。",
      },
    })
  })

  it("passes request ip and user agent to redeem", async () => {
    const redeem = vi.fn().mockResolvedValue({
      email: "user@example.com",
      deviceIdHash: "device_hash_1",
      leaseToken: "lease-token",
    })
    const controller = new LicensesController({
      getPublicConfig: vi.fn(),
      redeem,
      renew: vi.fn(),
      validate: vi.fn(),
    } as never)

    await controller.redeem({
      email: "user@example.com",
      activationCode: "ABCD-1234",
      device: {
        deviceId: "device-1",
        name: "MacBook",
        platform: "darwin",
        appVersion: "0.2.54",
      },
    }, {
      ip: "127.0.0.1",
      headers: { "user-agent": "Vitest" },
    } as never)

    expect(redeem).toHaveBeenCalledWith(expect.objectContaining({
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
    }))
  })
})
