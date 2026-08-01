import { describe, expect, it, vi } from "vitest"
import { AdminAuthService, adminSessionMaxAgeMs } from "./admin-auth.service"

const accessSecret = "Qv2jY7mD9kL4sN8pR3tW6xZ1cF5hJ0uB7eG2iM9oK4A"

describe("AdminAuthService", () => {
  it("creates an opaque eight-hour session without storing the raw token", async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({ id: "session-1", expiresAt: data.expiresAt }))
    const service = new AdminAuthService({ adminSession: { create } } as never, { accessSecret })

    const result = await service.createSession(accessSecret, "127.0.0.1")

    expect(result?.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tokenHash: expect.not.stringContaining(result!.token),
        ipAddress: "127.0.0.1",
      }),
    }))
    expect(result!.session.expiresAt.getTime()).toBeGreaterThan(Date.now() + adminSessionMaxAgeMs - 1000)
  })

  it("returns the same generic failure for an invalid secret without creating a session", async () => {
    const create = vi.fn()
    const service = new AdminAuthService({ adminSession: { create } } as never, { accessSecret })

    await expect(service.createSession("not-the-secret", "127.0.0.1")).resolves.toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it("invalidates persisted sessions when the access secret rotates", async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({ id: "session-1", expiresAt: data.expiresAt }))
    const findUnique = vi.fn().mockResolvedValue(null)
    const prisma = { adminSession: { create, findUnique } }
    const original = new AdminAuthService(prisma as never, { accessSecret })
    const created = await original.createSession(accessSecret, "127.0.0.1")
    const rotated = new AdminAuthService(prisma as never, {
      accessSecret: "Zp8xC2vB6nM1aS5dF9gH3jK7lQ4wE0rT6yU2iO8pL5N",
    })

    await expect(rotated.verifySession(created!.token)).resolves.toEqual({ status: "invalid" })
    expect(findUnique).toHaveBeenCalledOnce()
  })

  it("keeps revoked and expired rows for seven days before cleanup", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 })
    const service = new AdminAuthService({ adminSession: { deleteMany } } as never, { accessSecret })

    await service.cleanupExpiredSessions()

    expect(deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: { lt: expect.any(Date) } }, { revokedAt: { lt: expect.any(Date) } }] },
    })
  })
})
