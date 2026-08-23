import { NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { hashApiKeySecret } from "./api-key-token"
import { ApiKeyService } from "./api-key.service"

const createdAt = new Date("2026-08-21T08:00:00.000Z")

describe("ApiKeyService", () => {
  it("lists only active API keys owned by the current user", async () => {
    const { service, prisma } = createService()
    prisma.userApiKey.findMany.mockResolvedValue([
      { id: "key-1", name: "开发环境", keyPrefix: "syn_sk_abcdefgh", scopes: ["drive.share_link.download"], lastUsedAt: null, createdAt },
    ])

    await expect(service.listForUser("user-1")).resolves.toEqual([
      {
        id: "key-1",
        name: "开发环境",
        prefix: "syn_sk_abcdefgh",
        scopes: ["drive.share_link.download"],
        lastUsedAt: null,
        createdAt: createdAt.toISOString(),
      },
    ])
    expect(prisma.userApiKey.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        createdAt: true,
      },
    })
  })

  it("stores only the digest and returns plaintext once on creation", async () => {
    const { service, transactionApiKey, auditLog } = createService()
    transactionApiKey.create.mockImplementation(async ({ data }) => ({
      id: "key-1",
      name: data.name,
      keyPrefix: data.keyPrefix,
      scopes: data.scopes,
      lastUsedAt: null,
      createdAt,
    }))

    const result = await service.createForUser("user-1", {
      name: "CLI",
      scopes: ["drive.share_link.download"],
    }, "203.0.113.10")
    const createInput = transactionApiKey.create.mock.calls[0]?.[0]

    expect(result.secret).toMatch(/^syn_sk_[A-Za-z0-9_-]{43}$/u)
    expect(result.apiKey).toEqual({
      id: "key-1",
      name: "CLI",
      prefix: result.secret.slice(0, 15),
      scopes: ["drive.share_link.download"],
      lastUsedAt: null,
      createdAt: createdAt.toISOString(),
    })
    expect(createInput?.data).toEqual({
      userId: "user-1",
      name: "CLI",
      keyHash: hashApiKeySecret(result.secret),
      keyPrefix: result.secret.slice(0, 15),
      scopes: ["drive.share_link.download"],
    })
    expect(JSON.stringify(createInput)).not.toContain(result.secret)
    expect(auditLog.recordWithClient).toHaveBeenCalledWith(expect.anything(), {
      adminEmail: "user-1",
      action: "api_key.create",
      targetType: "api_key",
      targetId: "key-1",
      detail: { name: "CLI", scopes: ["drive.share_link.download"] },
      ipAddress: "203.0.113.10",
    })
    expect(JSON.stringify(auditLog.recordWithClient.mock.calls)).not.toContain(result.secret)
  })

  it("revokes only an active key owned by the current user", async () => {
    const { service, transactionApiKey, auditLog } = createService()
    transactionApiKey.updateMany.mockResolvedValue({ count: 1 })

    await expect(service.revokeForUser("user-1", "key-1", "203.0.113.11"))
      .resolves.toEqual({ ok: true })

    expect(transactionApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: "key-1", userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(auditLog.recordWithClient).toHaveBeenCalledWith(expect.anything(), {
      adminEmail: "user-1",
      action: "api_key.revoke",
      targetType: "api_key",
      targetId: "key-1",
      ipAddress: "203.0.113.11",
    })
  })

  it("does not revoke a missing or other-user key", async () => {
    const { service, transactionApiKey, auditLog } = createService()
    transactionApiKey.updateMany.mockResolvedValue({ count: 0 })

    await expect(service.revokeForUser("user-1", "key-2"))
      .rejects.toBeInstanceOf(NotFoundException)
    expect(auditLog.recordWithClient).not.toHaveBeenCalled()
  })

  it("verifies only active API keys owned by active users", async () => {
    const { service, prisma } = createService()
    prisma.userApiKey.findUnique.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      scopes: ["drive.share_link.download"],
      revokedAt: null,
      user: { status: "active" },
    })

    const secret = "syn_sk_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
    await expect(service.verifyOpenApiSecret(secret)).resolves.toEqual({
      userId: "user-1",
      apiKeyId: "key-1",
      scopes: ["drive.share_link.download"],
    })
    expect(prisma.userApiKey.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { keyHash: hashApiKeySecret(secret) },
    }))
    await expect(service.verifyOpenApiSecret("not-a-key")).resolves.toBeNull()
  })

  it("coalesces last-used writes into five-minute windows", async () => {
    const { service, prisma } = createService()
    prisma.userApiKey.updateMany.mockResolvedValue({ count: 1 })
    const now = new Date("2026-08-23T09:05:00.000Z")

    await service.touchLastUsed("key-1", now)

    expect(prisma.userApiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: "key-1",
        revokedAt: null,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date("2026-08-23T09:00:00.000Z") } },
        ],
      },
      data: { lastUsedAt: now },
    })
  })
})

function createService() {
  const transactionApiKey = {
    create: vi.fn(),
    updateMany: vi.fn(),
  }
  const transactionClient = { userApiKey: transactionApiKey }
  const prisma = {
    userApiKey: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) => (
      callback(transactionClient)
    )),
  }
  const auditLog = { recordWithClient: vi.fn().mockResolvedValue(undefined) }
  return {
    service: new ApiKeyService(prisma as never, auditLog as never),
    prisma,
    transactionApiKey,
    auditLog,
  }
}
