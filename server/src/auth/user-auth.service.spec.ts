import { UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "./password"
import { UserAuthService } from "./user-auth.service"

function createPrismaMock() {
  return {
    $transaction: vi.fn((callback) => callback({
      user: {
        create: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com", status: "active" }),
      },
      userSession: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
      },
    })),
    user: {
      findUnique: vi.fn(),
    },
    userSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  }
}

describe("UserAuthService", () => {
  it("rejects login for unknown users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
    )

    await expect(service.login({ email: "missing@example.com", password: "x" }))
      .rejects
      .toThrow(UnauthorizedException)
  })

  it("rejects disabled users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      passwordHash: await hashPassword("StrongPassword123!"),
      status: "disabled",
    })
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
    )

    await expect(service.login({ email: "u@example.com", password: "StrongPassword123!" }))
      .rejects
      .toThrow("账号已停用。")
  })
})
