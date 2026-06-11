import { describe, expect, it } from "vitest"
import config, { isDriveBrowserSpaPath } from "./vite.config"

describe("dashboard Vite dev proxy", () => {
  it("fails instead of opening another port when the dashboard port is occupied", () => {
    expect(config.server?.strictPort).toBe(true)
  })

  it("proxies desktop live websocket upgrades through /api", () => {
    const proxy = config.server?.proxy
    const apiProxy = proxy && !Array.isArray(proxy) ? proxy["/api"] : undefined

    expect(apiProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      ws: true,
    }))
  })

  it("proxies public webhook endpoints through /webhooks", () => {
    const proxy = config.server?.proxy
    const webhooksProxy = proxy && !Array.isArray(proxy) ? proxy["/webhooks"] : undefined

    expect(webhooksProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
  })

  it("keeps direct drive responses behind focused proxy rules", () => {
    const proxy = config.server?.proxy
    const ownerDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy["^/drive/items/[^/]+/(download|zip|render)$"]
      : undefined
    const shareDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy["^/files/[^/]+/items/[^/]+/(download|zip)$"]
      : undefined

    expect(ownerDownloadProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
    expect(shareDownloadProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
    expect(proxy && !Array.isArray(proxy) ? proxy["/files"] : undefined).toBeUndefined()
  })

  it("serves drive browser page routes through the dashboard app in dev", () => {
    expect(isDriveBrowserSpaPath("/drive/items/root-id")).toBe(true)
    expect(isDriveBrowserSpaPath("/drive/items/root-id/items/file-id")).toBe(true)
    expect(isDriveBrowserSpaPath("/files/share-id")).toBe(true)
    expect(isDriveBrowserSpaPath("/files/share-id/items/file-id")).toBe(true)

    expect(isDriveBrowserSpaPath("/drive/items/root-id/download")).toBe(false)
    expect(isDriveBrowserSpaPath("/drive/items/root-id/items/file-id/render")).toBe(false)
    expect(isDriveBrowserSpaPath("/files/share-id/download")).toBe(false)
    expect(isDriveBrowserSpaPath("/files/share-id/items/file-id/download")).toBe(false)
  })

  it("proxies public drive publication endpoints through /pages and /sites", () => {
    const proxy = config.server?.proxy
    const pagesProxy = proxy && !Array.isArray(proxy) ? proxy["/pages"] : undefined
    const sitesProxy = proxy && !Array.isArray(proxy) ? proxy["/sites"] : undefined

    expect(pagesProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
    expect(sitesProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
  })
})
