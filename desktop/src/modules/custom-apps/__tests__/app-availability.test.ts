import { describe, expect, it } from "vitest"
import type { CustomAppId, CustomAppSnapshotDto } from "@synapse/shared"

import { shouldReturnToLauncher } from "../app-availability"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000" as const

describe("custom app availability", () => {
  it("returns a removed or signed-out custom app to the launcher", () => {
    expect(shouldReturnToLauncher(appId, null)).toBe(true)
    expect(shouldReturnToLauncher(appId, snapshot([]))).toBe(true)
  })

  it("keeps iframe apps in the main shell and returns window-only apps to the launcher", () => {
    expect(shouldReturnToLauncher(appId, snapshot([appId], "iframe"))).toBe(false)
    expect(shouldReturnToLauncher(appId, snapshot([appId], "window"))).toBe(true)
  })

  it("keeps every system app active", () => {
    expect(shouldReturnToLauncher("agent", null)).toBe(false)
  })
})

function snapshot(
  appIds: readonly CustomAppId[],
  openMode: "iframe" | "window" = "iframe",
): CustomAppSnapshotDto {
  return {
    schemaVersion: 1 as const,
    revision: 1,
    initialized: true,
    dockCatalogVersion: 1,
    apps: appIds.map((id) => ({
      id,
      kind: "web",
      schemaVersion: 1 as const,
      name: "阅读",
      startUrl: "https://example.com/read",
      openMode,
      iconUrl: null,
      iconSource: "favicon" as const,
      version: 1,
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    })),
    dockAppIds: ["launcher"],
    dockMigrationIds: [],
  }
}
