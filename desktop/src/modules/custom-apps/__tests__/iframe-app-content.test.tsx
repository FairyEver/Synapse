/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CustomAppDto } from "@synapse/shared"

const shell = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({ shell }),
}))

import { IframeCustomAppContent } from "../iframe-app-content"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const app: CustomAppDto = {
  id: "cwa_123e4567-e89b-42d3-a456-426614174000",
  kind: "web",
  schemaVersion: 1,
  name: "验收页面",
  startUrl: "https://example.com/read",
  openMode: "iframe",
  iconUrl: null,
  iconSource: "favicon",
  version: 1,
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
}

let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null

describe("IframeCustomAppContent", () => {
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.clearAllMocks()
  })

  it("loads the app with the cross-origin compatibility sandbox", async () => {
    render()

    const iframe = document.querySelector<HTMLIFrameElement>("iframe")
    expect(iframe?.getAttribute("src")).toBe(app.startUrl)
    expect(iframe?.getAttribute("sandbox")).toContain("allow-same-origin")
    expect(iframe?.getAttribute("sandbox")).toContain("allow-forms")
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts")
    expect(iframe?.getAttribute("sandbox")).toContain("allow-modals")
    expect(iframe?.getAttribute("allow")).toContain("camera 'none'")
    expect(iframe?.getAttribute("allow")).toContain("clipboard-read 'none'")
    expect(iframe?.getAttribute("allow")).toContain("autoplay *")
    expect(iframe?.getAttribute("allow")).toContain("fullscreen *")
    expect(iframe?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin")
    expect(iframe?.getAttribute("loading")).toBe("eager")
    expect(iframe?.getAttribute("name")).toBe("synapse-custom-app")
    expect(iframe?.allowFullscreen).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="后退"]')?.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="前进"]')?.disabled).toBe(true)
  })

  it("opens the configured URL through the guarded shell bridge", async () => {
    render()

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="在浏览器打开"]')?.click()
    })

    expect(shell.openExternal).toHaveBeenCalledWith(app.startUrl)
  })

  it("recreates the iframe when refreshing", async () => {
    render()
    const before = document.querySelector("iframe")

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="刷新"]')?.click()
    })

    expect(document.querySelector("iframe")).not.toBe(before)
  })

  it("keeps the mounted page on its original URL when app config changes", async () => {
    render()

    await act(async () => root!.render(
      <IframeCustomAppContent app={{ ...app, startUrl: "https://example.com/next" }} />,
    ))

    expect(document.querySelector<HTMLIFrameElement>("iframe")?.getAttribute("src"))
      .toBe(app.startUrl)
  })
})

function render() {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<IframeCustomAppContent app={app} />))
}
