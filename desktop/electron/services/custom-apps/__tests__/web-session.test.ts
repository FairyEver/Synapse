import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMocks = vi.hoisted(() => {
  const fakeSession: Record<string, unknown> = {
    partition: "persist:synapse-custom-web",
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  return {
    fakeSession,
    fromPartition: vi.fn(() => fakeSession),
    showSaveDialog: vi.fn(),
  }
})

vi.mock("electron", () => ({
  session: { fromPartition: electronMocks.fromPartition },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
}))

import {
  CUSTOM_WEB_PARTITION,
  configureCustomWebSession,
  getCustomWebSession,
  isAllowedCustomWebUrl,
} from "../web-session"

describe("custom web session", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses one persistent partition for all custom apps", () => {
    expect(CUSTOM_WEB_PARTITION).toBe("persist:synapse-custom-web")
    expect(getCustomWebSession()).toBe(electronMocks.fakeSession)
    expect(electronMocks.fromPartition).toHaveBeenCalledWith(CUSTOM_WEB_PARTITION)
  })

  it.each([
    "file:///tmp/secret",
    "data:text/html,hello",
    "javascript:alert(1)",
    "synapse://app/agent",
  ])("blocks non-web navigation %s", (url) => {
    expect(isAllowedCustomWebUrl(url)).toBe(false)
  })

  it("allows only HTTP(S) navigation", () => {
    expect(isAllowedCustomWebUrl("https://example.com/read")).toBe(true)
    expect(isAllowedCustomWebUrl("http://localhost:3000/")).toBe(true)
  })

  it("allows only mediaKeySystem permission", async () => {
    const cleanup = configureCustomWebSession(electronMocks.fakeSession as never)

    const requestHandler = (electronMocks.fakeSession.setPermissionRequestHandler as unknown as {
      readonly mock: { readonly calls: Array<[unknown, unknown, (allowed: boolean) => void]> }
    }).mock.calls[0][0] as (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void
    const requestCallback = vi.fn()
    requestHandler({}, "mediaKeySystem", requestCallback)
    expect(requestCallback).toHaveBeenLastCalledWith(true)
    requestHandler({}, "media", requestCallback)
    expect(requestCallback).toHaveBeenLastCalledWith(false)

    const checkHandler = (electronMocks.fakeSession.setPermissionCheckHandler as unknown as {
      readonly mock: { readonly calls: Array<[unknown, unknown, unknown, unknown]> }
    }).mock.calls[0][0] as (
      webContents: unknown,
      permission: string,
      requestingOrigin: unknown,
      details: unknown,
    ) => boolean
    expect(checkHandler({}, "clipboard-read", {}, "")).toBe(false)
    expect(checkHandler({}, "mediaKeySystem", {}, "")).toBe(true)

    const deviceHandler = (electronMocks.fakeSession.setDevicePermissionHandler as unknown as {
      readonly mock: { readonly calls: Array<[unknown]> }
    }).mock.calls[0][0] as (details: unknown) => boolean
    expect(deviceHandler({} as never)).toBe(false)
    cleanup()
  })
})
