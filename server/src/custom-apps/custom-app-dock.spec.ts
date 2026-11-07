import { describe, expect, it } from "vitest"

import {
  applyServerDockAction,
  normalizeServerDockLayout,
} from "./custom-app-dock"

describe("custom app Dock reducer", () => {
  it("removes deleted custom apps and orphans without dropping known hidden system apps", () => {
    expect(normalizeServerDockLayout(
      ["agent", "cwa_deleted", "workflow", "ghost", "agent"],
      { knownCustomAppIds: new Set() },
    )).toEqual(["agent", "workflow", "launcher"])
  })

  it("keeps custom apps and launcher exactly once", () => {
    const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
    expect(normalizeServerDockLayout(
      [appId, appId, "agent"],
      { knownCustomAppIds: new Set([appId]) },
    )).toEqual([appId, "agent", "launcher"])
  })

  it("pins a custom app before launcher and ignores an unknown pin", () => {
    const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
    expect(applyServerDockAction(
      ["agent", "launcher"],
      { type: "pin", appId },
      { knownCustomAppIds: new Set([appId]), appliedMigrationIds: [] },
    )).toEqual({
      dockAppIds: ["agent", appId, "launcher"],
      dockMigrationIds: [],
    })

    expect(applyServerDockAction(
      ["agent", "launcher"],
      { type: "pin", appId: "cwa_missing" },
      { knownCustomAppIds: new Set([appId]), appliedMigrationIds: [] },
    )).toEqual({
      dockAppIds: ["agent", "launcher"],
      dockMigrationIds: [],
    })
  })

  it("moves and unpins while preserving launcher", () => {
    const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
    const knownCustomAppIds = new Set([appId])

    expect(applyServerDockAction(
      ["agent", appId, "launcher"],
      { type: "move", appId, beforeAppId: "agent" },
      { knownCustomAppIds, appliedMigrationIds: [] },
    ).dockAppIds).toEqual([appId, "agent", "launcher"])

    expect(applyServerDockAction(
      ["agent", appId, "launcher"],
      { type: "unpin", appId: "launcher" },
      { knownCustomAppIds, appliedMigrationIds: [] },
    ).dockAppIds).toEqual(["agent", appId, "launcher"])
  })

  it("applies a migration once on the latest layout", () => {
    const action = {
      type: "apply-migrations" as const,
      migrations: [{
        id: "dock.test.v1",
        operations: [
          { kind: "move-to-end" as const, appId: "launcher" },
          { kind: "insert-before" as const, appId: "drive", targetAppId: "launcher" },
        ],
      }],
    }
    const once = applyServerDockAction(
      ["agent", "launcher"],
      action,
      { knownCustomAppIds: new Set(), appliedMigrationIds: [] },
    )

    expect(once).toEqual({
      dockAppIds: ["agent", "drive", "launcher"],
      dockMigrationIds: ["dock.test.v1"],
    })
    expect(applyServerDockAction(once.dockAppIds, action, {
      knownCustomAppIds: new Set(),
      appliedMigrationIds: once.dockMigrationIds,
    })).toEqual(once)
  })

  it("restores the shared default Dock", () => {
    expect(applyServerDockAction(
      ["database", "launcher"],
      { type: "restore-default" },
      { knownCustomAppIds: new Set(), appliedMigrationIds: [] },
    ).dockAppIds).toEqual([
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
})
