import { describe, expect, it } from "vitest"
import config, {
  isDriveBrowserSpaPath,
  resolveDesktopUpdateDevHtmlPath,
  resolveDashboardDevSpaFallback,
  resolveLegacyDashboardDevRedirect,
} from "./vite.config"

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

  it("serves the independent desktop update entry at the stable path in dev and build", () => {
    expect(resolveDesktopUpdateDevHtmlPath("/desktop/update")).toBe("/desktop-update.html")
    expect(resolveDesktopUpdateDevHtmlPath("/desktop/update", "?version=1.2.3")).toBe("reject")
    expect(resolveDesktopUpdateDevHtmlPath("/desktop/update", "?mode=install")).toBe("reject")
    expect(resolveDesktopUpdateDevHtmlPath("/desktop/update/")).toBeNull()
    expect(resolveDesktopUpdateDevHtmlPath("/console/desktop/update")).toBeNull()
    expect(config.build?.rollupOptions?.input).toEqual(expect.objectContaining({
      dashboard: expect.stringContaining("index.html"),
      desktopUpdate: expect.stringContaining("desktop-update.html"),
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

  it("proxies public asset file links through /files", () => {
    const proxy = config.server?.proxy
    const filesProxy = proxy && !Array.isArray(proxy) ? proxy["/files"] : undefined

    expect(filesProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
  })

  it("keeps direct drive responses behind focused proxy rules", () => {
    const proxy = config.server?.proxy
    const ownerDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy["^/drive/items/[^/]+/(download|render)$"]
      : undefined
    const shareDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy["^/share/[^/]+/(download|render)$"]
      : undefined
    const shareChildDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy["^/share/[^/]+/items/[^/]+/(download|render)$"]
      : undefined

    expect(ownerDownloadProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
    expect(shareDownloadProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
    expect(shareChildDownloadProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
    expect(proxy && !Array.isArray(proxy) ? proxy["/share"] : undefined).toBeUndefined()
  })

  it("serves drive browser page routes through the dashboard app in dev", () => {
    expect(isDriveBrowserSpaPath("/drive")).toBe(true)
    expect(isDriveBrowserSpaPath("/drive/")).toBe(true)
    expect(isDriveBrowserSpaPath("/console/drive")).toBe(true)
    expect(isDriveBrowserSpaPath("/console/drive/folders/root-id")).toBe(true)
    expect(isDriveBrowserSpaPath("/drive/items/file-id")).toBe(true)
    expect(isDriveBrowserSpaPath("/share/share-id")).toBe(true)
    expect(isDriveBrowserSpaPath("/share/share-id/items/file-id")).toBe(true)

    expect(isDriveBrowserSpaPath("/drive/items/file-id/download")).toBe(false)
    expect(isDriveBrowserSpaPath("/drive/items/file-id/render")).toBe(false)
    expect(isDriveBrowserSpaPath("/share/share-id/download")).toBe(false)
    expect(isDriveBrowserSpaPath("/share/share-id/items/file-id/download")).toBe(false)
  })

  it("redirects legacy dashboard page routes to console paths in dev", () => {
    expect(resolveLegacyDashboardDevRedirect("/dashboard")).toBe("/console/")
    expect(resolveLegacyDashboardDevRedirect("/dashboard/")).toBe("/console/")
    expect(resolveLegacyDashboardDevRedirect("/dashboard/auth/desktop")).toBe("/console/auth/desktop")
    expect(resolveLegacyDashboardDevRedirect("/dashboard/users")).toBe("/console/users")
    expect(resolveLegacyDashboardDevRedirect("/api/dashboard/session")).toBeNull()
    expect(resolveLegacyDashboardDevRedirect("/console/auth/desktop")).toBeNull()
  })

  it("keeps drive direct response routes out of the dashboard app fallback", () => {
    expect(resolveDashboardDevSpaFallback("/drive")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/drive/")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/console/drive")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/share/share-id")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/drive/items/file-id")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/share/share-id/items/file-id/download")).toBeNull()
    expect(resolveDashboardDevSpaFallback("/drive/items/file-id/render")).toBeNull()
  })

  it("proxies published site routes while keeping retired page routes removed", () => {
    const proxy = config.server?.proxy
    const pagesProxy = proxy && !Array.isArray(proxy) ? proxy["/pages"] : undefined
    const sitesProxy = proxy && !Array.isArray(proxy) ? proxy["/sites"] : undefined

    expect(pagesProxy).toBeUndefined()
    expect(sitesProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
  })
})
