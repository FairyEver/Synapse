/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CustomAppDto } from "@synapse/shared"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"
const state = vi.hoisted(() => ({
  accountId: "user-1",
  syncState: "ready" as const,
  errorCode: null,
  snapshot: {
    schemaVersion: 1 as const,
    revision: 2,
    initialized: true,
    dockCatalogVersion: 1,
    apps: [] as CustomAppDto[],
    dockAppIds: ["launcher"],
    dockMigrationIds: [],
  },
}))

vi.mock("../context", () => ({
  useCustomApps: () => ({ state }),
}))

import { CustomAppWindowApp } from "../custom-app-window-app"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null

describe("custom app deletion integration", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    state.snapshot.apps = []
    vi.restoreAllMocks()
  })

  it("closes a detached window when the app is deleted remotely", async () => {
    window.history.replaceState({}, "", `/?window=custom-app&appId=${appId}`)
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(<CustomAppWindowApp />))

    expect(close).toHaveBeenCalled()
  })

  it("closes a detached window when the app switches to iframe mode", async () => {
    window.history.replaceState({}, "", `/?window=custom-app&appId=${appId}`)
    state.snapshot.apps = [{
      id: appId,
      kind: "web",
      schemaVersion: 1,
      name: "阅读",
      startUrl: "https://example.com/read",
      openMode: "iframe",
      iconUrl: null,
      iconSource: "favicon",
      version: 2,
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    }]
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => root!.render(<CustomAppWindowApp />))

    expect(close).toHaveBeenCalled()
  })
})
