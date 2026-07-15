import { describe, expect, it, vi } from "vitest"
import {
  DataMigrationCloneError,
  DataMigrationError,
  DataMigrationValidationError,
  IncompleteDataMigrationError,
  InvalidSchemaVersionError,
  MissingSchemaVersionError,
  SchemaVersionMismatchError,
  UnsupportedFutureVersionError,
  VersionedDataMigrator,
  type DataMigrationRegistry,
  type VersionedData,
} from "../dist/versioned-data-migrator.cjs"

interface TestItem {
  name?: string
  displayName?: string
  enabled?: boolean
}

interface TestData extends VersionedData {
  items: TestItem[]
  steps: string[]
}

function createData(version: string): TestData {
  return {
    meta: { schemaVersion: version },
    items: [{ name: "First" }],
    steps: [],
  }
}

function createMigrations(): DataMigrationRegistry<TestData> {
  return {
    "1.0.1": (source) => {
      source.steps.push("1.0.1")
      for (const item of source.items) {
        if (item.enabled === undefined) item.enabled = true
      }
      return source
    },
    "1.0.2": (source) => {
      source.steps.push("1.0.2")
      for (const item of source.items) {
        if (item.displayName === undefined) item.displayName = item.name
        delete item.name
      }
      return source
    },
  }
}

function validateTestData(data: unknown): asserts data is TestData {
  if (typeof data !== "object" || data === null) throw new Error("data must be an object")
  const candidate = data as Partial<TestData>
  if (
    typeof candidate.meta?.schemaVersion !== "string"
    || !Array.isArray(candidate.items)
    || !Array.isArray(candidate.steps)
  ) {
    throw new Error("data does not match TestData")
  }
}

