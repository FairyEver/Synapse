import { describe, expect, it } from "vitest"

import { allSchemas } from "../schemas"
import {
  customAppsSnapshotSchema,
  type CustomAppsSnapshotEntryV1,
} from "../schemas/custom-apps"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

describe("custom app DataRepository schema", () => {
  it("accepts one validated snapshot per account", () => {
    const entry: CustomAppsSnapshotEntryV1 = {
      id: "user-1",
      schemaVersion: 1,
      accountId: "user-1",
      cachedAt: "2026-11-07T00:00:00.000Z",
      snapshot: {
        schemaVersion: 1,
        revision: 3,
        initialized: true,
        dockCatalogVersion: 1,
        apps: [{
          id: appId,
          kind: "web",
          schemaVersion: 1,
          name: "阅读",
          startUrl: "https://example.com/read",
          iconUrl: null,
          iconSource: "favicon",
          version: 1,
          createdAt: "2026-11-07T00:00:00.000Z",
          updatedAt: "2026-11-07T00:00:00.000Z",
        }],
        dockAppIds: ["agent", appId, "launcher"],
        dockMigrationIds: [],
      },
    }

    expect(customAppsSnapshotSchema.validate(entry)).toBe(true)
  })

  it("rejects a record whose key and account do not match or whose snapshot is invalid", () => {
    expect(customAppsSnapshotSchema.validate({
      id: "user-1",
      schemaVersion: 1,
      accountId: "user-2",
      cachedAt: "2026-11-07T00:00:00.000Z",
      snapshot: {},
    })).toBe(false)
    expect(customAppsSnapshotSchema.validate({
      id: "user-1",
      schemaVersion: 1,
      accountId: "user-1",
      cachedAt: "not-a-date",
      snapshot: {},
    })).toBe(false)
  })

  it("registers the namespace as local-only", () => {
    const schema = allSchemas.find((item) => item.name === "app.custom-apps.snapshots")
    expect(schema).toMatchObject({
      backend: "json",
      currentVersion: 1,
      transferPolicy: "local-only",
    })
  })
})
