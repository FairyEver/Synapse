import { describe, expect, it } from "vitest"
import config from "./vite.config"

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

  it("proxies public drive share endpoints through /files", () => {
    const proxy = config.server?.proxy
    const filesProxy = proxy && !Array.isArray(proxy) ? proxy["/files"] : undefined

    expect(filesProxy).toEqual(expect.objectContaining({
      target: "http://localhost:3001",
      changeOrigin: true,
    }))
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
