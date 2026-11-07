import { describe, expect, it } from "vitest"
import { customAppIpcModule } from "../ipc"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

describe("customAppIpcModule", () => {
  it("declares the custom app bridge operations", () => {
    expect(customAppIpcModule.id).toBe("customApps")
    expect(customAppIpcModule.methods.getSnapshot.operationId).toBe("app.custom_apps.operation.get_state")
    expect(customAppIpcModule.methods.retry.operationId).toBe("app.custom_apps.sync.retry")
    expect(customAppIpcModule.methods.create.operationId).toBe("app.custom_apps.app.create")
    expect(customAppIpcModule.methods.update.operationId).toBe("app.custom_apps.app.update")
    expect(customAppIpcModule.methods.delete.operationId).toBe("app.custom_apps.app.delete")
    expect(customAppIpcModule.methods.bootstrapDock.operationId).toBe("app.custom_apps.dock.bootstrap")
    expect(customAppIpcModule.methods.applyDockOperation.operationId).toBe("app.custom_apps.dock.apply")
    expect(customAppIpcModule.methods.fetchFavicon.operationId).toBe("app.custom_apps.icon.fetch_favicon")
    expect(customAppIpcModule.methods.chooseIcon.operationId).toBe("app.custom_apps.icon.choose")
    expect(customAppIpcModule.events.changed.operationId).toBe("app.custom_apps.operation.changed")
  })

  it("validates create, update and Dock requests", () => {
    expect(customAppIpcModule.methods.create.request.safeParse({
      operationId: "create-1",
      id: appId,
      name: "阅读",
      startUrl: "https://example.com/read",
      iconSource: "favicon",
    }).success).toBe(true)

    expect(customAppIpcModule.methods.update.request.safeParse({
      id: appId,
      input: { operationId: "update-1", name: "稍后阅读" },
    }).success).toBe(true)

    expect(customAppIpcModule.methods.applyDockOperation.request.safeParse({
      operationId: "pin-1",
      type: "pin",
      appId,
    }).success).toBe(true)
  })

  it("validates changed-state events", () => {
    expect(customAppIpcModule.events.changed.payload.safeParse({
      accountId: "user-1",
      syncState: "ready",
      errorCode: null,
      snapshot: {
        schemaVersion: 1,
        revision: 1,
        initialized: true,
        dockCatalogVersion: 1,
        apps: [],
        dockAppIds: ["launcher"],
        dockMigrationIds: [],
      },
    }).success).toBe(true)
  })
})
