import type { UserConfig } from "vite"
import { describe, expect, it } from "vitest"
import viteConfig, { createAdminBaseRedirectPlugin } from "../vite.config"

describe("admin vite config", () => {
  it("serves built assets from the admin route", () => {
    expect((viteConfig as UserConfig).base).toBe("/admin/")
  })

  it("serves admin dev UI on the public server port and proxies backend routes", () => {
    const server = (viteConfig as UserConfig).server
    const proxy = server?.proxy as Record<string, { target: string }> | undefined

    expect(server?.port).toBe(3000)
    expect(server?.strictPort).toBe(true)
    expect(server?.open).toBeUndefined()
    expect(proxy?.["/admin/api"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/admin/session"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/admin/login"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/admin/logout"]?.target).toBe("http://localhost:3001")
    expect(proxy?.["/v1"]?.target).toBe("http://localhost:3001")
  })

  it("redirects the extensionless admin base route to the configured base path", () => {
    const plugin = createAdminBaseRedirectPlugin()
    let handler:
      | ((
          request: { url?: string },
          response: {
            writeHead: (status: number, headers: { Location: string }) => void
            end: () => void
          },
          next: () => void,
        ) => void)
      | undefined

    if (typeof plugin.configureServer !== "function") {
      throw new Error("Expected admin base redirect plugin to register a dev server hook.")
    }

    plugin.configureServer.call({} as never, {
      middlewares: {
        use: (registeredHandler: typeof handler) => {
          handler = registeredHandler
        },
      },
    } as never)

    const redirects: Array<{ status: number; url: string }> = []
    handler?.(
      { url: "/admin" },
      {
        writeHead: (status, headers) => redirects.push({ status, url: headers.Location }),
        end: () => undefined,
      },
      () => redirects.push({ status: 0, url: "next" }),
    )

    expect(redirects).toEqual([{ status: 302, url: "/admin/" }])
  })
})
