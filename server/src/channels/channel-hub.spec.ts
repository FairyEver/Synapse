import { describe, expect, it, vi } from "vitest"
import { CHANNEL_WS_CLOSE_CODES } from "@synapse/shared/channel-contracts"
import { loadChannelConfig } from "./channel-config"
import { ChannelDebugTicketStore } from "./channel-debug-ticket"
import { ChannelHub, type ChannelSocketAdapter } from "./channel-hub"
import { createChannelTokenSecret, getChannelTokenPrefix, hashChannelTokenSecret, isChannelTokenSecret } from "./channel-token"

function createFakeSocket(options: { bufferedAmount?: number; throwOnSend?: boolean } = {}) {
  const sent: Record<string, unknown>[] = []
  const closed: Array<{ code: number; reason: string }> = []
  const socket: ChannelSocketAdapter = {
    get bufferedAmount() {
      return options.bufferedAmount ?? 0
    },
    send(data: string) {
      if (options.throwOnSend) throw new Error("EPIPE")
      sent.push(JSON.parse(data) as Record<string, unknown>)
    },
    close(code: number, reason: string) {
      closed.push({ code, reason })
    },
  }
  return { socket, sent, closed }
}

describe("channel-token & debug-ticket", () => {
  it("generates syc_ prefixed tokens, hashes deterministically, and validates format", () => {
    const secret = createChannelTokenSecret()
    expect(isChannelTokenSecret(secret)).toBe(true)
    expect(secret.startsWith("syc_")).toBe(true)
    expect(getChannelTokenPrefix(secret)).toBe(secret.slice(0, 12))
    expect(hashChannelTokenSecret(secret)).toHaveLength(64)
    expect(isChannelTokenSecret("syn_sk_12345678901234567890123456789012")).toBe(false)
  })

  it("issues single-use 60s debug tickets bound to channelId", () => {
    const store = new ChannelDebugTicketStore()
    const now = 1_700_000_000_000
    const issued = store.issue("ch_1", "user_1", now)
    expect(store.consume(issued.ticket, "ch_other", now + 1000)).toBeNull()
    expect(store.consume(issued.ticket, "ch_1", now + 1000)).toEqual({ ownerId: "user_1" })
    // single-use
    expect(store.consume(issued.ticket, "ch_1", now + 2000)).toBeNull()

    const expired = store.issue("ch_1", "user_1", now)
    expect(store.consume(expired.ticket, "ch_1", now + 60_001)).toBeNull()
  })
})

