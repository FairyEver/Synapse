import { TUNNEL_LIMITS } from "@synapse/shared/tunnel-contracts"
export class TunnelTransportError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code) }
}
export class TunnelBudget {
  private readonly mappings = new Map<string, number>()
  private readonly users = new Map<string, number>()
  private active = 0
  constructor(private readonly limits: { mapping: number; user: number; global: number } = { mapping: TUNNEL_LIMITS.streamsPerMapping, user: TUNNEL_LIMITS.streamsPerUser, global: TUNNEL_LIMITS.streamsGlobal }) {}
  get size(): number { return this.active }
  acquire(scope: { userId: string; mappingId: string }): { release(): void } {
    if (this.active >= this.limits.global) throw new TunnelTransportError("TUNNEL_CAPACITY", 503)
    if ((this.mappings.get(scope.mappingId) ?? 0) >= this.limits.mapping || (this.users.get(scope.userId) ?? 0) >= this.limits.user) throw new TunnelTransportError("TUNNEL_QUOTA", 429)
    this.active++
    this.mappings.set(scope.mappingId, (this.mappings.get(scope.mappingId) ?? 0) + 1)
    this.users.set(scope.userId, (this.users.get(scope.userId) ?? 0) + 1)
    let released = false
    return { release: () => {
      if (released) return
      released = true; this.active--
      for (const [map, key] of [[this.mappings, scope.mappingId], [this.users, scope.userId]] as const) {
        const next = (map.get(key) ?? 1) - 1
        if (next) map.set(key, next); else map.delete(key)
      }
    } }
  }
}
