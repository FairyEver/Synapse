import { describe, expect, it, vi } from "vitest"
import type { CustomAppDto } from "@synapse/shared"
import type { BrowserWindow, WebContentsView } from "electron"

import { CustomWebAppRuntimeService } from "../runtime-service"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

describe("CustomWebAppRuntimeService", () => {
  it("retains history when an app is detached and reattached", async () => {
    const { host, createdViews, runtime } = createHarness()

    await runtime.attach(host, appId)
    runtime.detach(host)
    await runtime.attach(host, appId)

    expect(createdViews[0].webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(createdViews[0].webContents.loadURL).toHaveBeenCalledWith("https://example.com/read")
    expect(host.contentView.addChildView).toHaveBeenLastCalledWith(createdViews[0])
  })

  it("rejects iframe apps from the native web view runtime", async () => {
    const { host, createdViews, runtime } = createHarness({ openMode: "iframe" })

    await expect(runtime.attach(host, appId)).rejects.toThrow("does not use a native web view")
    expect(createdViews).toHaveLength(0)
  })

  it("clamps a viewport below the app header and inside the window", async () => {
    const { host, createdViews, runtime } = createHarness()
    await runtime.attach(host, appId)
    runtime.setBounds(host, { x: -10, y: 48, width: 1200, height: 900 })

    expect(createdViews[0].setBounds).toHaveBeenCalledWith({
      x: 0,
      y: 48,
      width: 1200,
      height: 652,
    })
  })

  it("converts renderer CSS bounds to window DIP when the host is zoomed", async () => {
    const { host, createdViews, runtime } = createHarness({ zoomFactor: 1.1 })
    await runtime.attach(host, appId)
    runtime.setBounds(host, { x: 54, y: 0, width: 1000, height: 600 })

    expect(createdViews[0].setBounds).toHaveBeenLastCalledWith({
      x: 59,
      y: 0,
      width: 1100,
      height: 660,
    })
  })

  it("hides without recreating and restores the active view", async () => {
    const { host, createdViews, runtime } = createHarness()
    await runtime.attach(host, appId)

    runtime.setOccluded(host, true)
    expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(false)
    runtime.setOccluded(host, false)
    expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(true)
    expect(createdViews).toHaveLength(1)
  })

  it("destroys the view when the app is deleted remotely", async () => {
    const { host, createdViews, runtime } = createHarness()
    await runtime.attach(host, appId)

    runtime.destroyApp(appId)

    expect(createdViews[0].webContents.close).toHaveBeenCalled()
    expect(host.contentView.removeChildView).toHaveBeenCalledWith(createdViews[0])
  })

  it("cleans up a host that Electron has already destroyed", async () => {
    const { host, createdViews, runtime } = createHarness()
    await runtime.attach(host, appId)
    vi.mocked(host.isDestroyed).mockReturnValue(true)
    vi.mocked(createdViews[0].webContents.isDestroyed).mockReturnValue(true)
    vi.mocked(host.contentView.removeChildView).mockImplementation(() => {
      throw new TypeError("Object has been destroyed")
    })

    expect(() => runtime.destroyHost(host)).not.toThrow()
    expect(host.contentView.removeChildView).not.toHaveBeenCalled()
    expect(createdViews[0].webContents.close).not.toHaveBeenCalled()
    expect(runtime.appIdForHost(host)).toBeNull()
  })

  it("updates navigation state from WebContents events", async () => {
    const { host, createdViews, runtime } = createHarness()
    await runtime.attach(host, appId)
    createdViews[0].webContents.trigger("did-start-loading")
    expect(runtime.state(host).isLoading).toBe(true)
    createdViews[0].webContents.trigger("did-navigate", {}, "https://example.com/next")
    createdViews[0].webContents.trigger("did-stop-loading")
    expect(runtime.state(host)).toMatchObject({
      isLoading: false,
      currentUrl: "https://example.com/next",
      canGoBack: true,
      canGoForward: false,
    })
  })

  it("applies navigation and popup limits recursively to child windows", async () => {
    const { host, createdViews, runtime } = createHarness()
    await runtime.attach(host, appId)
    const parentContents = createdViews[0].webContents
    const openHandler = parentContents.setWindowOpenHandler.mock.calls[0][0] as (
      details: { readonly url: string }
    ) => { readonly action: "allow" | "deny" }

    expect(openHandler({ url: "javascript:alert(1)" }).action).toBe("deny")
    expect(openHandler({ url: "https://example.com/popup" }).action).toBe("allow")

    const redirectEvent = { preventDefault: vi.fn() }
    parentContents.trigger("will-redirect", redirectEvent, "file:///tmp/secret")
    expect(redirectEvent.preventDefault).toHaveBeenCalled()

    const child = createFakeWindow()
    parentContents.trigger("did-create-window", child)
    expect(child.webContents.setWindowOpenHandler).toHaveBeenCalled()
    const childOpenHandler = child.webContents.setWindowOpenHandler.mock.calls[0][0] as (
      details: { readonly url: string }
    ) => { readonly action: "allow" | "deny" }
    childOpenHandler({ url: "https://example.com/child-1" })
    childOpenHandler({ url: "https://example.com/child-2" })
    childOpenHandler({ url: "https://example.com/child-3" })
    childOpenHandler({ url: "https://example.com/child-4" })
    expect(childOpenHandler({ url: "https://example.com/child-5" }).action).toBe("deny")
  })
})

function createHarness({
  openMode = "window",
  zoomFactor = 1,
}: {
  readonly openMode?: "iframe" | "window"
  readonly zoomFactor?: number
} = {}) {
  const app: CustomAppDto = {
    id: appId,
    kind: "web",
    schemaVersion: 1,
    name: "阅读",
    startUrl: "https://example.com/read",
    openMode,
    iconUrl: null,
    iconSource: "favicon",
    version: 1,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  }
  const createdViews: FakeView[] = []
  const runtime = new CustomWebAppRuntimeService({
    getApp: (id) => id === appId ? app : null,
    createView: () => {
      const view = createFakeView()
      createdViews.push(view)
      return view as unknown as WebContentsView
    },
    getSession: () => ({}) as never,
    openExternal: vi.fn(),
    getAllWindows: () => [host],
  })
  const host = {
    id: 1,
    isDestroyed: vi.fn(() => false),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1200, height: 700 })),
    webContents: {
      getZoomFactor: vi.fn(() => zoomFactor),
    },
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  } as unknown as BrowserWindow
  return { host, createdViews, runtime }
}

function createFakeView() {
  const listeners = new Map<string, (...args: never[]) => void>()
  const webContents = {
    id: 2,
    loadURL: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, listener)
    }),
    navigationHistory: {
      canGoBack: vi.fn(() => true),
      canGoForward: vi.fn(() => false),
      getActiveIndex: vi.fn(() => 1),
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    setWindowOpenHandler: vi.fn(),
    getURL: vi.fn(() => "https://example.com/read"),
    trigger(event: string, ...args: unknown[]) {
      listeners.get(event)?.(...(args as never[]))
    },
  }
  return {
    webContents,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  }
}

function createFakeWindow() {
  const view = createFakeView()
  return {
    webContents: view.webContents,
    once: vi.fn(),
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
  }
}

type FakeView = ReturnType<typeof createFakeView>
