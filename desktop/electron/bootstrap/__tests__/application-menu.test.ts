import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: unknown[]) => ({ template })),
  setApplicationMenu: vi.fn(),
}))

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate,
    setApplicationMenu: mocks.setApplicationMenu,
  },
}))

import { buildApplicationMenuTemplate, installApplicationMenu } from "../application-menu"

type MenuItem = {
  readonly role?: string
  readonly submenu?: readonly MenuItem[]
}

function collectRoles(items: readonly MenuItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(item.submenu ? collectRoles(item.submenu) : []),
  ])
}

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
}

describe("application menu", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  /*
   * This is the whole point of the module: Electron's default menu owns `⌘R` through
   * View → Reload, and a reload drops the renderer's active app back to the default. The terminal
   * claims `⌘R` for rename, which only works while nothing in the menu claims it.
   */
  it.each(["darwin", "win32", "linux"] as const)(
    "never exposes a reload item on %s",
    (platform) => {
      setPlatform(platform)
      const roles = collectRoles(buildApplicationMenuTemplate() as readonly MenuItem[])

      expect(roles).not.toContain("reload")
      expect(roles).not.toContain("forceReload")
    },
  )

  it("keeps the platform's standard menus around the hand-built view menu", () => {
    setPlatform("darwin")
    expect(collectRoles(buildApplicationMenuTemplate() as readonly MenuItem[])).toEqual([
      "appMenu",
      "editMenu",
      "resetZoom",
      "zoomIn",
      "zoomOut",
      "toggleDevTools",
      "togglefullscreen",
      "windowMenu",
    ])

    setPlatform("win32")
    expect(collectRoles(buildApplicationMenuTemplate() as readonly MenuItem[])[0]).toBe("fileMenu")
  })

  it("installs whatever the template builds", () => {
    setPlatform("darwin")
    installApplicationMenu()

    const built = mocks.buildFromTemplate.mock.results[0]?.value
    expect(mocks.setApplicationMenu).toHaveBeenCalledWith(built)
  })
})
