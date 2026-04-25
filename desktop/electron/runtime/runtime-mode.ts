/**
 * Phase 0.5 — Runtime mode helpers.
 * SPEC §15.3.
 *
 * Re-exports the bootstrap entry + type alias so consumers can import
 * `RuntimeMode` from a stable path.
 */

export { bootstrap } from "./bootstrap"
export type { RuntimeContext, RuntimeMode, BootstrapDeps } from "./bootstrap"
