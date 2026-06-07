import { describe, expect, it } from "vitest"
import config from "./vite.config"

describe("dashboard Vite dev proxy", () => {
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
})
