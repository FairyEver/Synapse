export interface VersionedData {
  meta: {
    schemaVersion: string
  }
}

export type DataMigration<T> = (source: T) => T

/** The registry must list every schema-changing version; unregistered changes cannot be inferred. */
export type DataMigrationRegistry<T> = Readonly<Record<string, DataMigration<T>>>

export type LegacyVersionedData<T extends VersionedData> = Omit<T, "meta"> & {
  readonly meta?: Omit<T["meta"], "schemaVersion"> & {
    readonly schemaVersion?: undefined
  }
}

export interface MigrateVersionedDataOptions<T extends VersionedData> {
  readonly source: T | LegacyVersionedData<T>
  readonly sourceVersion: string
  readonly targetVersion: string
  readonly migrations: DataMigrationRegistry<T>
  readonly legacyBaselineVersion?: string
  readonly validate: (data: unknown) => asserts data is T
}

type VersionRole = "source" | "target" | "migration" | "legacy baseline"

interface ParsedSemanticVersion {
  readonly core: readonly [string, string, string]
  readonly prerelease: readonly string[] | null
}

const NUMERIC_IDENTIFIER_PATTERN = "(?:0|[1-9]\\d*)"
const NON_NUMERIC_IDENTIFIER_PATTERN = "(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
const PRERELEASE_IDENTIFIER_PATTERN = `(?:${NUMERIC_IDENTIFIER_PATTERN}|${NON_NUMERIC_IDENTIFIER_PATTERN})`
const SEMANTIC_VERSION_PATTERN = new RegExp(
  `^(${NUMERIC_IDENTIFIER_PATTERN})\\.(${NUMERIC_IDENTIFIER_PATTERN})\\.(${NUMERIC_IDENTIFIER_PATTERN})`
    + `(?:-(${PRERELEASE_IDENTIFIER_PATTERN}(?:\\.${PRERELEASE_IDENTIFIER_PATTERN})*))?`
    + "$",
)

export class InvalidSchemaVersionError extends Error {
  readonly version: string
  readonly role: VersionRole

  constructor(version: string, role: VersionRole) {
    super(`Invalid ${role} schema version: "${version}".`)
    this.name = "InvalidSchemaVersionError"
    this.version = version
    this.role = role
  }
}

export class MissingSchemaVersionError extends Error {
  constructor() {
    super("Versioned data is missing meta.schemaVersion.")
    this.name = "MissingSchemaVersionError"
  }
}

export class SchemaVersionMismatchError extends Error {
  readonly embeddedVersion: string
  readonly sourceVersion: string

  constructor(embeddedVersion: string, sourceVersion: string) {
    super(
      `Data schema version "${embeddedVersion}" does not match sourceVersion "${sourceVersion}".`,
    )
    this.name = "SchemaVersionMismatchError"
    this.embeddedVersion = embeddedVersion
    this.sourceVersion = sourceVersion
  }
}

export class UnsupportedFutureVersionError extends Error {
  readonly sourceVersion: string
  readonly targetVersion: string

  constructor(sourceVersion: string, targetVersion: string) {
    super(
      `Schema version "${sourceVersion}" is newer than supported version "${targetVersion}".`,
    )
    this.name = "UnsupportedFutureVersionError"
    this.sourceVersion = sourceVersion
    this.targetVersion = targetVersion
  }
}

export class DataMigrationError extends Error {
  readonly fromVersion: string
  readonly toVersion: string

  constructor(fromVersion: string, toVersion: string, cause: unknown) {
    super(`Failed to migrate schema from "${fromVersion}" to "${toVersion}".`, { cause })
    this.name = "DataMigrationError"
    this.fromVersion = fromVersion
    this.toVersion = toVersion
  }
}

export class DataMigrationCloneError extends Error {
  readonly sourceVersion: string

  constructor(sourceVersion: string, cause: unknown) {
    super(`Failed to clone data at schema version "${sourceVersion}".`, { cause })
    this.name = "DataMigrationCloneError"
    this.sourceVersion = sourceVersion
  }
}

export class IncompleteDataMigrationError extends Error {
  readonly reachedVersion: string
  readonly targetVersion: string

  constructor(reachedVersion: string, targetVersion: string) {
    super(
      `Migration chain ended at "${reachedVersion}" before target version "${targetVersion}".`,
    )
    this.name = "IncompleteDataMigrationError"
    this.reachedVersion = reachedVersion
    this.targetVersion = targetVersion
  }
}

export class DataMigrationValidationError extends Error {
  readonly targetVersion: string

  constructor(targetVersion: string, cause: unknown) {
    super(`Migrated data failed validation for schema version "${targetVersion}".`, { cause })
    this.name = "DataMigrationValidationError"
    this.targetVersion = targetVersion
  }
}

/**
 * Pure in-memory utility for upgrading versioned data through ordered schema migrations.
 * Migrations must be synchronous and side-effect free. The caller remains responsible for
 * backups, concurrency checks, transactions, and atomically persisting the validated result.
 * Source data must be structured-cloneable; functions and runtime class behavior are unsupported.
 * Schema versions follow SemVer precedence but must not contain build metadata (`+...`).
 */
