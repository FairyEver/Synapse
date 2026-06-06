/**
 * Phase 0.3 — IPC runtime barrel.
 *
 * Implementation lands incrementally:
 *   T3.1 (this commit): types + errors + module entrypoint.
 *   T3.2: IpcRegistry runtime + zod validation.
 *   T3.3: codegen tool (scripts/build/generate-ipc.ts).
 *   T3.11: protocol version handshake.
 */

export * from "./types"
export * from "./errors"
export {
  IpcRegistryImpl,
  createInMemoryHarness,
} from "./registry"
export type { IpcRegistryDeps, IpcTransportInstall, InMemoryIpcHarness } from "./registry"
export {
  validateRequest,
  tryValidateResponse,
} from "./validation"
export type { ValidationResult } from "./validation"
export {
  IPC_MINIMUM_CLIENT_VERSION,
  computeHandshakeResponse,
  systemIpcModule,
} from "./handshake"
