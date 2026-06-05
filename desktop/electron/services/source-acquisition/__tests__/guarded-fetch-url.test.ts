import http from "node:http"
import { once } from "node:events"

import { beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

import { createGuardedFetchUrl } from "../guarded-fetch-url"

describe("createGuardedFetchUrl", () => {
  beforeEach(() => {
    logger.warn.mockClear()
  })

  it("rejects private literal hosts before opening a request", async () => {
    const fetchUrl = createGuardedFetchUrl()

    await expect(fetchUrl("http://127.0.0.1/source", {
      signal: new AbortController().signal,
    })).rejects.toThrow("Local and private network URLs are not allowed.")
    expect(logger.warn).toHaveBeenCalledWith("Guarded URL fetch blocked local or private host.", {
      url: "http://127.0.0.1/source",
      hostname: "127.0.0.1",
      addresses: ["127.0.0.1"],
    })
  })

  it("rejects and closes oversized response streams without content-length", async () => {
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
})
