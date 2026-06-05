import { describe, expect, it } from "vitest"
import { migration, runMigrations } from "../migrations"
import { MigrationDowngradeError, MigrationFailedError, MissingMigrationError } from "../errors"

describe("runMigrations (T2.6)", () => {
  it("returns data unchanged when current === target", async () => {
    const result = await runMigrations<{ x: number }, { x: number }>({
      currentVersion: 1,
      targetVersion: 1,
      migrations: [],
      namespace: "test",
      data: { x: 1 },
    })
    expect(result).toEqual({ x: 1 })
  })

  it("applies a single migration step", async () => {
    const result = await runMigrations<{ x: number }, { x: number; y: string }>({
      currentVersion: 0,
      targetVersion: 1,
      migrations: [
        migration<{ x: number }, { x: number; y: string }>(0, 1, (d) => ({ ...d, y: "ok" })),
      ],
      namespace: "test",
      data: { x: 1 },
    })
    expect(result).toEqual({ x: 1, y: "ok" })
  })

  it("applies a chain of migrations in order", async () => {
    const result = await runMigrations({
      currentVersion: 0,
      targetVersion: 3,
      migrations: [
        migration<{ s: string }, { s: string }>(0, 1, (d) => ({ s: d.s + "+a" })),
        migration<{ s: string }, { s: string }>(1, 2, (d) => ({ s: d.s + "+b" })),
        migration<{ s: string }, { s: string }>(2, 3, (d) => ({ s: d.s + "+c" })),
      ],
      namespace: "test",
      data: { s: "" },
    })
    expect((result as { s: string }).s).toBe("+a+b+c")
  })

  it("supports async migrations", async () => {
    const result = await runMigrations({
      currentVersion: 0,
      targetVersion: 1,
      migrations: [
        {
          from: 0,
          to: 1,
          async migrate(data) {
            await new Promise((r) => setTimeout(r, 1))
            return { ...(data as object), async: true }
          },
        },
      ],
      namespace: "test",
      data: { x: 1 },
    })
    expect(result).toEqual({ x: 1, async: true })
  })

  it("throws MissingMigrationError when target is forward but no path", async () => {
    await expect(
      runMigrations({
        currentVersion: 0,
        targetVersion: 2,
        migrations: [migration<unknown, unknown>(0, 1, (d) => d)],
        namespace: "test",
        data: {},
      }),
    ).rejects.toBeInstanceOf(MissingMigrationError)
  })

  it("throws MigrationDowngradeError on attempted down-migration", async () => {
    await expect(
      runMigrations({
        currentVersion: 2,
        targetVersion: 1,
        migrations: [],
        namespace: "test",
        data: {},
      }),
    ).rejects.toBeInstanceOf(MigrationDowngradeError)
  })

  it("wraps step errors as MigrationFailedError with from/to", async () => {
    let captured: MigrationFailedError | null = null
    try {
      await runMigrations({
        currentVersion: 0,
        targetVersion: 2,
        migrations: [
          migration<unknown, unknown>(0, 1, (d) => d),
          {
            from: 1,
            to: 2,
            migrate() {
              throw new Error("boom")
            },
          },
        ],
        namespace: "users",
        data: {},
      })
    } catch (err) {
      captured = err as MigrationFailedError
    }
    expect(captured).not.toBeNull()
    expect(captured).toBeInstanceOf(MigrationFailedError)
    expect(captured!.fromVersion).toBe(1)
    expect(captured!.toVersion).toBe(2)
    expect(captured!.namespace).toBe("users")
  })

  it("rejects duplicate migrations with the same `from`", async () => {
    await expect(
      runMigrations({
        currentVersion: 0,
        targetVersion: 1,
        migrations: [
          migration<unknown, unknown>(0, 1, (d) => d),
          migration<unknown, unknown>(0, 2, (d) => d),
        ],
        namespace: "test",
        data: {},
      }),
    ).rejects.toThrow(/Duplicate migration/)
  })

  it("rejects a non-advancing migration (to <= from)", async () => {
    await expect(
      runMigrations({
        currentVersion: 0,
        targetVersion: 1,
        migrations: [
          // to === from is illegal
          { from: 0, to: 0, migrate: (d: unknown) => d },
        ],
        namespace: "test",
        data: {},
      }),
    ).rejects.toThrow(/did not advance/)
  })

  it("idempotency — running the same chain twice yields the same result", async () => {
    const data = { v: 0 }
    const migrations = [
      migration<{ v: number }, { v: number }>(0, 1, (d) => ({ v: d.v + 1 })),
    ]
    const a = await runMigrations({
      currentVersion: 0,
      targetVersion: 1,
      migrations,
      namespace: "test",
      data,
    })
    const b = await runMigrations({
      currentVersion: 0,
      targetVersion: 1,
      migrations,
      namespace: "test",
      data,
    })
    expect(a).toEqual(b)
  })
})
