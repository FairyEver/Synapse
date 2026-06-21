import http from "node:http"
import { once } from "node:events"

import { beforeEach, describe, expect, it, vi } from "vitest"

const lookup = vi.hoisted(() => vi.fn())
const logger = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock("node:dns/promises", () => ({
  lookup,
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

import { createGuardedFetchUrl } from "../guarded-fetch-url"

describe("createGuardedFetchUrl", () => {
  beforeEach(() => {
    lookup.mockReset()
    logger.warn.mockClear()
  })

  it("rejects private literal hosts before opening a request", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    const fetchUrl = createGuardedFetchUrl()

    await expect(fetchUrl("http://user:pass@127.0.0.1/source?token=plain-token&state=plain-state&file=ok", {
      signal: new AbortController().signal,
    })).rejects.toThrow("Local and private network URLs are not allowed.")
    expect(logger.warn).toHaveBeenCalledWith("Guarded URL fetch blocked local or private host.", {
      url: "http://127.0.0.1/source?token=%5Bredacted%5D&state=%5Bredacted%5D&file=ok",
      hostname: "127.0.0.1",
      addresses: ["127.0.0.1"],
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("plain-token")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("plain-state")
  })

  it("rejects DNS results in the shared address space", async () => {
    lookup.mockResolvedValue([{ address: "100.64.0.1", family: 4 }])
    const fetchUrl = createGuardedFetchUrl()

    await expect(fetchUrl("https://source.example/source", {
      signal: new AbortController().signal,
    })).rejects.toThrow("Local and private network URLs are not allowed.")
    expect(logger.warn).toHaveBeenCalledWith("Guarded URL fetch blocked local or private host.", {
      url: "https://source.example/source",
      hostname: "source.example",
      addresses: ["100.64.0.1"],
    })
  })

  it("runs the request guard before every redirected target", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    const beforeRequest = vi.fn()
    const server = http.createServer((request, response) => {
      if (request.url?.startsWith("/start")) {
        response.statusCode = 302
        response.setHeader("location", "/final?token=redirect-secret")
        response.end()
        return
      }
      response.setHeader("content-type", "text/plain")
      response.end("ok")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.")
      const fetchUrl = createGuardedFetchUrl({ allowLocalOrPrivateHosts: true, beforeRequest })
      const response = await fetchUrl(`http://127.0.0.1:${address.port}/start`, {
        signal: new AbortController().signal,
      })

      await expect(response.text()).resolves.toBe("ok")
      expect(beforeRequest.mock.calls.map(([url]) => url.toString())).toEqual([
        `http://127.0.0.1:${address.port}/start`,
        `http://127.0.0.1:${address.port}/final?token=redirect-secret`,
      ])
    } finally {
      server.close()
      await once(server, "close")
    }
  })

  it("closes redirected response bodies before following the next target", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
    let redirectChunksSent = 0
    let redirectResponseClosed = false
    let finalRequested = false
    const server = http.createServer((request, response) => {
      if (request.url?.startsWith("/start")) {
        response.statusCode = 302
        response.setHeader("location", "/final")
        response.flushHeaders()
        const interval = setInterval(() => {
          redirectChunksSent += 1
          response.write("redirect-body")
          if (redirectChunksSent >= 20) {
            clearInterval(interval)
            response.end()
          }
        }, 5)
        response.on("close", () => {
          redirectResponseClosed = true
          clearInterval(interval)
        })
        return
      }
      finalRequested = true
      response.setHeader("content-type", "text/plain")
      response.end("ok")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.")
      const fetchUrl = createGuardedFetchUrl({ allowLocalOrPrivateHosts: true })
      const response = await fetchUrl(`http://127.0.0.1:${address.port}/start`, {
        signal: new AbortController().signal,
      })

      await expect(response.text()).resolves.toBe("ok")
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(finalRequested).toBe(true)
      expect(redirectResponseClosed).toBe(true)
      expect(redirectChunksSent).toBeLessThan(4)
    } finally {
      server.close()
      await once(server, "close")
    }
  })

  it("rejects and closes oversized response streams without content-length", async () => {
    lookup.mockImplementation(async (hostname: string) => [{ address: hostname, family: 4 }])
    let chunksSent = 0
    let responseClosed = false
    const server = http.createServer((_, response) => {
      response.setHeader("content-type", "text/plain")
      const interval = setInterval(() => {
        chunksSent += 1
        response.write("abc")
        if (chunksSent >= 20) {
          clearInterval(interval)
          response.end()
        }
      }, 5)
      response.on("close", () => {
        responseClosed = true
        clearInterval(interval)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.")
      const fetchUrl = createGuardedFetchUrl({ allowLocalOrPrivateHosts: true })
      const response = await fetchUrl(`http://127.0.0.1:${address.port}/source`, {
        signal: new AbortController().signal,
      })

      await expect(response.text({ maxBytes: 5 })).rejects.toThrow("URL response exceeds the 5 byte limit.")
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(responseClosed).toBe(true)
      expect(chunksSent).toBeLessThan(4)
    } finally {
      server.close()
      await once(server, "close")
    }
  })

  it("can discard response streams without reading the body", async () => {
    lookup.mockImplementation(async (hostname: string) => [{ address: hostname, family: 4 }])
    let chunksSent = 0
    let responseClosed = false
    const server = http.createServer((_, response) => {
      response.setHeader("content-type", "text/plain")
      const interval = setInterval(() => {
        chunksSent += 1
        response.write("abc")
        if (chunksSent >= 20) {
          clearInterval(interval)
          response.end()
        }
      }, 5)
      response.on("close", () => {
        responseClosed = true
        clearInterval(interval)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.")
      const fetchUrl = createGuardedFetchUrl({ allowLocalOrPrivateHosts: true })
      const response = await fetchUrl(`http://127.0.0.1:${address.port}/source`, {
        signal: new AbortController().signal,
      })

      response.discard?.()
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(responseClosed).toBe(true)
      expect(chunksSent).toBeLessThan(4)
    } finally {
      server.close()
      await once(server, "close")
    }
  })
})
