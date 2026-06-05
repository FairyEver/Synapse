/**
 * Phase 0.2 — DataRepository error types.
 * SPEC §5.
 */

export class DataRepositoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined)
    this.name = "DataRepositoryError"
  }
}

export class NamespaceNotFoundError extends DataRepositoryError {
  readonly namespace: string
  constructor(namespace: string) {
    super(`Data namespace "${namespace}" is not registered`)
    this.name = "NamespaceNotFoundError"
    this.namespace = namespace
  }
}

export class InvalidNamespaceDataError extends DataRepositoryError {
  readonly namespace: string
  constructor(namespace: string, detail?: string) {
    super(
      `Data in namespace "${namespace}" failed validation${detail ? ": " + detail : ""}`,
    )
    this.name = "InvalidNamespaceDataError"
    this.namespace = namespace
  }
}

export class MigrationFailedError extends DataRepositoryError {
  readonly namespace: string
  readonly fromVersion: number
  readonly toVersion: number
  constructor(namespace: string, from: number, to: number, cause: unknown) {
    super(`Migration ${from} -> ${to} failed for namespace "${namespace}"`, { cause })
    this.name = "MigrationFailedError"
    this.namespace = namespace
    this.fromVersion = from
    this.toVersion = to
  }
}

export class MigrationDowngradeError extends DataRepositoryError {
  readonly namespace: string
  readonly currentVersion: number
  readonly targetVersion: number
  constructor(namespace: string, current: number, target: number) {
    super(
      `Migration downgrade is not supported in namespace "${namespace}": currentVersion=${current} > targetVersion=${target}`,
    )
    this.name = "MigrationDowngradeError"
    this.namespace = namespace
    this.currentVersion = current
    this.targetVersion = target
  }
}

export class MissingMigrationError extends DataRepositoryError {
  readonly namespace: string
  readonly currentVersion: number
  readonly targetVersion: number
  constructor(namespace: string, current: number, target: number) {
    super(
      `No migration path from version ${current} to ${target} in namespace "${namespace}"`,
    )
    this.name = "MissingMigrationError"
    this.namespace = namespace
    this.currentVersion = current
    this.targetVersion = target
  }
}

export class EncryptionUnavailableError extends DataRepositoryError {
  constructor(message = "Encryption is not available on this system") {
    super(message)
    this.name = "EncryptionUnavailableError"
  }
}

export class BackupFormatError extends DataRepositoryError {
  constructor(detail: string) {
    super(`Backup format error: ${detail}`)
    this.name = "BackupFormatError"
  }
}
