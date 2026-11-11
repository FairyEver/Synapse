import { describe, expect, it } from "vitest"

import {
  DEFAULT_DOCK_APP_IDS,
  SYSTEM_APP_IDS,
  applyCustomAppDockAction,
  customAppCreateInputSchema,
  customAppDockOperationSchema,
  customAppIdSchema,
  customAppSnapshotSchema,
  normalizeCustomAppDockIds,
  parseCustomAppUrl,
} from "./custom-apps.js"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

function customAppDtoFixture() {
  return {
    id: appId,
    kind: "web",
    schemaVersion: 1 as const,
    name: "阅读",
    startUrl: "https://example.com/read",
    iconUrl: null,
    iconSource: "favicon" as const,
    version: 1,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  }
}

describe("custom app contracts", () => {
  it("keeps the canonical system app and default Dock catalogs stable", () => {
    expect(SYSTEM_APP_IDS).toHaveLength(23)
    expect(DEFAULT_DOCK_APP_IDS).toEqual([
      "agent",
      "drive",
      "automation",
      "workflow",
      "terminal",
      "settings",
      "mail-internal",
      "mail",
      "launcher",
    ])
  })

  it("accepts stable custom app ids and rejects foreign ids", () => {
    expect(customAppIdSchema.parse(appId)).toBe(appId)
    expect(customAppIdSchema.safeParse("cwa_one").success).toBe(false)
    expect(customAppIdSchema.safeParse("agent").success).toBe(false)
  })

  it("accepts only absolute HTTP(S) URLs without embedded credentials", () => {
    expect(parseCustomAppUrl("https://example.com/app?a=1")).toBe("https://example.com/app?a=1")
    expect(parseCustomAppUrl("http://localhost:3000/")).toBe("http://localhost:3000/")
    expect(parseCustomAppUrl("javascript:alert(1)")).toBeNull()
    expect(parseCustomAppUrl("file:///tmp/page.html")).toBeNull()
    expect(parseCustomAppUrl("https://user:pass@example.com")).toBeNull()
    expect(parseCustomAppUrl("https://example.com/" + "x".repeat(2100))).toBeNull()
  })

  it("counts the application name by Unicode code point", () => {
    expect(customAppCreateInputSchema.safeParse({
      operationId: "create-1",
      id: appId,
      name: "阅".repeat(64),
      startUrl: "https://example.com/read",
      iconSource: "favicon",
    }).success).toBe(true)
    expect(customAppCreateInputSchema.safeParse({
      operationId: "create-2",
      id: appId,
      name: "阅".repeat(65),
      startUrl: "https://example.com/read",
      iconSource: "favicon",
    }).success).toBe(false)
  })

  it("defaults legacy payloads to window mode and accepts iframe mode", () => {
    expect(customAppCreateInputSchema.parse({
      operationId: "create-legacy",
      id: appId,
      name: "阅读",
      startUrl: "https://example.com/read",
      iconSource: "favicon",
    }).openMode).toBe("window")

    expect(customAppCreateInputSchema.parse({
      operationId: "create-iframe",
      id: appId,
      name: "阅读",
      startUrl: "https://example.com/read",
      iconSource: "favicon",
      openMode: "iframe",
    }).openMode).toBe("iframe")

    const snapshot = customAppSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      initialized: true,
      dockCatalogVersion: 1,
      apps: [customAppDtoFixture()],
      dockAppIds: ["launcher"],
      dockMigrationIds: [],
    })
    expect(snapshot.apps[0]?.openMode).toBe("window")
  })

  it("normalizes custom Dock ids and inserts new pins before launcher", () => {
    expect(normalizeCustomAppDockIds(
      [appId, "ghost", appId, "agent"],
      new Set([appId]),
    )).toEqual([appId, "agent", "launcher"])

    expect(applyCustomAppDockAction(
      ["agent", "launcher"],
      { type: "pin", appId },
      new Set([appId]),
    )).toEqual(["agent", appId, "launcher"])
  })

  it("moves, unpins and restores Dock layouts without removing launcher", () => {
    expect(applyCustomAppDockAction(
      ["agent", appId, "launcher"],
      { type: "move", appId, beforeAppId: "agent" },
      new Set([appId]),
    )).toEqual([appId, "agent", "launcher"])

    expect(applyCustomAppDockAction(
      ["agent", appId, "launcher"],
      { type: "unpin", appId: "launcher" },
      new Set([appId]),
    )).toEqual(["agent", appId, "launcher"])

    expect(applyCustomAppDockAction(
      ["agent", appId, "launcher"],
      { type: "restore-default" },
      new Set([appId]),
    )).toEqual([...DEFAULT_DOCK_APP_IDS])
  })

  it("applies migrations once and preserves their completed ids", () => {
    const action = {
      type: "apply-migrations" as const,
      migrations: [{
        id: "dock.test.v1",
        operations: [{ kind: "insert-before" as const, appId: "drive", targetAppId: "launcher" }],
      }],
    }
    const result = applyCustomAppDockAction(
      ["agent", "launcher"],
      action,
      new Set([appId]),
      [],
    )

    expect(result).toEqual({
      appIds: ["agent", "drive", "launcher"],
      migrationIds: ["dock.test.v1"],
    })
    expect(applyCustomAppDockAction(
      result.appIds,
      action,
      new Set([appId]),
      result.migrationIds,
    )).toEqual(result)
  })

  it("accepts a no-op migration that only records its catalog id", () => {
    expect(customAppDockOperationSchema.safeParse({
      operationId: "dock.noop",
      type: "apply-migrations",
      migrations: [{ id: "dock.noop.v1", operations: [] }],
    }).success).toBe(true)
  })

  it("accepts unknown future app kinds without losing the snapshot", () => {
    const result = customAppSnapshotSchema.safeParse({
      schemaVersion: 1,
      revision: 1,
      initialized: true,
      dockCatalogVersion: 1,
      apps: [{ ...customAppDtoFixture(), kind: "future-kind" }],
      dockAppIds: ["launcher"],
      dockMigrationIds: [],
    })

    expect(result.success).toBe(true)
  })

  it("accepts additive schema-1 fields without discarding the snapshot", () => {
    const result = customAppSnapshotSchema.safeParse({
      schemaVersion: 1,
      revision: 2,
      initialized: true,
      dockCatalogVersion: 1,
      futureSnapshotField: true,
      apps: [{ ...customAppDtoFixture(), futureAppField: "ignored" }],
      dockAppIds: ["launcher"],
      dockMigrationIds: [],
    })

    expect(result.success).toBe(true)
  })
})
