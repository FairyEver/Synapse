import { describe, expect, it } from "vitest"
import config, {
  isDriveBrowserSpaPath,
  isRetiredTeamRoutePath,
  resolveDesktopUpdateDevHtmlPath,
  resolveDashboardDevSpaFallback,
  resolveLegacyDashboardDevRedirect,
} from "./vite.config"

describe("dashboard Vite dev proxy", () => {
  it("emits assets from the stable console prefix for nested production routes", () => {
    expect(config.base).toBe("/console/")
  })

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
    expect(resolveDesktopUpdateDevHtmlPath("/desktop/update")).toBe("/console/desktop-update.html")
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

  it("proxies platform object links through /object", () => {
    const proxy = config.server?.proxy
    const objectProxy = proxy && !Array.isArray(proxy) ? proxy["/object"] : undefined

    expect(objectProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
  })

  it("keeps direct drive responses behind focused proxy rules", () => {
    const proxy = config.server?.proxy
    const ownerDownloadPattern = "^/drive/items/[^/]+/(download|render)(?:\\?.*)?$"
    const shareDownloadPattern = "^/share/[^/]+/(download|render)(?:\\?.*)?$"
    const shareChildDownloadPattern = "^/share/[^/]+/items/[^/]+/(download|render)(?:\\?.*)?$"
    const ownerDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy[ownerDownloadPattern]
      : undefined
    const shareDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy[shareDownloadPattern]
      : undefined
    const shareChildDownloadProxy = proxy && !Array.isArray(proxy)
      ? proxy[shareChildDownloadPattern]
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
    expect(new RegExp(ownerDownloadPattern).test("/drive/items/file-1/download?version=1")).toBe(true)
    expect(new RegExp(shareChildDownloadPattern).test("/share/share-1/items/image-1/download?version=1")).toBe(true)
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
    expect(resolveLegacyDashboardDevRedirect("/dashboard/users")).toBe("/admin/users")
    expect(resolveLegacyDashboardDevRedirect("/console/users")).toBe("/admin/users")
    expect(resolveLegacyDashboardDevRedirect("/dashboard/teams")).toBeNull()
    expect(resolveLegacyDashboardDevRedirect("/dashboard/invitations")).toBeNull()
    expect(resolveLegacyDashboardDevRedirect("/dashboard/auth/desktop")).toBeNull()
    expect(resolveLegacyDashboardDevRedirect("/dashboard/unknown")).toBeNull()
    expect(resolveLegacyDashboardDevRedirect("/api/dashboard/session")).toBeNull()
    expect(resolveLegacyDashboardDevRedirect("/console/auth/desktop")).toBeNull()
  })

  it("returns 404 for retired team and invitation pages in dev", () => {
    for (const path of [
      "/team-invite",
      "/console/team-invite",
      "/dashboard/team-invite",
      "/admin/teams",
      "/admin/invitations",
      "/console/teams",
      "/dashboard/invitations/legacy",
    ]) {
      expect(isRetiredTeamRoutePath(path)).toBe(true)
    }
    expect(isRetiredTeamRoutePath("/admin/users")).toBe(false)
    expect(isRetiredTeamRoutePath("/console/settings")).toBe(false)
  })

  it("keeps drive direct response routes out of the dashboard app fallback", () => {
    expect(resolveDashboardDevSpaFallback("/admin")).toBe("/console/admin.html")
    expect(resolveDashboardDevSpaFallback("/admin/access")).toBe("/console/admin.html")
    expect(resolveDashboardDevSpaFallback("/drive")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/drive/")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/console/")).toBe("/console/index.html")
    expect(resolveDashboardDevSpaFallback("/console/drive")).toBe("/console/index.html")
    expect(resolveDashboardDevSpaFallback("/share/share-id")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/drive/items/file-id")).toBe("/console/")
    expect(resolveDashboardDevSpaFallback("/share/share-id/items/file-id/download")).toBeNull()
    expect(resolveDashboardDevSpaFallback("/drive/items/file-id/render")).toBeNull()
  })

  it("keeps Vite modules and public assets out of the console SPA fallback", () => {
    expect(resolveDashboardDevSpaFallback("/console/@vite/client")).toBeNull()
    expect(resolveDashboardDevSpaFallback("/console/@react-refresh")).toBeNull()
    expect(resolveDashboardDevSpaFallback("/console/src/main.tsx")).toBeNull()
    expect(resolveDashboardDevSpaFallback("/console/synapse-logo.png")).toBeNull()
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
