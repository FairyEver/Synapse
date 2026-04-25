/**
 * Phase 0.3 — NetworkServiceRegistry.
 * SPEC §15.2.
 *
 * Centralizes all outward-facing network surfaces (HTTP / WebSocket / TCP)
 * so:
 *   - Port conflicts are resolved by a single allocator (next-available).
 *   - Authentication strategies (local-token / mTLS / OAuth) live here.
 *   - Audit logging gets a single chokepoint.
 *
 * Phase 0.3 ships the registry skeleton + a stub allocator. No live services
 * are migrated in this commit (MCP HTTP server stays where it is until M2,
 * per SPEC §15.14).
 */

import {
  isFreePort,
  pickNextAvailablePort,
} from "./ports"

export type NetworkRole = "http" | "websocket" | "tcp" | "grpc"

export type AuthStrategy =
  | { kind: "none" }
  | { kind: "local-token"; tokenSecretRef: string }
  | { kind: "mtls"; caCertPath: string }
  | { kind: "bearer"; tokenSecretRef: string }

export interface TlsConfig {
  readonly certPath: string
  readonly keyPath: string
  readonly caPath?: string
}

export interface NetworkRequestHandler {
  readonly handle: (request: unknown) => Promise<unknown> | unknown
}

export interface NetworkServiceDescriptor {
  readonly id: string
  readonly role: NetworkRole
  readonly preferredPort?: number
  /** Default 127.0.0.1. SPEC §15.2 forbids implicit 0.0.0.0 binding. */
  readonly bindAddress?: string
  readonly tls?: TlsConfig
  readonly auth?: AuthStrategy
  readonly handler: NetworkRequestHandler
  readonly onPortAssigned?: (port: number) => void
}

export interface ResolvedNetworkBinding {
  readonly id: string
  readonly port: number
  readonly bindAddress: string
}

export type PortConflictPolicy = "fail" | "next-available" | "ask-user"

export interface NetworkServiceRegistry {
  register(descriptor: NetworkServiceDescriptor): Promise<ResolvedNetworkBinding>
  unregister(id: string): Promise<void>
  list(): readonly ResolvedNetworkBinding[]
  readonly conflictPolicy: PortConflictPolicy
}

export interface NetworkServiceRegistryOptions {
  readonly conflictPolicy?: PortConflictPolicy
  /**
   * Hook to test the manager without binding real sockets. Defaults to a
   * platform-aware probe via node:net.
   */
  readonly probePort?: (port: number, host: string) => Promise<boolean>
  /** Lower bound for next-available scans. */
  readonly portRangeStart?: number
  /** Upper bound (inclusive). */
  readonly portRangeEnd?: number
}

interface InternalEntry {
  readonly descriptor: NetworkServiceDescriptor
  readonly binding: ResolvedNetworkBinding
}

export class NetworkServiceRegistryImpl implements NetworkServiceRegistry {
  readonly conflictPolicy: PortConflictPolicy
  private readonly entries = new Map<string, InternalEntry>()
  private readonly probePort: (port: number, host: string) => Promise<boolean>
  private readonly portRangeStart: number
  private readonly portRangeEnd: number
  /** Ports we have allocated within this process so they don't collide with each other. */
  private readonly allocatedPorts = new Set<number>()

  constructor(options: NetworkServiceRegistryOptions = {}) {
    this.conflictPolicy = options.conflictPolicy ?? "next-available"
    this.probePort = options.probePort ?? isFreePort
    this.portRangeStart = options.portRangeStart ?? 49152
    this.portRangeEnd = options.portRangeEnd ?? 65535
  }

  async register(descriptor: NetworkServiceDescriptor): Promise<ResolvedNetworkBinding> {
    if (this.entries.has(descriptor.id)) {
      throw new Error(`Network service "${descriptor.id}" already registered`)
    }
    const bindAddress = descriptor.bindAddress ?? "127.0.0.1"
    const port = await this.allocatePort(descriptor, bindAddress)

    const binding: ResolvedNetworkBinding = {
      id: descriptor.id,
      port,
      bindAddress,
    }

    this.entries.set(descriptor.id, { descriptor, binding })
    this.allocatedPorts.add(port)
    descriptor.onPortAssigned?.(port)
    return binding
  }

  async unregister(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.allocatedPorts.delete(entry.binding.port)
  }

  list(): readonly ResolvedNetworkBinding[] {
    return [...this.entries.values()].map((e) => e.binding)
  }

  private async allocatePort(
    descriptor: NetworkServiceDescriptor,
    bindAddress: string,
  ): Promise<number> {
    const preferred = descriptor.preferredPort
    if (preferred !== undefined && !this.allocatedPorts.has(preferred)) {
      const free = await this.probePort(preferred, bindAddress)
      if (free) return preferred
      if (this.conflictPolicy === "fail") {
        throw new Error(
          `Network service "${descriptor.id}": preferred port ${preferred} is busy and conflictPolicy is "fail"`,
        )
      }
    }

    if (this.conflictPolicy === "ask-user") {
      // Phase 0.3 keeps this as a stub — UI integration lands when the first
      // consumer (MCP HTTP migration) needs it. For now treat as next-available.
    }

    const taken = new Set(this.allocatedPorts)
    return pickNextAvailablePort({
      from: this.portRangeStart,
      to: this.portRangeEnd,
      preferred,
      taken,
      probe: (p) => this.probePort(p, bindAddress),
    })
  }
}

export function createNetworkServiceRegistry(
  options: NetworkServiceRegistryOptions = {},
): NetworkServiceRegistryImpl {
  return new NetworkServiceRegistryImpl(options)
}
