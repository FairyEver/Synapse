import type { UserConfig } from "vite"
import { describe, expect, it } from "vitest"
import viteConfig from "../vite.config"

describe("admin vite config", () => {
  it("serves built assets from the admin route", () => {
    expect((viteConfig as UserConfig).base).toBe("/admin/")
  })

  it("serves admin dev UI on the public server port and proxies backend routes", () => {
    const server = (viteConfig as UserConfig).server
    const proxy = server?.proxy as Record<string, { target: string }> | undefined

    expect(server?.port).toBe(3000)
    expect(server?.strictPort).toBe(true)
    expect(server?.open).toBe("/admin/")
    expect(proxy?.["/admin/api"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/admin/session"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/admin/login"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/admin/logout"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/v1"]?.target).toBe("http://localhost:3001")
  })
})
