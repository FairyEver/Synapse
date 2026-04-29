import { ForbiddenException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { LicensesController } from "./licenses.controller"

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
})
