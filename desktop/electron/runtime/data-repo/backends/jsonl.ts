/**
 * Phase 0.2 — JSON Lines (newline-delimited JSON) backend.
 *
 * SPEC §15.5: AuditSink writes to `DataRepository.audit` namespace which is
 * append-only / non-deletable. JSONL is the right format here because:
 *   - Append is O(1) regardless of file size.
 *   - Crash mid-write loses at most the last partial line; previous lines are
 *     fully recoverable.
 *   - No "rewrite the whole file" hot-path that other backends have.
 *
 * Records are stored as `{"id": string, ...}` per line. The JSONL file always
 * starts with a single header line: `{"__synapse_jsonl__": 1, "schemaVersion": N}`.
 *
 * Hard rule from SPEC §15.5: `remove()` and `setSingleton()` are NOT supported
 * for audit-style namespaces. Concrete subclasses can opt in via `allowRemove`
 * (e.g. for `outbox` which IS allowed to delete delivered jobs); audit must
 * leave the default.
 */

import { appendFile } from "node:fs/promises"
import path from "node:path"

import { AbstractDataNamespace, type NamespaceBaseDeps } from "../namespace-base"
import {
  fileExists,
  readTextFile,
  writeTextFileAtomic,
} from "../atomic-io"
import {
  DataRepositoryError,
  InvalidNamespaceDataError,
} from "../errors"

const HEADER_KEY = "__synapse_jsonl__"

interface JsonlHeader {
  readonly [HEADER_KEY]: 1
  readonly schemaVersion: number
}

export interface JsonLinesBackendDeps<T> extends NamespaceBaseDeps<T> {
  readonly filePath: string
  /** Default false. Set to true for namespaces that may delete entries. */
  readonly allowRemove?: boolean
  /** Default false. Set to true to allow setSingleton. Not used by audit. */
  readonly allowSingleton?: boolean
  /** Optional validator for read-back items. */
  readonly validate?: (data: unknown) => data is T
}

export class JsonLinesNamespace<T extends Record<string, unknown> & { id: string }>
  extends AbstractDataNamespace<T>
{
  private readonly filePath: string
  private readonly allowRemove: boolean
  private readonly allowSingleton: boolean
  private readonly validate?: (data: unknown) => data is T
  private cache: Map<string, T> | null = null
  private singleton: T | null = null
  private headerWritten = false

  constructor(deps: JsonLinesBackendDeps<T>) {
    super({ ...deps, backend: "jsonl" })
    this.filePath = deps.filePath
    this.allowRemove = deps.allowRemove ?? false
    this.allowSingleton = deps.allowSingleton ?? false
    this.validate = deps.validate
  }

  private async load(): Promise<Map<string, T>> {
    if (this.cache) return this.cache
    const cache = new Map<string, T>()

    if (!(await fileExists(this.filePath))) {
      this.cache = cache
      return cache
    }

    const content = await readTextFile(this.filePath)
    if (!content) {
      this.cache = cache
      return cache
    }

    const lines = content.split("\n")
    let lineNo = 0
    for (const line of lines) {
      lineNo++
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch (err) {
        throw new InvalidNamespaceDataError(
          this.name,
          `line ${lineNo} is not valid JSON: ${(err as Error).message}`,
        )
      }
      if (lineNo === 1 && isHeader(parsed)) {
        this.headerWritten = true
        continue
      }
      if (!isRecordWithId(parsed)) {
        throw new InvalidNamespaceDataError(
          this.name,
          `line ${lineNo} missing required string "id" field`,
        )
      }
      if (this.validate && !this.validate(parsed)) {
        throw new InvalidNamespaceDataError(
          this.name,
          `line ${lineNo} failed validate()`,
        )
      }
      cache.set(parsed.id, parsed as T)
    }
    this.cache = cache
    return cache
  }

  private async ensureHeader(): Promise<void> {
    if (this.headerWritten) return
    if (await fileExists(this.filePath)) {
      // Existing file — `load()` already read or skipped the header.
      this.headerWritten = true
      return
    }
    const header: JsonlHeader = {
      [HEADER_KEY]: 1,
      schemaVersion: this.schemaVersion,
    }
    // First write of the file: use atomic write to seed the header line.
    await writeTextFileAtomic(this.filePath, JSON.stringify(header) + "\n")
    this.headerWritten = true
  }

  async getSingleton(): Promise<T | null> {
    if (!this.allowSingleton) return null
    return this.singleton ?? this.defaults?.() ?? null
  }

  async setSingleton(value: T): Promise<void> {
    if (!this.allowSingleton) {
      throw new DataRepositoryError(
        `setSingleton is not supported on append-only namespace "${this.name}"`,
      )
    }
    const previous = this.singleton
    this.singleton = value
    this.emit({ kind: "replace", value, previous: previous ?? undefined })
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const cache = await this.load()
    return this.applyFilter([...cache.values()], filter)
  }

  async get(id: string): Promise<T | null> {
    const cache = await this.load()
    return cache.get(id) ?? null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    await this.load()
    await this.ensureHeader()
    const previous = this.cache!.get(item.id)
    const line = JSON.stringify(item) + "\n"
    await appendFile(this.filePath, line, "utf8")
    this.cache!.set(item.id, item)
    this.emit({ kind: "upsert", id: item.id, value: item, previous })
  }

  async remove(id: string): Promise<void> {
    if (!this.allowRemove) {
      throw new DataRepositoryError(
        `remove is not supported on append-only namespace "${this.name}"`,
      )
    }
    await this.load()
    const previous = this.cache!.get(id)
    if (!previous) return
    const nextCache = new Map(this.cache!)
    nextCache.delete(id)
    // For removable JSONL we rewrite the whole file. Audit/heavy namespaces
    // should keep allowRemove=false to avoid this hot path.
    await this.rewrite(nextCache.values())
    this.cache = nextCache
    this.emit({ kind: "remove", id, previous })
  }

  /**
   * Compact the file in place. Useful to drop stale entries in `outbox`
   * after delivery. No-op for audit (since allowRemove=false).
   */
  async compact(): Promise<void> {
    if (!this.allowRemove) {
      throw new DataRepositoryError(
        `compact() is not supported on append-only namespace "${this.name}"`,
      )
    }
    await this.load()
    await this.rewrite()
  }

  private async rewrite(items: Iterable<T> = this.cache!.values()): Promise<void> {
    const header: JsonlHeader = {
      [HEADER_KEY]: 1,
      schemaVersion: this.schemaVersion,
    }
    const lines: string[] = [JSON.stringify(header)]
    for (const item of items) {
      lines.push(JSON.stringify(item))
    }
    await writeTextFileAtomic(this.filePath, lines.join("\n") + "\n")
    this.headerWritten = true
  }

  /** Lightweight count without re-parsing every entry. */
  async size(): Promise<number> {
    const cache = await this.load()
    return cache.size
  }

  /** Used by the parent DataRepository for inspect(). */
  fileBaseName(): string {
    return path.basename(this.filePath)
  }
}

function isHeader(value: unknown): value is JsonlHeader {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return v[HEADER_KEY] === 1 && typeof v.schemaVersion === "number"
}

function isRecordWithId(value: unknown): value is { id: string } & Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === "string" && v.id.length > 0
}
