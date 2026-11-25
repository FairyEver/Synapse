import { BadRequestException, NotFoundException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { ApiKeyChangeNotifier } from "./api-key-change-notifier"
import { hashApiKeySecret } from "./api-key-token"
import { ApiKeyService } from "./api-key.service"

const createdAt = new Date("2026-08-21T08:00:00.000Z")

describe("ApiKeyService", () => {
  it.each([true, false])("matches anonymous fallback for existing members when selecting table resources: %s", async anonymousRead => {
    const row = { id: "table", ownerId: "other", members: [{ userId: "user-1", permissions: { read: "none", create: "none", update: "none", delete: "none" } }], anonymous: { read: anonymousRead } }
    const tx = {
      cloudTable: { findMany: vi.fn().mockResolvedValue([row]) },
      userApiKey: { findFirst: vi.fn().mockResolvedValue({ id: "key", name: "CLI", keyPrefix: "syn_sk_test", scopes: [], createdAt, lastUsedAt: null, tableAccessMode: "selected", tableIds: [] }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const service = new ApiKeyService({ $transaction: (work: (client: typeof tx) => unknown) => work(tx) } as never, { recordWithClient: vi.fn() } as never)
    const result = service.updateTableResourcesForUser("user-1", "key", { mode: "selected", tableIds: ["table"] })
    if (anonymousRead) await expect(result).resolves.toMatchObject({ tableResources: { mode: "selected", tableIds: ["table"] } })
    else await expect(result).rejects.toBeInstanceOf(BadRequestException)
  })
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
        tableAccessMode: true,
        tableIds: true,
        channelAccessMode: true,
        channelIds: true,
        stateSyncAccessMode: true,
        stateSyncSpaceIds: true,
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
      tableAccessMode: "selected",
      tableIds: [],
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: [],
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
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: [],
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

  it("validates owned channels and emits change notifications on revoke, scope update, and channel resource update", async () => {
    const notifier = new ApiKeyChangeNotifier()
    const events: unknown[] = []
    notifier.onChange((event) => events.push(event))

    const tx = {
      channel: { findMany: vi.fn() },
      userApiKey: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const service = new ApiKeyService(
      { $transaction: (work: (client: typeof tx) => unknown) => work(tx) } as never,
      { recordWithClient: vi.fn().mockResolvedValue(undefined) } as never,
      undefined,
      notifier,
    )

    tx.channel.findMany.mockResolvedValueOnce([])
    await expect(service.createForUser("user-1", {
      name: "遥控器",
      scopes: ["channels.publish"],
      channelResources: { mode: "selected", channelIds: ["ch_foreign"] },
    })).rejects.toBeInstanceOf(BadRequestException)

    await expect(service.createForUser("user-1", {
      name: "遥控器",
      scopes: ["channels.publish"],
      channelResources: { mode: "all_owned", channelIds: ["ch_1"] },
    })).rejects.toBeInstanceOf(BadRequestException)

    tx.channel.findMany.mockResolvedValueOnce([{ id: "ch_1", ownerId: "user-1" }])
    tx.userApiKey.create.mockImplementationOnce(async ({ data }) => ({
      id: "key-ch-1",
      name: data.name,
      keyPrefix: data.keyPrefix,
      scopes: data.scopes,
      lastUsedAt: null,
      createdAt,
      tableAccessMode: data.tableAccessMode,
      tableIds: data.tableIds,
      channelAccessMode: data.channelAccessMode,
      channelIds: data.channelIds,
    }))
    await expect(service.createForUser("user-1", {
      name: "遥控器",
      scopes: ["channels.publish"],
      channelResources: { mode: "selected", channelIds: ["ch_1"] },
    })).resolves.toMatchObject({
      apiKey: {
        id: "key-ch-1",
        channelResources: { mode: "selected", channelIds: ["ch_1"] },
      },
    })

    tx.channel.findMany.mockResolvedValueOnce([{ id: "ch_1", ownerId: "user-1" }])
    tx.userApiKey.findFirst.mockResolvedValueOnce({
      id: "key-1",
      name: "遥控器",
      keyPrefix: "syn_sk_test",
      scopes: ["channels.publish", "channels.subscribe"],
      lastUsedAt: null,
      createdAt,
      tableAccessMode: "selected",
      tableIds: [],
      channelAccessMode: "selected",
      channelIds: [],
    })
    await expect(service.updateChannelResourcesForUser("user-1", "key-1", {
      mode: "selected",
      channelIds: ["ch_1"],
    })).resolves.toMatchObject({
      channelResources: { mode: "selected", channelIds: ["ch_1"] },
    })

    tx.userApiKey.findFirst.mockResolvedValueOnce({
      id: "key-1",
      name: "遥控器",
      keyPrefix: "syn_sk_test",
      scopes: ["channels.publish", "channels.subscribe"],
      lastUsedAt: null,
      createdAt,
      tableAccessMode: "selected",
      tableIds: [],
      channelAccessMode: "selected",
      channelIds: ["ch_1"],
    })
    await service.updateScopesForUser("user-1", "key-1", { scopes: ["channels.subscribe"] })
    await service.revokeForUser("user-1", "key-1")

    expect(events).toEqual([
      {
        kind: "updated",
        userId: "user-1",
        apiKeyId: "key-1",
        scopes: ["channels.publish", "channels.subscribe"],
        channelAccessMode: "selected",
        channelIds: ["ch_1"],
        stateSyncAccessMode: "selected",
        stateSyncSpaceIds: [],
      },
      {
        kind: "updated",
        userId: "user-1",
        apiKeyId: "key-1",
        scopes: ["channels.subscribe"],
        channelAccessMode: "selected",
        channelIds: ["ch_1"],
        stateSyncAccessMode: "selected",
        stateSyncSpaceIds: [],
      },
      {
        kind: "revoked",
        userId: "user-1",
        apiKeyId: "key-1",
      },
    ])
  })

  it("validates owned state sync spaces and emits change notifications on revoke, scope update, and state sync resource update", async () => {
    const notifier = new ApiKeyChangeNotifier()
    const events: unknown[] = []
    notifier.onChange((event) => events.push(event))

    const tx = {
      stateSyncSpace: { findMany: vi.fn() },
      userApiKey: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const service = new ApiKeyService(
      { $transaction: (work: (client: typeof tx) => unknown) => work(tx) } as never,
      { recordWithClient: vi.fn().mockResolvedValue(undefined) } as never,
      undefined,
      notifier,
    )

    tx.stateSyncSpace.findMany.mockResolvedValueOnce([])
    await expect(service.createForUser("user-1", {
      name: "同步助手",
      scopes: ["state_sync.write"],
      stateSyncResources: { mode: "selected", spaceIds: ["sp_foreign"] },
    })).rejects.toBeInstanceOf(BadRequestException)

    await expect(service.createForUser("user-1", {
      name: "同步助手",
      scopes: ["state_sync.write"],
      stateSyncResources: { mode: "all_owned", spaceIds: ["sp_1"] },
    })).rejects.toBeInstanceOf(BadRequestException)

    tx.stateSyncSpace.findMany.mockResolvedValueOnce([{ id: "sp_1", ownerId: "user-1" }])
    tx.userApiKey.create.mockImplementationOnce(async ({ data }) => ({
      id: "key-sync-1",
      name: data.name,
      keyPrefix: data.keyPrefix,
      scopes: data.scopes,
      lastUsedAt: null,
      createdAt,
      tableAccessMode: data.tableAccessMode,
      tableIds: data.tableIds,
      channelAccessMode: data.channelAccessMode,
      channelIds: data.channelIds,
      stateSyncAccessMode: data.stateSyncAccessMode,
      stateSyncSpaceIds: data.stateSyncSpaceIds,
    }))
    await expect(service.createForUser("user-1", {
      name: "同步助手",
      scopes: ["state_sync.write"],
      stateSyncResources: { mode: "selected", spaceIds: ["sp_1"] },
    })).resolves.toMatchObject({
      apiKey: {
        id: "key-sync-1",
        stateSyncResources: { mode: "selected", spaceIds: ["sp_1"] },
      },
    })

    tx.stateSyncSpace.findMany.mockResolvedValueOnce([])
    await expect(service.updateStateSyncResourcesForUser("user-1", "key-1", {
      mode: "selected",
      spaceIds: ["sp_foreign"],
    })).rejects.toBeInstanceOf(BadRequestException)

    tx.stateSyncSpace.findMany.mockResolvedValueOnce([{ id: "sp_1", ownerId: "user-1" }])
    tx.userApiKey.findFirst.mockResolvedValueOnce({
      id: "key-1",
      name: "同步助手",
      keyPrefix: "syn_sk_test",
      scopes: ["state_sync.write", "state_sync.read"],
      lastUsedAt: null,
      createdAt,
      tableAccessMode: "selected",
      tableIds: [],
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: [],
    })
    await expect(service.updateStateSyncResourcesForUser("user-1", "key-1", {
      mode: "selected",
      spaceIds: ["sp_1"],
    })).resolves.toMatchObject({
      stateSyncResources: { mode: "selected", spaceIds: ["sp_1"] },
    })

    tx.userApiKey.findFirst.mockResolvedValueOnce({
      id: "key-1",
      name: "同步助手",
      keyPrefix: "syn_sk_test",
      scopes: ["state_sync.write", "state_sync.read"],
      lastUsedAt: null,
      createdAt,
      tableAccessMode: "selected",
      tableIds: [],
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: ["sp_1"],
    })
    await service.updateScopesForUser("user-1", "key-1", { scopes: ["state_sync.read"] })
    await service.revokeForUser("user-1", "key-1")

    expect(events).toEqual([
      {
        kind: "updated",
        userId: "user-1",
        apiKeyId: "key-1",
        scopes: ["state_sync.write", "state_sync.read"],
        channelAccessMode: "selected",
        channelIds: [],
        stateSyncAccessMode: "selected",
        stateSyncSpaceIds: ["sp_1"],
      },
      {
        kind: "updated",
        userId: "user-1",
        apiKeyId: "key-1",
        scopes: ["state_sync.read"],
        channelAccessMode: "selected",
        channelIds: [],
        stateSyncAccessMode: "selected",
        stateSyncSpaceIds: ["sp_1"],
      },
      {
        kind: "revoked",
        userId: "user-1",
        apiKeyId: "key-1",
      },
    ])
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
