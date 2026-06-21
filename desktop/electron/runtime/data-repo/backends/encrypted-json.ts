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

import { rm } from "node:fs/promises"
import { AbstractDataNamespace, type NamespaceBaseDeps } from "../namespace-base"
import {
  fileExists,
  readBinaryFile,
  readTextFile,
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
  readonly legacyPlaintextFilePath?: string
  readonly safeStorage: SafeStorage
  readonly validate?: (data: unknown) => data is T
}

export class EncryptedJsonNamespace<T extends Record<string, unknown>>
  extends AbstractDataNamespace<T>
{
  private readonly filePath: string
  private readonly legacyPlaintextFilePath: string | undefined
  private readonly safeStorage: SafeStorage
  private readonly validate?: (data: unknown) => data is T
  private cache: JsonFileEnvelope<T> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(deps: EncryptedJsonBackendDeps<T>) {
    super({ ...deps, backend: "encrypted-json" })
    this.filePath = deps.filePath
    this.legacyPlaintextFilePath = deps.legacyPlaintextFilePath
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
      const migrated = await this.loadLegacyPlaintextEnvelope()
      if (migrated) {
        this.cache = migrated
        return migrated
      }
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

    const envelope = this.parseEnvelope(raw, "decrypted")

    this.cache = envelope
    return envelope
  }

  private async loadLegacyPlaintextEnvelope(): Promise<JsonFileEnvelope<T> | null> {
    if (!this.legacyPlaintextFilePath) return null
    const plaintext = await readTextFile(this.legacyPlaintextFilePath)
    if (plaintext === null) return null

    this.ensureEncryptionAvailable()

    let raw: unknown
    try {
      raw = JSON.parse(plaintext)
    } catch (err) {
      throw new InvalidNamespaceDataError(
        this.name,
        `legacy plaintext JSON is malformed: ${(err as Error).message}`,
      )
    }

    const envelope = this.parseEnvelope(raw, "legacy plaintext")
    await this.persist(envelope)
    await this.removeLegacyPlaintextFile()
    return envelope
  }

  private parseEnvelope(raw: unknown, source: string): JsonFileEnvelope<T> {
    if (!isEnvelopeShape<T>(raw)) {
      throw new InvalidNamespaceDataError(this.name, `envelope shape mismatch in ${source}`)
    }

    if (this.validate) {
      if (raw.singleton !== null && !this.validate(raw.singleton)) {
        throw new InvalidNamespaceDataError(this.name, `${source} singleton failed validate()`)
      }
      for (const [id, item] of Object.entries(raw.items)) {
        if (!this.validate(item)) {
          throw new InvalidNamespaceDataError(
            this.name,
            `${source} item id="${id}" failed validate()`,
          )
        }
      }
    }
    return raw
  }

  private async removeLegacyPlaintextFile(): Promise<void> {
    if (!this.legacyPlaintextFilePath) return
    await rm(this.legacyPlaintextFilePath, { force: true })
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

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const run = this.writeQueue.then(operation, operation)
    this.writeQueue = run.catch(() => {})
    return run
  }

  async getSingleton(): Promise<T | null> {
    const env = await this.loadEnvelope()
    return env.singleton
  }

  async setSingleton(value: T): Promise<void> {
    return this.enqueueWrite(async () => {
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
    })
  }

  async clearSingleton(): Promise<void> {
    return this.enqueueWrite(async () => {
      this.ensureEncryptionAvailable()
      const env = await this.loadEnvelope()
      if (env.singleton === null) return
      const previous = env.singleton
      const next = { ...env, singleton: null }
      await this.persist(next)
      this.cache = next
      this.emit({ kind: "clear", previous })
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
    return this.enqueueWrite(async () => {
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
    })
  }

  async remove(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
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
    })
  }
}
