import { describe, expect, it } from "vitest"
import { buildTunnelUrl, createTunnelLabel, isTunnelPort, parseTunnelControlMessage, parseTunnelHost, TUNNEL_LIMITS } from "./tunnel-contracts.js"

describe("tunnel contracts", () => {
  it("allocates DNS-safe opaque labels and matches only one exact host layer", () => {
    const label = createTunnelLabel(() => new Uint8Array(16))
    expect(label).toBe("0".repeat(32))
    expect(buildTunnelUrl(label, "tunnel.d2.pub")).toBe(`https://${label}.tunnel.d2.pub`)
    expect(parseTunnelHost(`${label}.TUNNEL.d2.pub:443`, "tunnel.d2.pub")).toBe(label)
    for (const host of [`x.${label}.tunnel.d2.pub`, `${label}.tunnel.d2.pub.evil.test`, `${label}.tunnel.d2.pub,evil`, `${label}.tunnel.d2.pub@evil`, `${label}.tunnel.d2.pub:bad`]) {
      expect(parseTunnelHost(host, "tunnel.d2.pub")).toBeNull()
    }
    expect(() => buildTunnelUrl("bad", "tunnel.d2.pub")).toThrow()
  })
  it("accepts only literal integer ports", () => {
    expect([1, 3000, 65535].every(isTunnelPort)).toBe(true)
    expect([0, 65536, 1.2, "3000", NaN, Infinity, null].some(isTunnelPort)).toBe(false)
  })
  it("rejects unknown versions, fields, oversized frames and invalid port bindings", () => {
    const hello = { version: 1, type: "hello", clientInstanceId: "device-1", deviceKey: "a".repeat(43) }
    expect(parseTunnelControlMessage(hello)).toEqual(hello)
    expect(parseTunnelControlMessage({ ...hello, version: 2 })).toBeNull()
    expect(parseTunnelControlMessage({ ...hello, extra: true })).toBeNull()
    expect(parseTunnelControlMessage({ ...hello, deviceKey: "a".repeat(9000) })).toBeNull()
    expect(parseTunnelControlMessage({ version: 1, type: "open", requestId: "req", ticket: "a".repeat(43), mapping: { id: "m", port: 0, revision: 1 } })).toBeNull()
    expect(parseTunnelControlMessage({ version: 1, type: "bindings", mappings: Array.from({ length: 101 }, () => ({ id: "m", revision: 1 })) })).toBeNull()
  })
  it("pins the resource and timeout budgets", () => {
    expect(TUNNEL_LIMITS).toMatchObject({ mappingsPerUser: 100, streamsPerMapping: 16, streamsPerUser: 64, streamsGlobal: 256, requestBodyBytes: 67108864, controlFrameBytes: 8192, dataMessageBytes: 65536, streamBufferedBytes: 262144, globalBufferedBytes: 67108864, heartbeatMs: 20000, heartbeatTimeoutMs: 45000, connectTimeoutMs: 5000, ticketTtlMs: 10000, responseHeaderTimeoutMs: 30000, idleTimeoutMs: 300000 })
  })
})
