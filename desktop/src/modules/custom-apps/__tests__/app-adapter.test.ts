import { describe, expect, it } from "vitest"
import type { CustomAppSnapshotDto, CustomAppsClientState } from "@synapse/shared"

import { listSystemApps } from "@/modules/apps/registry"
import { buildAppCatalog } from "../app-adapter"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

describe("custom app catalog adapter", () => {
  it("merges built-in and custom apps without changing built-in categories", () => {
    const catalog = buildAppCatalog(listSystemApps(), stateWithApps(app("阅读")))

    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "agent", kind: "system", category: "collaboration" }),
      expect.objectContaining({ id: appId, kind: "custom-web", category: "custom" }),
    ]))
  })

  it("uses a cloud icon URL when present and a globe fallback otherwise", () => {
    const withIcon = buildAppCatalog(listSystemApps(), stateWithApps(app("图标", "https://cdn.example/icon.png")))
    const withoutIcon = buildAppCatalog(listSystemApps(), stateWithApps(app("无图标")))

    expect(withIcon.find((entry) => entry.id === appId)?.icon).toEqual({
      kind: "image",
      src: "https://cdn.example/icon.png",
    })
    expect(withoutIcon.find((entry) => entry.id === appId)?.icon).toEqual({ kind: "lucide", icon: expect.any(Object) })
  })

  it("ignores unknown future app kinds", () => {
    const catalog = buildAppCatalog(listSystemApps(), stateWithApps({
      ...app("未来"),
      kind: "future-kind",
    }))
    expect(catalog.some((entry) => entry.id === appId)).toBe(false)
  })
})

function stateWithApps(item: CustomAppSnapshotDto["apps"][number]): CustomAppsClientState {
  return {
    accountId: "user-1",
    syncState: "ready",
    errorCode: null,
    snapshot: {
      schemaVersion: 1,
      revision: 1,
      initialized: true,
      dockCatalogVersion: 1,
      apps: [item],
      dockAppIds: ["agent", appId, "launcher"],
      dockMigrationIds: [],
    },
  }
}

function app(name: string, iconUrl: string | null = null): CustomAppSnapshotDto["apps"][number] {
  return {
    id: appId,
    kind: "web",
    schemaVersion: 1,
    name,
    startUrl: "https://example.com/read",
    openMode: "window",
    iconUrl,
    iconSource: iconUrl ? "custom" : "favicon",
    version: 1,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  }
}