export class VersionedDataMigrator {
  static migrate<T extends VersionedData>(options: MigrateVersionedDataOptions<T>): T {
    const { source, sourceVersion, targetVersion, migrations } = options

    const parsedSourceVersion = parseSemanticVersion(sourceVersion, "source")
    const parsedTargetVersion = parseSemanticVersion(targetVersion, "target")
    const embeddedVersion = VersionedDataMigrator.readSchemaVersion(
      source,
      options.legacyBaselineVersion,
    )

    if (embeddedVersion !== sourceVersion) {
      throw new SchemaVersionMismatchError(embeddedVersion, sourceVersion)
    }
    if (compareParsedVersions(parsedSourceVersion, parsedTargetVersion) > 0) {
      throw new UnsupportedFutureVersionError(sourceVersion, targetVersion)
    }

    const parsedMigrationVersions = Object.keys(migrations).map((version) => ({
      parsed: parseSemanticVersion(version, "migration"),
      version,
    }))
    parsedMigrationVersions.sort((left, right) => compareParsedVersions(left.parsed, right.parsed))

    let result: T
    try {
      result = structuredClone(source) as T
    } catch (error) {
      throw new DataMigrationCloneError(sourceVersion, error)
    }
    setSchemaVersion(result, sourceVersion)
    let reachedVersion = sourceVersion
    const pendingMigrations = parsedMigrationVersions.filter(({ parsed }) => (
      compareParsedVersions(parsed, parsedSourceVersion) > 0
      && compareParsedVersions(parsed, parsedTargetVersion) <= 0
    ))

    for (const { version } of pendingMigrations) {
      try {
        const migration = migrations[version]
        if (migration.constructor.name === "AsyncFunction") {
          throw new TypeError("Migration functions must be synchronous and return migrated data.")
        }
        const migrated = migration(result)
        if (isPromiseLike(migrated)) {
          void Promise.resolve(migrated).catch(() => undefined)
          throw new TypeError("Migration functions must be synchronous and return migrated data.")
        }
        result = migrated
        setSchemaVersion(result, version)
      } catch (error) {
        throw new DataMigrationError(reachedVersion, version, error)
      }
      reachedVersion = version
    }

    if (VersionedDataMigrator.compareVersions(reachedVersion, targetVersion) !== 0) {
      throw new IncompleteDataMigrationError(reachedVersion, targetVersion)
    }

    const validate: (data: unknown) => void = options.validate
    try {
      validate(result)
    } catch (error) {
      throw new DataMigrationValidationError(targetVersion, error)
    }

    return result
  }

  static compareVersions(left: string, right: string): number {
    return compareParsedVersions(
      parseSemanticVersion(left, "source"),
      parseSemanticVersion(right, "target"),
    )
  }

  static readSchemaVersion(source: unknown, legacyBaselineVersion?: string): string {
    if (isRecord(source) && isRecord(source.meta) && "schemaVersion" in source.meta) {
      const version = source.meta.schemaVersion
      if (typeof version !== "string") {
        throw new InvalidSchemaVersionError(String(version), "source")
      }
      parseSemanticVersion(version, "source")
      return version
    }
    if (legacyBaselineVersion !== undefined) {
      parseSemanticVersion(legacyBaselineVersion, "legacy baseline")
      return legacyBaselineVersion
    }
    throw new MissingSchemaVersionError()
  }
}

function parseSemanticVersion(version: string, role: VersionRole): ParsedSemanticVersion {
  const match = SEMANTIC_VERSION_PATTERN.exec(version)
  if (!match) throw new InvalidSchemaVersionError(version, role)

  return {
    core: [match[1]!, match[2]!, match[3]!],
    prerelease: match[4]?.split(".") ?? null,
  }
}

function compareParsedVersions(left: ParsedSemanticVersion, right: ParsedSemanticVersion): number {
  for (let index = 0; index < left.core.length; index += 1) {
    const comparison = compareNumericIdentifiers(left.core[index]!, right.core[index]!)
    if (comparison !== 0) return comparison
  }

  if (left.prerelease === null && right.prerelease === null) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftIsNumeric = /^\d+$/.test(leftIdentifier)
    const rightIsNumeric = /^\d+$/.test(rightIdentifier)
    if (leftIsNumeric && rightIsNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier)
    }
    if (leftIsNumeric) return -1
    if (rightIsNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }

  return 0
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function setSchemaVersion(source: unknown, version: string): asserts source is VersionedData {
  if (!isRecord(source)) {
    throw new TypeError("Migration result must contain meta.schemaVersion.")
  }
  if (source.meta === undefined) source.meta = {}
  if (!isRecord(source.meta)) throw new TypeError("Migration result meta must be an object.")
  source.meta.schemaVersion = version
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === "function"
}
