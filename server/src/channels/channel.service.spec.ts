import { describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { CHANNEL_WS_CLOSE_CODES } from "@synapse/shared/channel-contracts"
import { ApiKeyChangeNotifier } from "../api-keys/api-key-change-notifier"
import { CHANNELS_MANAGE_SCOPE, CHANNELS_PUBLISH_SCOPE, CHANNELS_SUBSCRIBE_SCOPE } from "../api-keys/api-key-capabilities"
import { OpenApiHttpError } from "../open-api/open-api.types"
import { loadChannelConfig } from "./channel-config"
import { ChannelDebugTicketStore } from "./channel-debug-ticket"
import { ChannelHub, type ChannelSocketAdapter } from "./channel-hub"
import { createChannelTokenSecret, hashChannelTokenSecret } from "./channel-token"
import { ChannelService } from "./channel.service"

function createFakeSocket(): { socket: ChannelSocketAdapter; closed: Array<{ code: number; reason: string }>; sent: Record<string, unknown>[] } {
  const closed: Array<{ code: number; reason: string }> = []
  const sent: Record<string, unknown>[] = []
  return {
    closed,
    sent,
    socket: {
      bufferedAmount: 0,
      send(data: string) {
        sent.push(JSON.parse(data) as Record<string, unknown>)
      },
      close(code: number, reason: string) {
        closed.push({ code, reason })
      },
    },
  }
}

function createHarness() {
  const channels = new Map<string, { id: string; ownerId: string; name: string; description: string; seqEpoch: bigint; createdAt: Date; updatedAt: Date }>()
  const tokens = new Map<string, { id: string; channelId: string; name: string; role: string; tokenHash: string; tokenPrefix: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }>()
  const retained = new Map<string, { channelId: string; event: string; payload: unknown; seq: bigint; senderClientId: string | null; senderName: string | null; updatedAt: Date }>()
  let idSeq = 0

  const prisma = {
    channel: {
      create: vi.fn(async ({ data }) => {
        const now = new Date("2026-11-25T08:00:00.000Z")
        const row = {
          id: data.id ?? `ch_${++idSeq}`,
          ownerId: data.ownerId,
          name: data.name,
          description: data.description ?? "",
          seqEpoch: BigInt(0),
          createdAt: now,
          updatedAt: now,
        }
        channels.set(row.id, row)
        return row
      }),
      findMany: vi.fn(async ({ where }) => {
        return [...channels.values()].filter((ch) => {
          if (where?.ownerId && ch.ownerId !== where.ownerId) return false
          if (where?.id?.in && !where.id.in.includes(ch.id)) return false
          return true
        }).map((ch) => ({
          ...ch,
          _count: {
            tokens: [...tokens.values()].filter((t) => t.channelId === ch.id && t.revokedAt === null).length,
          },
        }))
      }),
      findFirst: vi.fn(async ({ where }) => {
        for (const ch of channels.values()) {
          if (where?.id && ch.id !== where.id) continue
          if (where?.ownerId && ch.ownerId !== where.ownerId) continue
          return {
            ...ch,
            _count: {
              tokens: [...tokens.values()].filter((t) => t.channelId === ch.id && t.revokedAt === null).length,
            },
          }
        }
        return null
      }),
      findUnique: vi.fn(async ({ where }) => {
        const ch = channels.get(where.id)
        return ch ? { ...ch, owner: { status: "active" } } : null
      }),
      update: vi.fn(async ({ where, data }) => {
        const ch = channels.get(where.id)!
        const next = { ...ch, ...data, updatedAt: new Date("2026-11-25T09:00:00.000Z") }
        channels.set(ch.id, next)
        return {
          ...next,
          _count: {
            tokens: [...tokens.values()].filter((t) => t.channelId === ch.id && t.revokedAt === null).length,
          },
        }
      }),
      delete: vi.fn(async ({ where }) => {
        const ch = channels.get(where.id)!
        channels.delete(where.id)
        return ch
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const existed = channels.delete(where.id)
        return { count: existed ? 1 : 0 }
      }),
    },
    channelToken: {
      count: vi.fn(async ({ where }) => {
        return [...tokens.values()].filter((t) => t.channelId === where.channelId && t.revokedAt === null).length
      }),
      create: vi.fn(async ({ data }) => {
        const row = {
          id: data.id ?? `cht_${++idSeq}`,
          channelId: data.channelId,
          name: data.name,
          role: data.role,
          tokenHash: data.tokenHash,
          tokenPrefix: data.tokenPrefix,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date("2026-11-25T08:00:00.000Z"),
        }
        tokens.set(row.id, row)
        return row
      }),
      findMany: vi.fn(async ({ where }) => {
        return [...tokens.values()].filter((t) => t.channelId === where.channelId && t.revokedAt === null)
      }),
      findFirst: vi.fn(async ({ where }) => {
        for (const t of tokens.values()) {
          if (where?.id && t.id !== where.id) continue
          if (where?.channelId && t.channelId !== where.channelId) continue
          if (where?.revokedAt === null && t.revokedAt !== null) continue
          return t
        }
        return null
      }),
      findUnique: vi.fn(async ({ where }) => {
        for (const t of tokens.values()) {
          if (t.tokenHash === where.tokenHash) {
            const ch = channels.get(t.channelId)
            return ch ? { ...t, channel: { ...ch, owner: { status: "active" } } } : null
          }
        }
        return null
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0
        for (const t of tokens.values()) {
          if (where?.id && t.id !== where.id) continue
          if (where?.channelId && t.channelId !== where.channelId) continue
          if (where?.revokedAt === null && t.revokedAt !== null) continue
          Object.assign(t, data)
          count++
        }
        return { count }
      }),
    },
    channelRetainedEvent: {
      findMany: vi.fn(async ({ where }) => {
        return [...retained.values()].filter((r) => r.channelId === where.channelId)
      }),
      findUnique: vi.fn(async ({ where }) => {
        return retained.get(`${where.channelId_event.channelId}:${where.channelId_event.event}`) ?? null
      }),
      count: vi.fn(async ({ where }) => {
        return [...retained.values()].filter((r) => r.channelId === where.channelId).length
      }),
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = `${where.channelId_event.channelId}:${where.channelId_event.event}`
        const existing = retained.get(key)
        const next = existing
          ? { ...existing, ...update, updatedAt: new Date("2026-11-25T08:05:00.000Z") }
          : { ...create, updatedAt: new Date("2026-11-25T08:05:00.000Z") }
        retained.set(key, next)
        return next
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const key = `${where.channelId}:${where.event}`
        const existed = retained.delete(key)
        return { count: existed ? 1 : 0 }
      }),
      aggregate: vi.fn(async ({ where }) => {
        let maxSeq: bigint | null = null
        for (const r of retained.values()) {
          if (r.channelId === where.channelId && (maxSeq === null || r.seq > maxSeq)) maxSeq = r.seq
        }
        return { _max: { seq: maxSeq } }
      }),
    },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(prisma)),
  }

  const apiKeyService = {
    verifyOpenApiSecret: vi.fn(),
    touchLastUsed: vi.fn().mockResolvedValue(undefined),
  }
  const notifier = new ApiKeyChangeNotifier()
  const hub = new ChannelHub(loadChannelConfig({}))
  const debugTickets = new ChannelDebugTicketStore()
  const service = new ChannelService(
    prisma as never,
    apiKeyService as never,
    notifier,
    hub,
    debugTickets,
  )
  service.onModuleInit()

  return { service, prisma, apiKeyService, notifier, hub, debugTickets, channels, tokens, retained }
}

