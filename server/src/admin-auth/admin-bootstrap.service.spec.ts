import { describe, expect, it, vi } from "vitest"
import { AdminBootstrapService } from "./admin-bootstrap.service"

function createPrismaMock(existingAdmin: unknown = null) {
  return {
    adminUser: {
      findFirst: vi.fn().mockResolvedValue(existingAdmin),
      create: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com" }),
    },
  }
}

describe("AdminBootstrapService", () => {
  it("creates the first administrator from env", async () => {
    const prisma = createPrismaMock()
    const service = new AdminBootstrapService(prisma as never, {
      adminEmail: "Admin@Example.com",
      adminPassword: "StrongPassword123!",
    })

    await service.onApplicationBootstrap()

    expect(prisma.adminUser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "admin@example.com" }),
    })
  })

  it("does not overwrite an existing administrator", async () => {
    const prisma = createPrismaMock({ id: "admin-1", email: "old@example.com" })
    const service = new AdminBootstrapService(prisma as never, {
      adminEmail: "new@example.com",
      adminPassword: "StrongPassword123!",
    })

    await service.onApplicationBootstrap()

    expect(prisma.adminUser.create).not.toHaveBeenCalled()
  })
})
