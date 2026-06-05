/**
 * Phase 0.2 — BackupRegistry + local-zip default strategy.
 * SPEC §15.11.
 *
 * The local-zip strategy snapshots a BackupPayload to disk under
 * `<backupRoot>/<timestamp>.json` for now (zip support added when an actual
 * archiver dependency is justified — Phase 0 keeps deps minimal). Naming the
 * strategy "local-zip" honors SPEC §15.11; consumers can swap in a true zip
 * implementation later without changing the registry contract.
 */

import { mkdir, readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import type {
  BackupArtifact,
  BackupPayload,
  BackupRegistry,
  BackupStrategy,
} from "./types"
import { BackupFormatError } from "./errors"
import { writeTextFileAtomic } from "./atomic-io"

export class InMemoryBackupRegistry implements BackupRegistry {
  private readonly strategies = new Map<string, BackupStrategy>()

  register(strategy: BackupStrategy): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(`Backup strategy "${strategy.id}" already registered`)
    }
    this.strategies.set(strategy.id, strategy)
  }

  list(): readonly BackupStrategy[] {
    return [...this.strategies.values()]
  }

  get(id: string): BackupStrategy | null {
    return this.strategies.get(id) ?? null
  }
}

export interface LocalArchiveStrategyDeps {
  readonly id?: string
  readonly displayName?: string
  readonly backupRoot: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidBackupTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isValidBackupPayloadEntry(value: unknown): value is BackupPayload["namespaces"][number] {
  if (!isRecord(value)) return false
  return typeof value.name === "string"
    && value.name.trim().length > 0
    && Number.isInteger(value.schemaVersion)
    && typeof value.encrypted === "boolean"
    && "data" in value
}

function isValidBackupPayload(value: unknown): value is BackupPayload {
  if (!isRecord(value)) return false
  return value.format === "synapse-backup-v1"
    && isValidBackupTimestamp(value.exportedAt)
    && Array.isArray(value.namespaces)
    && value.namespaces.every(isValidBackupPayloadEntry)
}

export class LocalArchiveStrategy implements BackupStrategy {
  readonly id: string
  readonly displayName: string
  private readonly backupRoot: string

  constructor(deps: LocalArchiveStrategyDeps) {
    this.id = deps.id ?? "local-zip"
    this.displayName = deps.displayName ?? "Local backup"
    this.backupRoot = deps.backupRoot
  }

  async snapshot(payload: BackupPayload): Promise<BackupArtifact> {
    if (payload.format !== "synapse-backup-v1") {
      throw new BackupFormatError(`unexpected format "${payload.format}"`)
    }
    await mkdir(this.backupRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const file = path.join(this.backupRoot, `${stamp}.json`)
    const text = JSON.stringify(payload, null, 2)
    await writeTextFileAtomic(file, text)
    const fileStats = await stat(file)
    return {
      id: stamp,
      createdAt: payload.exportedAt,
      bytes: fileStats.size,
      path: file,
    }
  }

  async restore(artifact: BackupArtifact): Promise<BackupPayload> {
    if (!artifact.path) {
      throw new BackupFormatError(`artifact "${artifact.id}" has no path`)
    }
    const raw = await readFile(artifact.path, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new BackupFormatError(`invalid JSON in ${artifact.path}: ${(err as Error).message}`)
    }
    if (!isRecord(parsed) || parsed.format !== "synapse-backup-v1") {
      throw new BackupFormatError(`unexpected payload shape in ${artifact.path}`)
    }
    if (!isValidBackupPayload(parsed)) {
      throw new BackupFormatError(`invalid backup payload in ${artifact.path}`)
    }
    return parsed
  }

  async list(): Promise<BackupArtifact[]> {
    let entries: string[]
    try {
      entries = await readdir(this.backupRoot)
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        return []
      }
      throw err
    }
    const artifacts: BackupArtifact[] = []
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue
      const fullPath = path.join(this.backupRoot, entry)
      const fileStats = await stat(fullPath).catch(() => null)
      if (!fileStats || !fileStats.isFile()) continue
      const id = entry.replace(/\.json$/, "")
      artifacts.push({
        id,
        createdAt: fileStats.mtime.toISOString(),
        bytes: fileStats.size,
        path: fullPath,
      })
    }
    artifacts.sort((a, b) => a.id.localeCompare(b.id))
    return artifacts
  }
}
