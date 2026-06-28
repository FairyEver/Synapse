/**
 * Phase 0.2 — DataRepository orchestrator (T2.13).
 *
 * Wires up registered NamespaceSchemas + per-namespace DataNamespace handles
 * and implements the cross-namespace operations:
 *   - namespace<T>(name): typed handle (or throws NamespaceNotFoundError)
 *   - exportAll({ includeSecrets? }): synapse-backup-v1 payload
 *   - importAll(payload, { merge? }): replace-or-merge namespace contents
 *   - inspect(): summary table for DebugPanel
 *
 * The orchestrator does NOT decide which backend instances to create —
 * callers register schema + handle pairs via `register()`. This keeps the
 * runtime DI-free; main.ts / bootstrap registers exactly what production
 * needs and tests register fakes.
 */

import {
  NamespaceNotFoundError,
} from "./errors"
import type {
  BackupPayload,
  BackupPayloadEntry,
  DataNamespace,
  DataRepository,
  DataRepositoryInspectEntry,
  ExportOptions,
  ImportOptions,
  NamespaceSchema,
} from "./types"

interface RegistrationEntry<T> {
  readonly schema: NamespaceSchema<T>
  readonly handle: DataNamespace<T>
}

export class DataRepositoryImpl implements DataRepository {
  private readonly entries = new Map<string, RegistrationEntry<unknown>>()

  register<T>(schema: NamespaceSchema<T>, handle: DataNamespace<T>): void {
    if (this.entries.has(schema.name)) {
      throw new Error(`Namespace "${schema.name}" already registered`)
    }
    this.entries.set(schema.name, {
      schema: schema as NamespaceSchema<unknown>,
      handle: handle as DataNamespace<unknown>,
    })
  }

  namespace<T>(name: string): DataNamespace<T> {
    const entry = this.entries.get(name)
    if (!entry) {
      throw new NamespaceNotFoundError(name)
    }
    return entry.handle as DataNamespace<T>
  }

  async exportAll(options: ExportOptions = {}): Promise<BackupPayload> {
    const namespaces: BackupPayloadEntry[] = []
    for (const [name, entry] of this.entries) {
      // Skip encrypted namespaces unless caller asked for secrets.
      if (entry.schema.encrypted && !options.includeSecrets) {
        namespaces.push({
          name,
          schemaVersion: entry.schema.currentVersion,
          encrypted: true,
          // The data is intentionally empty; consumers that want secrets must
          // pass includeSecrets:true. We keep the entry so import-time the
          // shape is symmetric.
          data: null,
        })
        continue
      }

      const singleton = await entry.handle.getSingleton()
      const items = await entry.handle.list()

      namespaces.push({
        name,
        schemaVersion: entry.schema.currentVersion,
        encrypted: !!entry.schema.encrypted,
        data: singleton !== null ? { singleton, items } : { items },
      })
    }

    return {
      format: "synapse-backup-v1",
      exportedAt: new Date().toISOString(),
      namespaces,
    }
  }

  async importAll(payload: BackupPayload, options: ImportOptions = {}): Promise<void> {
    if (payload.format !== "synapse-backup-v1") {
      throw new Error(`Unexpected backup format "${payload.format}"`)
    }

    for (const ns of payload.namespaces) {
      const entry = this.entries.get(ns.name)
      if (!entry) continue
      if (entry.schema.encrypted && ns.data === null) continue
      if (typeof ns.data !== "object" || ns.data === null) continue

      const data = ns.data as { singleton?: unknown; items?: unknown[] }

      if (!options.merge) {
        // Replace mode: snapshot existing data before clearing so we can
        // restore if the import fails partway through.
        const snapshot = await entry.handle.list()
        const singletonSnapshot = await entry.handle.getSingleton()
        const shouldClearSingleton = !Object.prototype.hasOwnProperty.call(data, "singleton")
          || data.singleton === null

        const existing = snapshot
        const removedItems: unknown[] = []
        let importStarted = false

        try {
          for (const item of existing) {
            const id = (item as { id?: string }).id
            if (typeof id === "string") {
              await entry.handle.remove(id)
              removedItems.push(item)
            }
          }
          if (shouldClearSingleton) {
            await this.clearNamespaceSingleton(entry)
          }
          importStarted = true
          await this.importNamespaceData(entry, data)
        } catch (err) {
          // Restore from snapshot to prevent data loss.
          if (importStarted) {
            await this.clearNamespaceItems(entry)
          }
          if (removedItems.length > 0 || importStarted) {
            for (const item of snapshot) {
              const id = (item as { id?: string }).id
              if (typeof id === "string") {
                await entry.handle.upsert(item as never)
              }
            }
          }
          if (singletonSnapshot !== null) {
            await entry.handle.setSingleton(singletonSnapshot as never)
          }
          throw err
        }
      } else {
        await this.importNamespaceData(entry, data)
      }
    }
  }

  private async clearNamespaceSingleton(entry: RegistrationEntry<unknown>): Promise<void> {
    if (await entry.handle.getSingleton() === null) return
    if (entry.handle.clearSingleton) {
      await entry.handle.clearSingleton()
      return
    }
    throw new Error(`Namespace "${entry.schema.name}" does not support clearing singleton data`)
  }

  private async clearNamespaceItems(entry: RegistrationEntry<unknown>): Promise<void> {
    const currentItems = await entry.handle.list()
    for (const item of currentItems) {
      const id = (item as { id?: string }).id
      if (typeof id === "string") {
        await entry.handle.remove(id)
      }
    }
  }

  private async importNamespaceData(
    entry: RegistrationEntry<unknown>,
    data: { singleton?: unknown; items?: unknown[] },
  ): Promise<void> {
    if (data.singleton !== undefined && data.singleton !== null) {
      if (entry.schema.validate(data.singleton)) {
        await entry.handle.setSingleton(data.singleton as never)
      }
    }
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (
          item
          && typeof item === "object"
          && typeof (item as { id?: string }).id === "string"
          && entry.schema.validate(item)
        ) {
          await entry.handle.upsert(item as never)
        }
      }
    }
  }

  inspect(): readonly DataRepositoryInspectEntry[] {
    const result: DataRepositoryInspectEntry[] = []
    for (const [name, entry] of this.entries) {
      result.push({
        namespace: name,
        backend: entry.schema.backend,
        schemaVersion: entry.schema.currentVersion,
      })
    }
    return result
  }
}

export function createDataRepository(): DataRepositoryImpl {
  return new DataRepositoryImpl()
}