describe("ChannelHub", () => {
  it("fans out broadcasts respecting echo, event filters, and publish-only role", () => {
    const hub = new ChannelHub(loadChannelConfig({}))
    const pub = createFakeSocket()
    const subAll = createFakeSocket()
    const subFiltered = createFakeSocket()
    const pubOnly = createFakeSocket()

    const rPub = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "tok_1",
      role: "pubsub",
      isObserver: false,
      clientId: "phone-1",
      clientName: "手机",
      meta: {},
      socket: pub.socket,
    })
    const rSubAll = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "tok_2",
      role: "subscribe",
      isObserver: false,
      clientId: "screen-1",
      clientName: "大屏",
      meta: { kind: "screen" },
      socket: subAll.socket,
    })
    const rSubFiltered = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "tok_2",
      role: "subscribe",
      isObserver: false,
      clientId: "screen-2",
      clientName: "副屏",
      meta: {},
      eventsFilter: ["screen.*"],
      socket: subFiltered.socket,
    })
    const rPubOnly = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "tok_3",
      role: "publish",
      isObserver: false,
      clientId: "remote-only",
      clientName: "只发遥控器",
      meta: {},
      socket: pubOnly.socket,
    })

    expect(rPub.ok && rSubAll.ok && rSubFiltered.ok && rPubOnly.ok).toBe(true)
    if (!rPub.ok) return
    // publish-only client received presence.join broadcasts (none after it joined yet, so check rPub saw others)
    expect(pub.sent.filter((m) => m.type === "presence.join")).toHaveLength(3)

    pub.sent.length = 0
    subAll.sent.length = 0
    subFiltered.sent.length = 0
    pubOnly.sent.length = 0

    const res1 = hub.publishEvent({
      channelId: "ch_1",
      event: "slide.next",
      payload: { step: 1 },
      retain: false,
      echo: false,
      sender: { connectionId: rPub.connection.connectionId, clientId: "phone-1", clientName: "手机" },
    })
    expect(res1.seq).toBe(1)
    expect(res1.deliveredCount).toBe(1) // only subAll matches; pub has echo=false, subFiltered filters screen.*, pubOnly is publish-only
    expect(pub.sent).toHaveLength(0)
    expect(subAll.sent).toHaveLength(1)
    expect(subFiltered.sent).toHaveLength(0)
    expect(pubOnly.sent).toHaveLength(0)

    const res2 = hub.publishEvent({
      channelId: "ch_1",
      event: "screen.switch",
      payload: { scene: "home" },
      retain: true,
      echo: true,
      sender: { connectionId: rPub.connection.connectionId, clientId: "phone-1", clientName: "手机" },
    })
    expect(res2.seq).toBe(2)
    expect(res2.deliveredCount).toBe(3) // pub (echo=true), subAll, subFiltered
    expect(pub.sent).toHaveLength(1)
    expect(subFiltered.sent).toHaveLength(1)
    expect(pubOnly.sent).toHaveLength(0)
  })

  it("delivers targetClientId live-only without polluting replay buffer or falsely triggering replayTruncated", () => {
    const hub = new ChannelHub(loadChannelConfig({}))
    const s1 = createFakeSocket()
    const s2 = createFakeSocket()

    hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "pubsub",
      isObserver: false,
      clientId: "client-a",
      clientName: "A",
      meta: {},
      socket: s1.socket,
    })
    hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "pubsub",
      isObserver: false,
      clientId: "client-b",
      clientName: "B",
      meta: {},
      socket: s2.socket,
    })
    s1.sent.length = 0
    s2.sent.length = 0

    // seq 1 broadcast
    hub.publishEvent({
      channelId: "ch_1",
      event: "public.one",
      payload: 1,
      retain: false,
      echo: true,
      sender: { connectionId: null, clientId: "srv", clientName: "Srv" },
    })
    // seq 2 targeted to client-a only (NOT buffered)
    const targeted = hub.publishEvent({
      channelId: "ch_1",
      event: "private.reply",
      payload: { secret: true },
      retain: false,
      echo: true,
      targetClientId: "client-a",
      sender: { connectionId: null, clientId: "srv", clientName: "Srv" },
    })
    // seq 3 broadcast
    hub.publishEvent({
      channelId: "ch_1",
      event: "public.two",
      payload: 2,
      retain: false,
      echo: true,
      sender: { connectionId: null, clientId: "srv", clientName: "Srv" },
    })

    expect(targeted.deliveredCount).toBe(1)
    expect(s1.sent.map((m) => m.event)).toEqual(["public.one", "private.reply", "public.two"])
    expect(s2.sent.map((m) => m.event)).toEqual(["public.one", "public.two"])

    // Reconnecting client claiming client-a with afterSeq=1 must NOT replay targeted seq 2, and replayTruncated stays false
    const reconnected = createFakeSocket()
    const reg = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "client-a",
      clientName: "A2",
      meta: {},
      afterSeq: 1,
      socket: reconnected.socket,
    })
    expect(reg.ok).toBe(true)
    if (!reg.ok) return
    expect(reg.readySnapshot.replayTruncated).toBe(false)
    expect(reg.readySnapshot.replayEvents.map((e) => e.event)).toEqual(["public.two"])
  })

  it("evicts ring buffer beyond max items or window and marks replayTruncated", () => {
    const config = { ...loadChannelConfig({}), replayMaxItems: 3, replayWindowMs: 5000 }
    const hub = new ChannelHub(config)
    const t0 = 1_700_000_000_000

    for (let i = 1; i <= 5; i++) {
      hub.publishEvent({
        channelId: "ch_1",
        event: `ev.${i}`,
        payload: i,
        retain: false,
        echo: true,
        sender: { connectionId: null, clientId: null, clientName: null },
        now: t0 + i * 100,
      })
    }

    const sock = createFakeSocket()
    const reg1 = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      afterSeq: 1,
      socket: sock.socket,
      now: t0 + 1000,
    })
    expect(reg1.ok).toBe(true)
    if (!reg1.ok) return
    expect(reg1.readySnapshot.replayTruncated).toBe(true)
    expect(reg1.readySnapshot.replayEvents.map((e) => e.seq)).toEqual([3, 4, 5])

    // Past 5s window -> all buffered events expired
    const sock2 = createFakeSocket()
    const reg2 = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "c2",
      clientName: null,
      meta: {},
      afterSeq: 3,
      socket: sock2.socket,
      now: t0 + 10_000,
    })
    expect(reg2.ok).toBe(true)
    if (!reg2.ok) return
    expect(reg2.readySnapshot.replayTruncated).toBe(true)
    expect(reg2.readySnapshot.replayEvents).toEqual([])
  })

  it("keeps Console debugger observer hidden from Presence and production caps while enforcing its own 5-observer cap", () => {
    const config = { ...loadChannelConfig({}), maxConnectionsPerChannel: 1, maxObserversPerChannel: 2 }
    const hub = new ChannelHub(config)
    const prod = createFakeSocket()
    const prod2 = createFakeSocket()
    const obs1 = createFakeSocket()
    const obs2 = createFakeSocket()
    const obs3 = createFakeSocket()

    expect(hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "screen-1",
      clientName: "大屏",
      meta: {},
      socket: prod.socket,
    }).ok).toBe(true)

    // Production cap reached (1)
    const blockedProd = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "screen-2",
      clientName: "大屏2",
      meta: {},
      socket: prod2.socket,
    })
    expect(blockedProd.ok).toBe(false)
    if (!blockedProd.ok) expect(blockedProd.closeCode).toBe(CHANNEL_WS_CLOSE_CODES.LIMIT_EXCEEDED)

    // Observer still succeeds when production is full, and stays invisible to prod
    const rObs1 = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg_1",
      role: "pubsub",
      isObserver: true,
      clientId: "console-debugger",
      clientName: "Console 调试台",
      meta: {},
      socket: obs1.socket,
    })
    const rObs2 = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg_2",
      role: "pubsub",
      isObserver: true,
      clientId: "console-debugger",
      clientName: "Console 调试台",
      meta: {},
      socket: obs2.socket,
    })
    const rObs3 = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg_3",
      role: "pubsub",
      isObserver: true,
      clientId: "console-debugger",
      clientName: "Console 调试台",
      meta: {},
      socket: obs3.socket,
    })
    expect(rObs1.ok && rObs2.ok).toBe(true)
    expect(rObs3.ok).toBe(false)
    expect(hub.getOnlineCount("ch_1")).toBe(1)
    expect(hub.getPresence("ch_1")).toHaveLength(1)
    expect(prod.sent.filter((m) => m.type === "presence.join")).toHaveLength(0)

    // Observer cannot mutate presence
    if (rObs1.ok) {
      expect(hub.updatePresence("ch_1", rObs1.connection.connectionId, { clientName: "Hacked" })).toBeNull()
    }
  })

  it("evicts slow or broken subscribers with 4008 without aborting fan-out to healthy subscribers", () => {
    const hub = new ChannelHub(loadChannelConfig({}))
    const slow = createFakeSocket({ bufferedAmount: 600_000 })
    const broken = createFakeSocket({ throwOnSend: true })
    const healthy = createFakeSocket()

    hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "slow",
      clientName: null,
      meta: {},
      socket: slow.socket,
    })
    hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "broken",
      clientName: null,
      meta: {},
      socket: broken.socket,
    })
    hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "healthy",
      clientName: null,
      meta: {},
      socket: healthy.socket,
    })
    healthy.sent.length = 0

    const res = hub.publishEvent({
      channelId: "ch_1",
      event: "ping.all",
      payload: { ok: true },
      retain: false,
      echo: true,
      sender: { connectionId: null, clientId: null, clientName: null },
    })

    expect(res.deliveredCount).toBe(1)
    expect(healthy.sent.some((m) => m.type === "event" && m.event === "ping.all")).toBe(true)
    expect(slow.closed).toEqual([{ code: CHANNEL_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, reason: expect.any(String) }])
    expect(broken.closed).toEqual([{ code: CHANNEL_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, reason: expect.any(String) }])
    expect(hub.getOnlineCount("ch_1")).toBe(1)
  })

  it("supports credential/channel/owner disconnects (4003/4004), shutdown (1001), and rate limits", () => {
    const config = { ...loadChannelConfig({}), wsRatePerSec: 1, wsBurst: 2, httpRatePerSec: 1, httpBurst: 1 }
    const hub = new ChannelHub(config)
    const s1 = createFakeSocket()
    const s2 = createFakeSocket()

    const now = 1_700_000_000_000
    const r1 = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "api_key",
      credentialId: "key_1",
      role: "pubsub",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: s1.socket,
      now,
    })
    const r2 = hub.registerConnection({
      channelId: "ch_2",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "tok_2",
      role: "subscribe",
      isObserver: false,
      clientId: "c2",
      clientName: null,
      meta: {},
      socket: s2.socket,
      now,
    })
    expect(r1.ok && r2.ok).toBe(true)
    if (!r1.ok) return

    expect(hub.consumeWsPublishRate(r1.connection.connectionId, now)).toBe(true)
    expect(hub.consumeWsPublishRate(r1.connection.connectionId, now)).toBe(true)
    expect(hub.consumeWsPublishRate(r1.connection.connectionId, now)).toBe(false)
    expect(hub.consumeWsPublishRate(r1.connection.connectionId, now + 1000)).toBe(true)

    expect(hub.consumeHttpPublishRate("ch_1", now).allowed).toBe(true)
    expect(hub.consumeHttpPublishRate("ch_1", now).allowed).toBe(false)

    expect(hub.disconnectByCredential("api_key", "key_1", CHANNEL_WS_CLOSE_CODES.ROLE_CHANGED, "role changed")).toBe(1)
    expect(s1.closed[0]?.code).toBe(4004)

    hub.shutdownAll()
    expect(s2.closed[0]?.code).toBe(1001)
    expect(hub.getOnlineCount("ch_2")).toBe(0)
  })

  it("does not emit presence.leave during full channel teardown or send pre-ready presence.leave on join eviction", () => {
    const hub = new ChannelHub(loadChannelConfig({}))
    const broken = createFakeSocket({ throwOnSend: true })
    const healthy = createFakeSocket()

    hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "broken-old",
      clientName: null,
      meta: {},
      socket: broken.socket,
    })

    // Joining while an existing socket is broken evicts the broken socket first:
    // the new socket must receive 0 frames before ready, and readySnapshot.presence must exclude broken-old.
    const rHealthy = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "publish",
      isObserver: false,
      clientId: "remote-1",
      clientName: "遥控器",
      meta: {},
      socket: healthy.socket,
    })
    expect(rHealthy.ok).toBe(true)
    if (!rHealthy.ok) return
    expect(healthy.sent).toEqual([])
    expect(rHealthy.readySnapshot.presence.map((m) => m.clientId)).toEqual(["remote-1"])
    expect(broken.closed).toEqual([{ code: CHANNEL_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, reason: expect.any(String) }])

    // Another client joins -> publish-only socket receives presence.join
    const second = createFakeSocket({ throwOnSend: true })
    hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "screen-2",
      clientName: null,
      meta: {},
      socket: second.socket,
    })
    expect(healthy.sent.some((m) => m.type === "presence.join")).toBe(true)
    healthy.sent.length = 0

    // disconnectByChannel must NOT broadcast presence.leave or double-close the broken socket with 4008
    expect(hub.disconnectByChannel("ch_1", CHANNEL_WS_CLOSE_CODES.REVOKED, "Channel deleted")).toBe(2)
    expect(healthy.sent).toEqual([])
    expect(healthy.closed).toEqual([{ code: 4003, reason: "Channel deleted" }])
    expect(second.closed).toEqual([{ code: 4003, reason: "Channel deleted" }])
  })

  it("enforces seqFloor non-regression, account/global caps, and observer silent unregister", () => {
    const config = { ...loadChannelConfig({}), maxConnectionsPerAccount: 1, maxGlobalConnections: 2 }
    const hub = new ChannelHub(config)
    const s1 = createFakeSocket()
    const s2 = createFakeSocket()
    const s3 = createFakeSocket()
    const s4 = createFakeSocket()

    const r1 = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t1",
      role: "subscribe",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      seqFloor: 50,
      afterSeq: 10,
      socket: s1.socket,
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.readySnapshot.latestSeq).toBe(50)
    expect(r1.readySnapshot.replayTruncated).toBe(true)

    // Account cap (1) blocks second prod connection for u1
    expect(hub.registerConnection({
      channelId: "ch_2",
      ownerId: "u1",
      credentialType: "channel_token",
      credentialId: "t2",
      role: "subscribe",
      isObserver: false,
      clientId: "c2",
      clientName: null,
      meta: {},
      socket: s2.socket,
    }).ok).toBe(false)

    // Another account fits under global cap (2)
    expect(hub.registerConnection({
      channelId: "ch_3",
      ownerId: "u2",
      credentialType: "channel_token",
      credentialId: "t3",
      role: "subscribe",
      isObserver: false,
      clientId: "c3",
      clientName: null,
      meta: {},
      socket: s3.socket,
    }).ok).toBe(true)

    // Global cap (2) blocks third prod connection
    expect(hub.registerConnection({
      channelId: "ch_4",
      ownerId: "u3",
      credentialType: "channel_token",
      credentialId: "t4",
      role: "subscribe",
      isObserver: false,
      clientId: "c4",
      clientName: null,
      meta: {},
      socket: s4.socket,
    }).ok).toBe(false)

    // Observer unregister stays silent
    const obs = createFakeSocket()
    const rObs = hub.registerConnection({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg",
      role: "pubsub",
      isObserver: true,
      clientId: "console-debugger",
      clientName: null,
      meta: {},
      socket: obs.socket,
    })
    expect(rObs.ok).toBe(true)
    if (rObs.ok) hub.unregisterConnection("ch_1", rObs.connection.connectionId)
    expect(s1.sent.filter((m) => m.type === "presence.leave")).toEqual([])
  })
})
