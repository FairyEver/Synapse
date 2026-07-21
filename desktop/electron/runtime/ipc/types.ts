/**
 * Phase 0.3 — IPC runtime public types.
 * SPEC §6.
 *
 * IpcModule is a per-feature bundle of typed methods + events. Codegen reads
 * these descriptors at build time to emit channel constants, preload bridge
 * surface, and renderer-side typed clients.
 *
 * Phase 0.3 lands the runtime + a single example module. SPEC §6 Step 3 lists
 * 12 modules to migrate one-by-one. Per REPORT 3.2 Level 3 decision the
 * actual migration of those 12 handler files is a follow-up PR; the runtime
 * machinery here unblocks that work without forcing a single-shot migration.
 */

import type { ZodSchema } from "zod"
import type { IpcOperationId } from "../../../synapse-capabilities/shared/naming"

export type IpcMethodKind = "invoke" | "send"

export interface IpcHandlerLogger {
  child(name: string): {
    info?: (message: string, meta?: unknown) => void
    warn?: (message: string, meta?: unknown) => void
    error: (message: string, meta?: unknown) => void
  }
}

export interface IpcInvocationSender {
  readonly id: number
  isDestroyed(): boolean
  onDestroyed(listener: () => void): () => void
}

export interface IpcInvocationContext {
  readonly sender?: IpcInvocationSender
}

export interface IpcHandlerContext extends IpcInvocationContext {
  /** Module id from IpcModule.id. Useful for logging and metrics. */
  readonly moduleId: string
  /** Optional logger used by transport/runtime adapters. */
  readonly logger?: IpcHandlerLogger
  /**
   * Ad-hoc service lookup hook so the IPC handler can pull other services
   * out of ServiceRegistry without depending on it directly. Wired by the
   * IpcRegistry when the module is registered.
   */
  readonly resolve: <T>(serviceId: string) => T
}

export interface IpcMethodDescriptor<Req = unknown, Res = unknown> {
  readonly kind: IpcMethodKind
  readonly operationId: IpcOperationId
  readonly request: ZodSchema<Req>
  readonly response?: ZodSchema<Res>
  /** Server-side handler. The runtime validates request before dispatch. */
  handler(ctx: IpcHandlerContext, request: Req): Promise<Res> | Res
}

export interface IpcEventDescriptor<Payload = unknown> {
  readonly kind: "event"
  readonly operationId: IpcOperationId
  readonly payload: ZodSchema<Payload>
}

export interface IpcModule {
  readonly id: string
  readonly methods: Readonly<Record<string, IpcMethodDescriptor>>
  readonly events: Readonly<Record<string, IpcEventDescriptor>>
}

export interface IpcRegisterResult {
  readonly moduleId: string
  /** Call to detach the registered handlers (used at module reload time). */
  unregister(): void
}

export interface IpcRegistry {
  register(module: IpcModule, ctx: IpcHandlerContext): IpcRegisterResult
  list(): readonly { moduleId: string; channels: readonly string[] }[]
}
