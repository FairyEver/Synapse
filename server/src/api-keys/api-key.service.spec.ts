import { BadRequestException, NotFoundException } from "@nestjs/common"
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
        scopes: ["drive.public_link.download"],
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
      scopes: ["drive.public_link.download"],
    }, "203.0.113.10")
    const createInput = transactionApiKey.create.mock.calls[0]?.[0]

    expect(result.secret).toMatch(/^syn_sk_[A-Za-z0-9_-]{43}$/u)
    expect(result.apiKey).toEqual({
      id: "key-1",
      name: "CLI",
      prefix: result.secret.slice(0, 15),
      scopes: ["drive.public_link.download"],
      lastUsedAt: null,
      createdAt: createdAt.toISOString(),
    })
    expect(createInput?.data).toEqual({
      userId: "user-1",
      name: "CLI",
      keyHash: hashApiKeySecret(result.secret),
      keyPrefix: result.secret.slice(0, 15),
      scopes: ["drive.public_link.download"],
    })
    expect(JSON.stringify(createInput)).not.toContain(result.secret)
    expect(auditLog.recordWithClient).toHaveBeenCalledWith(expect.anything(), {
      adminEmail: "user-1",
      action: "api_key.create",
      targetType: "api_key",
      targetId: "key-1",
      detail: { name: "CLI", scopes: ["drive.public_link.download"] },
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

  it("updates scopes for an active key owned by the current user without rotating it", async () => {
    const { service, transactionApiKey, auditLog } = createService()
    transactionApiKey.findFirst.mockResolvedValue({
      id: "key-1",
      name: "开发环境",
      keyPrefix: "syn_sk_abcdefgh",
      scopes: ["drive.public_link.download"],
      lastUsedAt: null,
      createdAt,
    })
    transactionApiKey.updateMany.mockResolvedValue({ count: 1 })

    await expect(service.updateScopesForUser("user-1", "key-1", {
      scopes: [],
    }, "203.0.113.12")).resolves.toEqual({
      id: "key-1",
      name: "开发环境",
      prefix: "syn_sk_abcdefgh",
      scopes: [],
      lastUsedAt: null,
      createdAt: createdAt.toISOString(),
    })
    expect(transactionApiKey.findFirst).toHaveBeenCalledWith({
      where: { id: "key-1", userId: "user-1", revokedAt: null },
      select: expect.objectContaining({ scopes: true }),
    })
    expect(transactionApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: "key-1", userId: "user-1", revokedAt: null },
      data: { scopes: [] },
    })
    expect(auditLog.recordWithClient).toHaveBeenCalledWith(expect.anything(), {
      adminEmail: "user-1",
      action: "api_key.update",
      targetType: "api_key",
      targetId: "key-1",
      detail: {
        name: "开发环境",
        previousScopes: ["drive.public_link.download"],
        scopes: [],
      },
      ipAddress: "203.0.113.12",
    })
    expect(JSON.stringify(auditLog.recordWithClient.mock.calls)).not.toContain("keyHash")
  })

  it("renames an active key owned by the current user without changing its secret or scopes", async () => {
    const { service, transactionApiKey, auditLog } = createService()
    transactionApiKey.findFirst.mockResolvedValue({
      id: "key-1",
      name: "开发环境",
      keyPrefix: "syn_sk_abcdefgh",
      scopes: ["drive.public_link.download"],
      lastUsedAt: null,
      createdAt,
    })
    transactionApiKey.updateMany.mockResolvedValue({ count: 1 })

    await expect(service.renameForUser("user-1", "key-1", {
      name: " 生产环境 ",
    }, "203.0.113.13")).resolves.toEqual({
      id: "key-1",
      name: "生产环境",
      prefix: "syn_sk_abcdefgh",
      scopes: ["drive.public_link.download"],
      lastUsedAt: null,
      createdAt: createdAt.toISOString(),
    })
    expect(transactionApiKey.findFirst).toHaveBeenCalledWith({
      where: { id: "key-1", userId: "user-1", revokedAt: null },
      select: expect.objectContaining({ name: true, keyPrefix: true, scopes: true }),
    })
    expect(transactionApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: "key-1", userId: "user-1", revokedAt: null },
      data: { name: "生产环境" },
    })
    expect(auditLog.recordWithClient).toHaveBeenCalledWith(expect.anything(), {
      adminEmail: "user-1",
      action: "api_key.rename",
      targetType: "api_key",
      targetId: "key-1",
      detail: {
        previousName: "开发环境",
        name: "生产环境",
      },
      ipAddress: "203.0.113.13",
    })
    expect(JSON.stringify(auditLog.recordWithClient.mock.calls)).not.toContain("keyHash")
  })

  it("does not rename a missing, revoked, or other-user key", async () => {
    const { service, transactionApiKey, auditLog } = createService()
    transactionApiKey.findFirst.mockResolvedValue(null)

    await expect(service.renameForUser("user-1", "key-2", { name: "生产环境" }))
      .rejects.toBeInstanceOf(NotFoundException)
    expect(transactionApiKey.updateMany).not.toHaveBeenCalled()
    expect(auditLog.recordWithClient).not.toHaveBeenCalled()
  })

  it("rejects invalid names at the service boundary", async () => {
    const { service, transactionApiKey } = createService()

    await expect(service.renameForUser("user-1", "key-1", { name: " " }))
      .rejects.toBeInstanceOf(BadRequestException)
    await expect(service.renameForUser("user-1", "key-1", { name: "a".repeat(81) }))
      .rejects.toBeInstanceOf(BadRequestException)
    expect(transactionApiKey.findFirst).not.toHaveBeenCalled()
  })

  it("does not update a missing, revoked, or other-user key", async () => {
    const { service, transactionApiKey, auditLog } = createService()
    transactionApiKey.findFirst.mockResolvedValue(null)

    await expect(service.updateScopesForUser("user-1", "key-2", { scopes: [] }))
      .rejects.toBeInstanceOf(NotFoundException)
    expect(transactionApiKey.updateMany).not.toHaveBeenCalled()
    expect(auditLog.recordWithClient).not.toHaveBeenCalled()
  })

  it("rejects invalid scope updates at the service boundary", async () => {
    const { service } = createService()

    await expect(service.updateScopesForUser("user-1", "key-1", {
      scopes: ["unknown"] as never,
    })).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.updateScopesForUser("user-1", "key-1", {
      scopes: ["drive.public_link.download", "drive.public_link.download"],
    })).rejects.toBeInstanceOf(BadRequestException)
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
      scopes: ["drive.public_link.download"],
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
    findFirst: vi.fn(),
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
