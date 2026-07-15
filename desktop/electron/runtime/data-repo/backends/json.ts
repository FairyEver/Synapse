/**
 * Phase 0.2 — JsonBackend implementation.
 *
 * Stores both singleton and collection namespaces as a single JSON file at
 * `<root>/<namespace>.json`. Format:
 *
 *   { "schemaVersion": 1, "singleton": {...} | null, "items": { id: value } }
 *
 * - Singleton namespaces leave `items` as `{}`.
 * - Collection namespaces leave `singleton` as `null`.
 *
 * Reads are cached in memory; writes go through the atomic-io helpers so a
 * crash mid-write leaves the previous file intact.
 */

import path from "node:path"
import { AbstractDataNamespace, type NamespaceBaseDeps } from "../namespace-base"
import {
  fileExists,
  readJsonFile,
  writeJsonFileAtomic,
  writeJsonFileAtomicIfUnchanged,
} from "../atomic-io"
import { InvalidNamespaceDataError } from "../errors"
import { isEnvelopeShape } from "../envelope"

export interface JsonFileEnvelope<T> {
  readonly schemaVersion: number
  readonly singleton: T | null
  readonly items: Record<string, T>
}

export interface JsonBackendDeps<T> extends NamespaceBaseDeps<T> {
  readonly filePath: string
  /** Optional validate hook called after every read. */
  readonly validate?: (data: unknown) => data is T
  /** Optional reviver to migrate older payloads on read. Returns null to discard. */
  readonly reviveEnvelope?: (raw: unknown) => JsonFileEnvelope<T> | null
  /** Workflows preserve malformed source files for explicit recovery. */
  readonly preserveInvalidJson?: boolean
}

export class JsonNamespace<T extends Record<string, unknown>>
  extends AbstractDataNamespace<T>
{
  private readonly filePath: string
  private readonly validate?: (data: unknown) => data is T
  private readonly reviveEnvelope?: (raw: unknown) => JsonFileEnvelope<T> | null
  private readonly preserveInvalidJson: boolean
  private cache: JsonFileEnvelope<T> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(deps: JsonBackendDeps<T>) {
    super({ ...deps, backend: "json" })
    this.filePath = deps.filePath
    this.validate = deps.validate
    this.reviveEnvelope = deps.reviveEnvelope
    this.preserveInvalidJson = deps.preserveInvalidJson ?? false
  }

  protected async loadEnvelope(): Promise<JsonFileEnvelope<T>> {
    if (this.cache) return this.cache

    if (!(await fileExists(this.filePath))) {
      this.cache = this.makeEmpty()
      return this.cache
    }

    const raw = await readJsonFile<unknown>(this.filePath, {
      preserveInvalid: this.preserveInvalidJson,
    })
    if (raw == null) {
      this.cache = this.makeEmpty()
      return this.cache
    }

    let envelope: JsonFileEnvelope<T> | null = null
    if (this.reviveEnvelope) {
      envelope = this.reviveEnvelope(raw)
    } else if (isEnvelopeShape<T>(raw)) {
      envelope = raw
    }

    if (!envelope) {
      throw new InvalidNamespaceDataError(
        this.name,
        `unexpected envelope shape in ${path.basename(this.filePath)}`,
      )
    }

    if (this.validate) {
      if (envelope.singleton !== null && !this.validate(envelope.singleton)) {
        throw new InvalidNamespaceDataError(this.name, "singleton failed validate()")
      }
      for (const [id, item] of Object.entries(envelope.items)) {
        if (!this.validate(item)) {
          throw new InvalidNamespaceDataError(
            this.name,
            `item id="${id}" failed validate()`,
          )
        }
      }
    }

    this.cache = envelope
    return envelope
  }

  protected async persist(envelope: JsonFileEnvelope<T>): Promise<void> {
    await writeJsonFileAtomic(this.filePath, envelope)
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
    const items = Object.values(env.items)
    return this.applyFilter(items, filter)
  }

  async get(id: string): Promise<T | null> {
    const env = await this.loadEnvelope()
    return env.items[id] ?? null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    return this.enqueueWrite(async () => {
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

  async upsertIfFileUnchanged(
    item: T & { id: string },
    expectedSource: Uint8Array | null,
  ): Promise<Uint8Array> {
    let writtenBytes: Uint8Array | undefined
    await this.enqueueWrite(async () => {
      const env = await this.loadEnvelope()
      const previous = env.items[item.id]
      const next = {
        ...env,
        items: { ...env.items, [item.id]: item },
      }
      writtenBytes = await writeJsonFileAtomicIfUnchanged(this.filePath, next, expectedSource)
      this.cache = next
      this.emit({
        kind: "upsert",
        id: item.id,
        value: item,
        previous,
      })
    })
    if (!writtenBytes) throw new Error("Conditional JSON write did not produce output bytes.")
    return writtenBytes
  }

  async remove(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
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

  rowCount(): number {
    if (!this.cache) return 0
    return Object.keys(this.cache.items).length + (this.cache.singleton ? 1 : 0)
  }
}
