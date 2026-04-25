/**
 * Phase 0.2 — DataRepository module entrypoint.
 *
 * Implementation lands incrementally:
 *   T2.1 (this commit): types + errors + DataNamespace abstract base.
 *   T2.2..T2.5: backends (json / encrypted-json / jsonl / sqlite).
 *   T2.6: migration framework.
 *   T2.7..T2.9: namespace migrations + secrets/providers schema placeholders.
 *   T2.10..T2.12: backup / exporter / layered-config.
 *   T2.13: rewire config-backup-service.
 *   T2.14: phase integration test.
 */

export * from "./types"
export * from "./errors"
export { AbstractDataNamespace } from "./namespace-base"
export type { NamespaceBaseDeps } from "./namespace-base"
export { JsonNamespace } from "./backends/json"
export type { JsonBackendDeps, JsonFileEnvelope } from "./backends/json"
export { EncryptedJsonNamespace } from "./backends/encrypted-json"
export type { EncryptedJsonBackendDeps, SafeStorage } from "./backends/encrypted-json"
export { JsonLinesNamespace } from "./backends/jsonl"
export type { JsonLinesBackendDeps } from "./backends/jsonl"
export {
  copyToTimestampedBackup,
  fileExists,
  readBinaryFile,
  readJsonFile,
  readTextFile,
  writeBinaryFileAtomic,
  writeJsonFileAtomic,
  writeTextFileAtomic,
} from "./atomic-io"
