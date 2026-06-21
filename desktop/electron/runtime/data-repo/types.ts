/**
 * Phase 0.2 — DataRepository public types.
 * SPEC §5.
 *
 * Cross-phase placeholder interfaces (BackupStrategy, NamespaceExporter,
 * LayeredConfig — §15.8/§15.11) live in this file too, but are typed only;
 * implementations land in T2.10–T2.12.
 */

export type BackendKind = "json" | "encrypted-json" | "sqlite" | "jsonl"

export interface DataChangeEvent<T = unknown> {
  readonly namespace: string
  readonly kind: "upsert" | "remove" | "replace" | "clear"
  readonly id?: string
  readonly value?: T
  readonly previous?: T
  readonly timestamp: string
}

export type DataChangeListener<T> = (change: DataChangeEvent<T>) => void

export interface DataNamespace<T> {
  readonly name: string
  /** Schema version stored alongside the data; bump via migration. */
  readonly schemaVersion: number
  /** Backend kind from the schema definition. */
  readonly backend: BackendKind
  /**
   * Singleton accessor — for namespaces that hold a single root record (e.g.
   * core.config). Returns null when nothing has been written yet.
   */
  getSingleton(): Promise<T | null>
  setSingleton(value: T): Promise<void>
  clearSingleton?(): Promise<void>
  /** List form — for collection namespaces (e.g. projects, conversations). */
  list(filter?: Partial<T>): Promise<T[]>
  count?(filter?: Partial<T>): Promise<number>
  get(id: string): Promise<T | null>
  upsert(item: T & { id: string }): Promise<void>
  remove(id: string): Promise<void>
  /** Subscribe to change events on this namespace. Returns an unsubscribe fn. */
  onChange(listener: DataChangeListener<T>): () => void
}

export interface BackupPayloadEntry {
  readonly name: string
  readonly schemaVersion: number
  readonly encrypted: boolean
  /** Decrypted JSON-able value; for encrypted entries the field is a string ciphertext. */
  readonly data: unknown
}

export interface BackupPayload {
  readonly format: "synapse-backup-v1"
  readonly exportedAt: string
  readonly namespaces: readonly BackupPayloadEntry[]
}

export interface ExportOptions {
  readonly includeSecrets?: boolean
}

export interface ImportOptions {
  readonly merge?: boolean
}

export interface DataRepositoryInspectEntry {
  readonly namespace: string
  readonly backend: BackendKind
  readonly schemaVersion: number
  readonly rowCount?: number
}

export interface DataRepository {
  /**
   * Fetch (or create) the typed namespace handle. Calling twice with the same
   * name returns the same handle.
   */
  namespace<T>(name: string): DataNamespace<T>
  exportAll(options?: ExportOptions): Promise<BackupPayload>
  importAll(payload: BackupPayload, options?: ImportOptions): Promise<void>
  inspect(): readonly DataRepositoryInspectEntry[]
}

// ------- Migration framework (T2.6) ----------------------------------

export interface Migration<From = unknown, To = unknown> {
  readonly from: number
  readonly to: number
  migrate(data: From): To | Promise<To>
}

export interface NamespaceSchema<T> {
  readonly name: string
  readonly backend: BackendKind
  readonly currentVersion: number
  readonly migrations: readonly Migration[]
  /** Type guard — used after migration to validate the final shape. */
  readonly validate: (data: unknown) => data is T
  /** True if values must round-trip through the encrypted backend. */
  readonly encrypted?: boolean
  /** Initial value to write when the namespace is first read. */
  readonly defaults?: () => T
}

// ------- Layered config (T2.12, §15.8) -------------------------------

export interface ConfigScope {
  readonly repositoryId?: string
  readonly projectId?: string
  readonly sessionId?: string
}

export interface LayeredConfig<T> {
  readonly defaults: T
  resolveFor(scope: ConfigScope): Promise<T>
  setAt(scope: ConfigScope, patch: Partial<T>): Promise<void>
  watchResolved(scope: ConfigScope, listener: (value: T) => void): () => void
}

// ------- Backup strategies (T2.10, §15.11) ---------------------------

export interface BackupArtifact {
  readonly id: string
  readonly createdAt: string
  readonly bytes: number
  readonly path?: string
}

export interface BackupStrategy {
  readonly id: string
  readonly displayName: string
  snapshot(payload: BackupPayload): Promise<BackupArtifact>
  restore(artifact: BackupArtifact): Promise<BackupPayload>
  list(): Promise<BackupArtifact[]>
}

export interface BackupRegistry {
  register(strategy: BackupStrategy): void
  list(): readonly BackupStrategy[]
  get(id: string): BackupStrategy | null
}

// ------- Namespace exporters (T2.11, §15.11) -------------------------

export type ExporterFormat = "json" | "csv" | "markdown" | "sqlite"

export interface NamespaceExporter<T = unknown> {
  readonly namespace: string
  readonly format: ExporterFormat
  export(items: readonly T[]): Promise<Uint8Array | string>
}

export interface ExporterRegistry {
  register<T>(exporter: NamespaceExporter<T>): void
  list(): readonly NamespaceExporter[]
  exportAs(namespace: string, format: ExporterFormat, items: readonly unknown[]): Promise<Uint8Array | string>
}