describe("ChannelService", () => {
  it("enforces role permissions for channel tokens and API keys", async () => {
    const { service, apiKeyService } = createHarness()
    const ch = await service.createChannel({ kind: "console", userId: "u1" }, { name: "客厅大屏", description: "" })

    const subTok = await service.createToken({ kind: "console", userId: "u1" }, ch.id, { name: "大屏", role: "subscribe" })
    const pubTok = await service.createToken({ kind: "console", userId: "u1" }, ch.id, { name: "遥控器", role: "publish" })

    const subActor = await service.authenticateOpenBearer(subTok.secret, ch.id)
    const pubActor = await service.authenticateOpenBearer(pubTok.secret, ch.id)
    expect(subActor?.kind).toBe("channel_token")
    expect(pubActor?.kind).toBe("channel_token")

    // subscribe token cannot publish or clear retained
    await expect(service.publishEvent(subActor!, ch.id, { event: "slide.next", payload: 1, retain: false }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN_ROLE" })
    await expect(service.clearRetained(subActor!, ch.id, "scene.current"))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN_ROLE" })
    await expect(service.listRetained(subActor!, ch.id)).resolves.toEqual({ channelId: ch.id, items: [] })

    // publish token can publish & read presence, cannot read retained or manage channel
    await expect(service.publishEvent(pubActor!, ch.id, { event: "scene.current", payload: { p: 1 }, retain: true }))
      .resolves.toMatchObject({ seq: 1, retained: true })
    await expect(service.getPresence(pubActor!, ch.id)).resolves.toEqual({ channelId: ch.id, count: 0, members: [] })
    await expect(service.listRetained(pubActor!, ch.id))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN_ROLE" })
    await expect(service.listTokens(pubActor!, ch.id))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })

    // API key with selected mode cannot create channels
    apiKeyService.verifyOpenApiSecret.mockResolvedValue({
      userId: "u1",
      apiKeyId: "k1",
      scopes: [CHANNELS_MANAGE_SCOPE],
      channelAccessMode: "selected",
      channelIds: [ch.id],
    })
    const selectedKeyActor = await service.authenticateOpenBearer("syn_sk_" + "a".repeat(43), null)
    await expect(service.createChannel(selectedKeyActor!, { name: "非法建频道", description: "" }))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })

    // API key with all_owned + channels.manage can create channels
    apiKeyService.verifyOpenApiSecret.mockResolvedValue({
      userId: "u1",
      apiKeyId: "k2",
      scopes: [CHANNELS_MANAGE_SCOPE],
      channelAccessMode: "all_owned",
      channelIds: [],
    })
    const allOwnedActor = await service.authenticateOpenBearer("syn_sk_" + "b".repeat(43), null)
    await expect(service.createChannel(allOwnedActor!, { name: "新建成功", description: "" }))
      .resolves.toMatchObject({ name: "新建成功" })
  })

  it("enforces the 20-key Retain ceiling while allowing overwrites of existing keys, and deletes retained silently", async () => {
    const { service, hub, retained } = createHarness()
    const ch = await service.createChannel({ kind: "console", userId: "u1" }, { name: "状态频道", description: "" })
    const actor = { kind: "console" as const, userId: "u1" }

    for (let i = 1; i <= 20; i++) {
      await service.publishEvent(actor, ch.id, { event: `state.${i}`, payload: { v: i }, retain: true })
    }

    // Overwriting existing key #1 at the 20-key ceiling MUST succeed
    await expect(service.publishEvent(actor, ch.id, { event: "state.1", payload: { v: 999 }, retain: true }))
      .resolves.toMatchObject({ retained: true })

    // Inserting 21st distinct key MUST fail cleanly with RETAIN_LIMIT_EXCEEDED and NOT broadcast to live subscribers
    const publishSpy = vi.spyOn(hub, "publishEvent")
    await expect(service.publishEvent(actor, ch.id, { event: "state.21", payload: { v: 21 }, retain: true }))
      .rejects.toMatchObject({ statusCode: 422, code: "RETAIN_LIMIT_EXCEEDED" })
    expect(publishSpy).not.toHaveBeenCalled()

    // Overwriting an existing key with payload: null stores Prisma.JsonNull cleanly
    await expect(service.publishEvent(actor, ch.id, { event: "state.1", payload: null, retain: true }))
      .resolves.toMatchObject({ retained: true })
    expect(retained.get(`${ch.id}:state.1`)?.payload).toBe(Prisma.JsonNull)

    // Silent clear does not publish to Hub
    publishSpy.mockClear()
    await expect(service.clearRetained(actor, ch.id, "state.1")).resolves.toEqual({ deleted: true })
    await expect(service.clearRetained(actor, ch.id, "state.1")).resolves.toEqual({ deleted: false })
    expect(publishSpy).not.toHaveBeenCalled()

    // Deleting channel disconnects active sockets with 4003
    const subSock = createFakeSocket()
    hub.registerConnection({
      channelId: ch.id, ownerId: "u1", credentialType: "channel_token", credentialId: "t_del",
      role: "subscribe", isObserver: false, clientId: "c_del", clientName: null, meta: {}, socket: subSock.socket,
    })
    await expect(service.deleteChannel(actor, ch.id)).resolves.toEqual({ deleted: true })
    expect(subSock.closed[0]?.code).toBe(CHANNEL_WS_CLOSE_CODES.REVOKED)
  })

  it("disconnects live WS sockets on token revoke, channel delete, API key revoke/removal (4003), and API key scope change (4004)", async () => {
    const { service, hub, notifier } = createHarness()
    const ch1 = await service.createChannel({ kind: "console", userId: "u1" }, { name: "Ch1", description: "" })
    const ch2 = await service.createChannel({ kind: "console", userId: "u1" }, { name: "Ch2", description: "" })
    const tok = await service.createToken({ kind: "console", userId: "u1" }, ch1.id, { name: "大屏", role: "subscribe" })

    const sTok = createFakeSocket()
    const sKeyCh1 = createFakeSocket()
    const sKeyCh2 = createFakeSocket()

    hub.registerConnection({
      channelId: ch1.id, ownerId: "u1", credentialType: "channel_token", credentialId: tok.token.id,
      role: "subscribe", isObserver: false, clientId: "tok-client", clientName: null, meta: {}, socket: sTok.socket,
    })
    hub.registerConnection({
      channelId: ch1.id, ownerId: "u1", credentialType: "api_key", credentialId: "key_1",
      role: "pubsub", isObserver: false, clientId: "k-ch1", clientName: null, meta: {}, socket: sKeyCh1.socket,
    })
    hub.registerConnection({
      channelId: ch2.id, ownerId: "u1", credentialType: "api_key", credentialId: "key_1",
      role: "pubsub", isObserver: false, clientId: "k-ch2", clientName: null, meta: {}, socket: sKeyCh2.socket,
    })

    // 1. Revoking channel token closes its socket with 4003
    await service.revokeToken({ kind: "console", userId: "u1" }, ch1.id, tok.token.id)
    expect(sTok.closed[0]?.code).toBe(CHANNEL_WS_CLOSE_CODES.REVOKED)

    // 2. Updating API key to drop ch2 AND downgrade scope from pubsub -> subscribe:
    //    ch2 socket gets 4003 (removed from channelIds), ch1 socket gets 4004 (role changed)
    notifier.emit({
      kind: "updated",
      userId: "u1",
      apiKeyId: "key_1",
      scopes: [CHANNELS_SUBSCRIBE_SCOPE],
      channelAccessMode: "selected",
      channelIds: [ch1.id],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: [],
    })
    expect(sKeyCh2.closed[0]?.code).toBe(CHANNEL_WS_CLOSE_CODES.REVOKED)
    expect(sKeyCh1.closed[0]?.code).toBe(CHANNEL_WS_CLOSE_CODES.ROLE_CHANGED)

    // 3. User disabled disconnects all owner connections with 4003
    const sUser = createFakeSocket()
    hub.registerConnection({
      channelId: ch1.id, ownerId: "u1", credentialType: "api_key", credentialId: "key_2",
      role: "subscribe", isObserver: false, clientId: "k-u1", clientName: null, meta: {}, socket: sUser.socket,
    })
    notifier.emit({ kind: "user_disabled", userId: "u1" })
    expect(sUser.closed[0]?.code).toBe(CHANNEL_WS_CLOSE_CODES.REVOKED)
  })

  it("ignores unrelated tokens and verifies token secret format", async () => {
    const { service } = createHarness()
    const randomToken = createChannelTokenSecret()
    expect(hashChannelTokenSecret(randomToken)).toHaveLength(64)
    await expect(service.authenticateOpenBearer(randomToken, "ch_missing")).resolves.toBeNull()
    expect(OpenApiHttpError).toBeDefined()
  })

  it("leases Channel.seqEpoch persistently so seq remains strictly monotonic across server restarts", async () => {
    const harness = createHarness()
    const ch = await harness.service.createChannel({ kind: "console", userId: "u1" }, { name: "重启单调性" })
    const tok = await harness.service.createToken({ kind: "console", userId: "u1" }, ch.id, { name: "pub", role: "pubsub" })

    // Process 1: publish two non-retained events (via HTTP and WS)
    const p1 = await harness.service.publishEvent({ kind: "console", userId: "u1" }, ch.id, { event: "ping", payload: { n: 1 } })
    const p2 = await harness.service.publishFromWs({
      channelId: ch.id,
      event: "ping",
      payload: { n: 2 },
      retain: false,
      echo: true,
      sender: { connectionId: "conn_1", clientId: "c1", clientName: null },
    })
    expect(p1.seq).toBe(1)
    expect(p2.seq).toBe(2)
    expect(harness.channels.get(ch.id)?.seqEpoch).toBe(BigInt(10_000))

    // Connecting within the SAME process keeps live seq=2 (does not jump to leased ceiling)
    const liveAuth = await harness.service.authenticateWsCredential(tok.secret, ch.id)
    expect(liveAuth?.seqFloor).toBe(2)

    // Process 2 (simulated server restart: fresh ChannelHub + ChannelService sharing same Prisma DB)
    const restartedHub = new ChannelHub(loadChannelConfig({}))
    const restartedService = new ChannelService(
      harness.prisma as never,
      {} as never,
      new ApiKeyChangeNotifier(),
      restartedHub,
      new ChannelDebugTicketStore(),
    )

    // Pre-restart client reconnects with afterSeq=2 -> sees seqFloor=10_000 & replayTruncated=true
    const restartedAuth = await restartedService.authenticateWsCredential(tok.secret, ch.id)
    expect(restartedAuth?.seqFloor).toBe(10_000)
    const s = createFakeSocket()
    const reg = restartedHub.registerConnection({
      channelId: ch.id,
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: tok.token.id,
      role: "pubsub",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      afterSeq: 2,
      seqFloor: restartedAuth!.seqFloor,
      socket: s.socket,
    })
    expect(reg.ok && reg.readySnapshot.latestSeq).toBe(10_000)
    expect(reg.ok && reg.readySnapshot.replayTruncated).toBe(true)

    // Post-restart WS publish advances strictly above pre-restart seq and leases next epoch
    const p3 = await restartedService.publishFromWs({
      channelId: ch.id,
      event: "ping",
      payload: { n: 3 },
      retain: false,
      echo: true,
      sender: { connectionId: "conn_2", clientId: "c1", clientName: null },
    })
    expect(p3.seq).toBe(10_001)
    expect(harness.channels.get(ch.id)?.seqEpoch).toBe(BigInt(20_000))
  })
})
