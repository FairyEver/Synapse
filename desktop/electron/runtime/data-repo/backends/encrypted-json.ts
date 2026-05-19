/**
 * Phase 0.2 — Encrypted JSON backend.
 *
 * SPEC §5: API key / OAuth token / secret material lands here. Uses Electron's
 * `safeStorage` so the underlying key material is OS-managed:
 *   - macOS: Keychain entry "Synapse Safe Storage"
 *   - Windows: DPAPI
 *   - Linux: kwallet / Gnome Keyring
 *
 * Hard rule from SPEC §5: when `safeStorage.isEncryptionAvailable()` returns
 * false (Linux without keyring), DO NOT silently fall back to plaintext. Throw
 * `EncryptionUnavailableError` so the UI can surface the situation.
 *
 * Test ergonomics: Electron's `safeStorage` lives behind the global `electron`
 * module which is impractical to import in unit tests. We accept an injectable
 * `safeStorage` shim so tests can swap in a deterministic implementation.
 */

import { AbstractDataNamespace, type NamespaceBaseDeps } from "../namespace-base"
import {
  fileExists,
  readBinaryFile,
  writeBinaryFileAtomic,
} from "../atomic-io"
import {
  EncryptionUnavailableError,
  InvalidNamespaceDataError,
} from "../errors"
import type { JsonFileEnvelope } from "./json"
import { isEnvelopeShape } from "../envelope"

export interface SafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(cipher: Buffer): string
}

export interface EncryptedJsonBackendDeps<T> extends NamespaceBaseDeps<T> {
  readonly filePath: string
  readonly safeStorage: SafeStorage
  readonly validate?: (data: unknown) => data is T
}

export class EncryptedJsonNamespace<T extends Record<string, unknown>>
  extends AbstractDataNamespace<T>
{
  private readonly filePath: string
  private readonly safeStorage: SafeStorage
  private readonly validate?: (data: unknown) => data is T
  private cache: JsonFileEnvelope<T> | null = null

  constructor(deps: EncryptedJsonBackendDeps<T>) {
    super({ ...deps, backend: "encrypted-json" })
    this.filePath = deps.filePath
    this.safeStorage = deps.safeStorage
    this.validate = deps.validate
  }

  private ensureEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new EncryptionUnavailableError(
        `Encryption unavailable for namespace "${this.name}". On Linux this usually means no kwallet/Gnome Keyring is configured.`,
      )
    }
  }

  private async loadEnvelope(): Promise<JsonFileEnvelope<T>> {
    if (this.cache) return this.cache

    if (!(await fileExists(this.filePath))) {
      this.cache = this.makeEmpty()
      return this.cache
    }

    this.ensureEncryptionAvailable()

    const cipher = await readBinaryFile(this.filePath)
    if (!cipher || cipher.byteLength === 0) {
      this.cache = this.makeEmpty()
      return this.cache
    }

    const plaintext = this.safeStorage.decryptString(Buffer.from(cipher))
    let raw: unknown
    try {
      raw = JSON.parse(plaintext)
    } catch (err) {
      throw new InvalidNamespaceDataError(
        this.name,
        `decrypted JSON is malformed: ${(err as Error).message}`,
      )
    }

    if (!isEnvelopeShape<T>(raw)) {
      throw new InvalidNamespaceDataError(this.name, "envelope shape mismatch after decrypt")
    }

    if (this.validate) {
      if (raw.singleton !== null && !this.validate(raw.singleton)) {
        throw new InvalidNamespaceDataError(this.name, "decrypted singleton failed validate()")
      }
      for (const [id, item] of Object.entries(raw.items)) {
        if (!this.validate(item)) {
          throw new InvalidNamespaceDataError(
            this.name,
            `decrypted item id="${id}" failed validate()`,
          )
        }
      }
    }

    this.cache = raw
    return raw
  }

  private async persist(envelope: JsonFileEnvelope<T>): Promise<void> {
    this.ensureEncryptionAvailable()
    const plaintext = JSON.stringify(envelope)
    const cipher = this.safeStorage.encryptString(plaintext)
    const bytes = new Uint8Array(cipher.buffer, cipher.byteOffset, cipher.byteLength)
    await writeBinaryFileAtomic(this.filePath, bytes, { mode: 0o600 })
  }

  private makeEmpty(): JsonFileEnvelope<T> {
    return {
      schemaVersion: this.schemaVersion,
      singleton: this.defaults?.() ?? null,
      items: {},
    }
  }

  async getSingleton(): Promise<T | null> {
    const env = await this.loadEnvelope()
    return env.singleton
  }

  async setSingleton(value: T): Promise<void> {
    this.ensureEncryptionAvailable()
    const env = await this.loadEnvelope()
    const previous = env.singleton
    const next = { ...env, singleton: value }
    await this.persist(next)
    this.cache = next
    this.emit({
      kind: "replace",
      value,
      previous: previous ?? undefined,
    })
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const env = await this.loadEnvelope()
    return this.applyFilter(Object.values(env.items), filter)
  }

  async get(id: string): Promise<T | null> {
    const env = await this.loadEnvelope()
    return env.items[id] ?? null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    this.ensureEncryptionAvailable()
    const env = await this.loadEnvelope()
    const previous = env.items[item.id]
    const next = {
      ...env,
      items: { ...env.items, [item.id]: item },
    }
    await this.persist(next)
    this.cache = next
    this.emit({
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
    })
  }

  async remove(id: string): Promise<void> {
    this.ensureEncryptionAvailable()
    const env = await this.loadEnvelope()
    if (!(id in env.items)) return
    const previous = env.items[id]
    const { [id]: _removed, ...rest } = env.items
    void _removed
    const next = { ...env, items: rest }
    await this.persist(next)
    this.cache = next
    this.emit({ kind: "remove", id, previous })
  }
}
