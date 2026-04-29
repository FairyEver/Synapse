import { describe, expect, it, vi } from "vitest"
import { hashActivationCode } from "../licenses/hash"
import type { PrismaService } from "../prisma/prisma.service"
import { AdminService } from "./admin.service"

describe("AdminService", () => {
  it("creates activation codes with normalized hash and default device count", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "code_1",
      maxDevices: 1,
    })
    const service = new AdminService({
      activationCode: { create },
    } as unknown as PrismaService)

    const result = await service.createActivationCode({
      code: " abcd-1234 ",
      maxDevices: 1,
      expiresAt: null,
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        codeHash: hashActivationCode("ABCD-1234"),
        maxDevices: 1,
        expiresAt: null,
      },
    })
    expect(result).toEqual({
      id: "code_1",
      code: "ABCD-1234",
      maxDevices: 1,
    })
  })
})
