import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"

import {
  parseWaitForHttpArgs,
  waitForHttp,
} from "../dev/wait-for-http.mjs"

async function withServer(handler, callback) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))

  try {
    const address = server.address()
    return await callback(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

test("parseWaitForHttpArgs reads the url and timing options", () => {
  assert.deepEqual(parseWaitForHttpArgs([
    "http://127.0.0.1:3001/healthz",
    "--timeout-ms",
    "1000",
    "--interval-ms",
    "25",
    "--request-timeout-ms",
    "200",
  ]), {
    url: "http://127.0.0.1:3001/healthz",
    timeoutMs: 1000,
    intervalMs: 25,
    requestTimeoutMs: 200,
  })
})

test("waitForHttp resolves once the endpoint returns ok", async () => {
  let attempts = 0

  await withServer((request, response) => {
    attempts += 1
    response.statusCode = attempts >= 2 ? 200 : 503
    response.end("ok")
  }, async (baseUrl) => {
    const result = await waitForHttp({
      url: `${baseUrl}/healthz`,
      timeoutMs: 1000,
      intervalMs: 10,
    })

    assert.equal(result.status, 200)
    assert.equal(attempts, 2)
  })
})

test("waitForHttp rejects when the endpoint never becomes ok", async () => {
  await withServer((request, response) => {
    response.statusCode = 503
    response.end("not ready")
  }, async (baseUrl) => {
    await assert.rejects(
      waitForHttp({
        url: `${baseUrl}/healthz`,
        timeoutMs: 20,
        intervalMs: 5,
      }),
      /Timed out waiting for/u,
    )
  })
})

test("waitForHttp allows readiness checks to take longer than the retry interval", async () => {
  await withServer((request, response) => {
    setTimeout(() => {
      response.statusCode = 200
      response.end("ready")
    }, 50)
  }, async (baseUrl) => {
    const result = await waitForHttp({
      url: `${baseUrl}/readyz`,
      timeoutMs: 500,
      intervalMs: 5,
      requestTimeoutMs: 200,
    })
    assert.equal(result.status, 200)
  })
})

test("waitForHttp keeps a slow request within the overall startup deadline", async () => {
  await withServer((request, response) => {
    response.setHeader("Connection", "close")
    setTimeout(() => response.end("ready"), 100)
  }, async (baseUrl) => {
    await assert.rejects(waitForHttp({
      url: `${baseUrl}/readyz`,
      timeoutMs: 20,
      intervalMs: 5,
      requestTimeoutMs: 200,
    }), /Timed out waiting for/u)
  })
})
