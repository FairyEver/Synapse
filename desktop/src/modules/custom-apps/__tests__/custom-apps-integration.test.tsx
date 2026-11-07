/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

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
    apps: [],
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
})
