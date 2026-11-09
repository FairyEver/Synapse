/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CustomAppSnapshotDto, CustomAppsClientState } from "@synapse/shared"

const mocks = vi.hoisted(() => ({
  customState: null as CustomAppsClientState | null,
  applyDockOperation: vi.fn(),
  bootstrapDock: vi.fn(),
  notifyError: vi.fn(),
}))

vi.mock("../context", () => ({
  useCustomApps: () => ({
    state: mocks.customState,
    applyDockOperation: mocks.applyDockOperation,
    bootstrapDock: mocks.bootstrapDock,
  }),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: { global: { dockAppIds: ["agent", "launcher"], dockMigrationIds: [] } },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({ error: mocks.notifyError }),
}))

import { useCloudDock } from "../use-cloud-dock"
import { DEFAULT_DOCK_MIGRATION_IDS } from "@/modules/apps/dock"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
let latest: ReturnType<typeof useCloudDock> | null = null

describe("useCloudDock", () => {
  beforeEach(() => {
    mocks.applyDockOperation.mockResolvedValue(snapshot())
    mocks.bootstrapDock.mockResolvedValue(snapshot())
    mocks.customState = state("ready", snapshot())
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ""
    vi.clearAllMocks()
  })

  it("uses the cloud order and exposes custom apps as pinned", async () => {
    await renderHook()

    expect(latest?.canEdit).toBe(true)
    expect(latest?.pinnedApps.map((app) => app.id)).toEqual(["agent", appId, "launcher"])
  })

  it("disables edits while offline but keeps the cached Dock", async () => {
    mocks.customState = state("offline", snapshot())
    await renderHook()

    expect(latest?.canEdit).toBe(false)
    expect(latest?.pinnedApps.map((app) => app.id)).toEqual(["agent", appId, "launcher"])
  })

  it("sends pin and unpin intents to the cloud catalog", async () => {
    mocks.applyDockOperation.mockResolvedValueOnce({
      ...snapshot(),
      dockAppIds: ["agent", appId, "drive", "launcher"],
    })
    await renderHook()
    await act(async () => expect(await latest?.addDockApp("drive")).toBe(true))
    expect(mocks.applyDockOperation).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "pin",
      appId: "drive",
      operationId: expect.any(String),
    }))
    await act(async () => latest?.removeDockApp(appId))
    expect(mocks.applyDockOperation).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "unpin",
      appId,
    }))
  })

  it("reports a failed pin when the cloud returns a layout without SkillHub", async () => {
    mocks.applyDockOperation.mockResolvedValueOnce({ ...snapshot(), revision: 2 })
    await renderHook()

    await act(async () => expect(await latest?.addDockApp("skill-hub")).toBe(false))

    expect(mocks.notifyError).toHaveBeenCalledWith(expect.stringContaining("固定"))
    expect(latest?.pinnedApps.map((app) => app.id)).toEqual(["agent", appId, "launcher"])
  })

  it("bootstraps the legacy Dock only once when the cloud snapshot is uninitialized", async () => {
    mocks.customState = state("ready", snapshot(false))
    await renderHook()
    await act(async () => Promise.resolve())
    expect(mocks.bootstrapDock).toHaveBeenCalledTimes(1)
    expect(mocks.bootstrapDock).toHaveBeenCalledWith(expect.objectContaining({
      dockAppIds: ["agent", "launcher"],
    }))
  })

  it("applies catalog migrations missing from an initialized cloud Dock", async () => {
    mocks.customState = state("ready", snapshot(true, []))

    await renderHook()
    await act(async () => Promise.resolve())

    expect(mocks.applyDockOperation).toHaveBeenCalledWith(expect.objectContaining({
      type: "apply-migrations",
      operationId: expect.any(String),
      migrations: expect.arrayContaining(
        DEFAULT_DOCK_MIGRATION_IDS.map((id) => expect.objectContaining({ id })),
      ),
    }))
  })
})

async function renderHook() {
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  function Harness() {
    latest = useCloudDock({ workflowEntryVisible: false })
    return null
  }
  await act(async () => root!.render(<Harness />))
}

function state(syncState: CustomAppsClientState["syncState"], snapshotValue: CustomAppSnapshotDto): CustomAppsClientState {
  return {
    accountId: "user-1",
    snapshot: snapshotValue,
    syncState,
    errorCode: null,
  }
}

function snapshot(
  initialized = true,
  dockMigrationIds = [...DEFAULT_DOCK_MIGRATION_IDS],
): CustomAppSnapshotDto {
  return {
    schemaVersion: 1,
    revision: 1,
    initialized,
    dockCatalogVersion: 1,
    apps: [{
      id: appId,
      kind: "web",
      schemaVersion: 1,
      name: "阅读",
      startUrl: "https://example.com/read",
      openMode: "window",
      iconUrl: null,
      iconSource: "favicon",
      version: 1,
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    }],
    dockAppIds: ["agent", appId, "launcher"],
    dockMigrationIds,
  }
}
