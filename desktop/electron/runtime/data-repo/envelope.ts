/**
 * Phase 0.2 — Shared envelope type guard for JSON-shaped backends.
 *
 * `JsonNamespace` and `EncryptedJsonNamespace` both serialize a
 * `{ schemaVersion, singleton, items }` envelope. The shape check is
 * structural and identical between them, so it lives here to avoid drift.
 */

import type { JsonFileEnvelope } from "./backends/json"

export function isEnvelopeShape<T>(value: unknown): value is JsonFileEnvelope<T> {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.schemaVersion !== "number") return false
  if (!("singleton" in v)) return false
  if (typeof v.items !== "object" || v.items === null || Array.isArray(v.items)) return false
  return true
}