describe("VersionedDataMigrator", () => {
  it("migrates 1.0.0 to 1.0.1", () => {
    const result = VersionedDataMigrator.migrate({
      source: createData("1.0.0"),
      sourceVersion: "1.0.0",
      targetVersion: "1.0.1",
      migrations: createMigrations(),
      validate: validateTestData,
    })

    expect(result.meta.schemaVersion).toBe("1.0.1")
    expect(result.items[0]?.enabled).toBe(true)
    expect(result.steps).toEqual(["1.0.1"])
  })

  it("migrates 1.0.0 to 1.0.2 through every step in order", () => {
    const result = VersionedDataMigrator.migrate({
      source: createData("1.0.0"),
      sourceVersion: "1.0.0",
      targetVersion: "1.0.2",
      migrations: createMigrations(),
      validate: validateTestData,
    })

    expect(result.meta.schemaVersion).toBe("1.0.2")
    expect(result.items[0]).toEqual({ enabled: true, displayName: "First" })
    expect(result.steps).toEqual(["1.0.1", "1.0.2"])
  })

  it("migrates 1.0.1 to 1.0.2 without rerunning older steps", () => {
    const source = createData("1.0.1")
    source.items[0]!.enabled = true

    const result = VersionedDataMigrator.migrate({
      source,
      sourceVersion: "1.0.1",
      targetVersion: "1.0.2",
      migrations: createMigrations(),
      validate: validateTestData,
    })

    expect(result.steps).toEqual(["1.0.2"])
  })

  it("validates but does not migrate data already at the target version", () => {
    const source = createData("1.0.2")
    const migration = vi.fn((data: TestData) => data)
    const validate = vi.fn((data: unknown): asserts data is TestData => {
      if (typeof data !== "object" || data === null) throw new Error("invalid")
    })

    const result = VersionedDataMigrator.migrate({
      source,
      sourceVersion: "1.0.2",
      targetVersion: "1.0.2",
      migrations: { "1.0.2": migration },
      validate,
    })

    expect(migration).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledOnce()
    expect(result).toEqual(source)
    expect(result).not.toBe(source)
  })

  it("rejects data newer than the target version", () => {
    expect(() => VersionedDataMigrator.migrate({
      source: createData("1.0.3"),
      sourceVersion: "1.0.3",
      targetVersion: "1.0.2",
      migrations: createMigrations(),
      validate: validateTestData,
    })).toThrow(UnsupportedFutureVersionError)
  })

  it("rejects an incomplete migration chain", () => {
    expect(() => VersionedDataMigrator.migrate({
      source: createData("1.0.0"),
      sourceVersion: "1.0.0",
      targetVersion: "1.0.2",
      migrations: {
        "1.0.1": createMigrations()["1.0.1"],
      },
      validate: validateTestData,
    })).toThrow(IncompleteDataMigrationError)
  })

  it("keeps the original data unchanged and reports the failing step", () => {
    const source = createData("1.0.0")
    const original = structuredClone(source)
    const cause = new Error("boom")

    expect(() => VersionedDataMigrator.migrate({
      source,
      sourceVersion: "1.0.0",
      targetVersion: "1.0.2",
      migrations: {
        "1.0.1": (data) => {
          data.steps.push("1.0.1")
          return data
        },
        "1.0.2": () => {
          throw cause
        },
      },
      validate: validateTestData,
    })).toThrow(expect.objectContaining({
      cause,
      fromVersion: "1.0.1",
      toVersion: "1.0.2",
    }))
    expect(source).toEqual(original)
  })

  it("reports data that cannot be safely cloned", () => {
    const source = {
      ...createData("1.0.0"),
      callback: () => undefined,
    }

    expect(() => VersionedDataMigrator.migrate<TestData & { callback: () => void }>({
      source,
      sourceVersion: "1.0.0",
      targetVersion: "1.0.0",
      migrations: {},
      validate: (data: unknown): asserts data is TestData & { callback: () => void } => {
        validateTestData(data)
        if (typeof data.callback !== "function") throw new Error("callback is required")
      },
    })).toThrow(DataMigrationCloneError)
  })

  it("rejects accidentally asynchronous migration functions with step context", () => {
    const asyncMigration = (async (data: TestData) => data) as unknown as (
      source: TestData,
    ) => TestData
    let error: unknown

    try {
      VersionedDataMigrator.migrate({
        source: createData("1.0.0"),
        sourceVersion: "1.0.0",
        targetVersion: "1.0.1",
        migrations: { "1.0.1": asyncMigration },
        validate: validateTestData,
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(DataMigrationError)
    expect(error).toMatchObject({ fromVersion: "1.0.0", toVersion: "1.0.1" })
    expect((error as DataMigrationError).cause).toEqual(expect.objectContaining({
      message: "Migration functions must be synchronous and return migrated data.",
    }))
  })

  it("does not overwrite an existing value and supports idempotent migration functions", () => {
    const migration = (data: TestData): TestData => {
      for (const item of data.items) {
        if (item.enabled === undefined) item.enabled = true
      }
      return data
    }
    const source = createData("1.0.0")
    source.items[0]!.enabled = false

    const once = migration(structuredClone(source))
    const twice = migration(structuredClone(once))

    expect(once.items[0]?.enabled).toBe(false)
    expect(twice).toEqual(once)
  })

  it("reads an explicit legacy baseline only when the version field is missing", () => {
    expect(VersionedDataMigrator.readSchemaVersion({ items: [] }, "1.0.0")).toBe("1.0.0")
    expect(() => VersionedDataMigrator.readSchemaVersion({ items: [] })).toThrow(
      MissingSchemaVersionError,
    )
    expect(() => VersionedDataMigrator.readSchemaVersion({
      meta: { schemaVersion: 1 },
    }, "1.0.0")).toThrow(InvalidSchemaVersionError)
  })

  it("migrates unversioned legacy data through an explicit baseline", () => {
    const source = {
      items: [{ name: "First" }],
      steps: [],
    }
    const baselineVersion = "1.0.0"
    const sourceVersion = VersionedDataMigrator.readSchemaVersion(source, baselineVersion)

    const result = VersionedDataMigrator.migrate<TestData>({
      source,
      sourceVersion,
      targetVersion: "1.0.2",
      migrations: createMigrations(),
      legacyBaselineVersion: baselineVersion,
      validate: validateTestData,
    })

    expect(result.meta.schemaVersion).toBe("1.0.2")
    expect(result.items[0]).toEqual({ enabled: true, displayName: "First" })
    expect(result.steps).toEqual(["1.0.1", "1.0.2"])
    expect(source).not.toHaveProperty("meta")
  })

  it("uses semantic version precedence instead of string ordering", () => {
    const steps: string[] = []
    const source = createData("1.0.0")

    const result = VersionedDataMigrator.migrate({
      source,
      sourceVersion: "1.0.0",
      targetVersion: "1.0.10",
      migrations: {
        "1.0.10": (data) => {
          steps.push("1.0.10")
          return data
        },
        "1.0.2": (data) => {
          steps.push("1.0.2")
          return data
        },
      },
      validate: validateTestData,
    })

    expect(result.meta.schemaVersion).toBe("1.0.10")
    expect(steps).toEqual(["1.0.2", "1.0.10"])
    expect(VersionedDataMigrator.compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0)
    expect(VersionedDataMigrator.compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0)
  })

  it("rejects invalid versions and mismatched embedded versions", () => {
    expect(() => VersionedDataMigrator.compareVersions("1.0", "1.0.0")).toThrow(
      InvalidSchemaVersionError,
    )
    expect(() => VersionedDataMigrator.compareVersions("1.0.0+build.1", "1.0.0")).toThrow(
      InvalidSchemaVersionError,
    )
    expect(() => VersionedDataMigrator.migrate({
      source: createData("1.0.1"),
      sourceVersion: "1.0.0",
      targetVersion: "1.0.2",
      migrations: createMigrations(),
      validate: validateTestData,
    })).toThrow(SchemaVersionMismatchError)
  })

  it("wraps migration failures with their version context", () => {
    let error: unknown
    try {
      VersionedDataMigrator.migrate({
        source: createData("1.0.0"),
        sourceVersion: "1.0.0",
        targetVersion: "1.0.1",
        migrations: {
          "1.0.1": () => {
            throw new Error("failed")
          },
        },
        validate: validateTestData,
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(DataMigrationError)
    expect(error).toMatchObject({ fromVersion: "1.0.0", toVersion: "1.0.1" })
  })

  it("returns no result when final schema validation fails", () => {
    expect(() => VersionedDataMigrator.migrate({
      source: createData("1.0.0"),
      sourceVersion: "1.0.0",
      targetVersion: "1.0.1",
      migrations: createMigrations(),
      validate: (_data: unknown): asserts _data is TestData => {
        throw new Error("invalid schema")
      },
    })).toThrow(DataMigrationValidationError)
  })
})
