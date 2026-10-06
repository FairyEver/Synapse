import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  aggregateSpeeds,
  bytesToMbps,
  parseArgs,
  runSpeedTest,
} from "../diagnostics/speed-test.mjs"

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

test("parseArgs resolves server endpoints and numeric options", () => {
  const options = parseArgs([
    "--",
    "--server",
    "https://example.com/network",
    "--rounds",
    "4",
    "--size-mb",
    "0.5",
    "--timeout-ms",
    "2000",
  ], {})

  assert.equal(options.downloadUrl, "https://example.com/network/speedtest/download")
  assert.equal(options.uploadUrl, "https://example.com/network/speedtest/upload")
  assert.equal(options.rounds, 4)
  assert.equal(options.sizeBytes, 524288)
  assert.equal(options.timeoutMs, 2000)
})

test("parseArgs accepts explicit endpoints from environment", () => {
  const options = parseArgs([], {
    SYNAPSE_SPEEDTEST_DOWNLOAD_URL: "https://download.example.test/speed",
    SYNAPSE_SPEEDTEST_UPLOAD_URL: "https://upload.example.test/speed",
  })

  assert.equal(options.downloadUrl, "https://download.example.test/speed")
  assert.equal(options.uploadUrl, "https://upload.example.test/speed")
})

test("parseArgs defaults to the deployment SSH target", () => {
  const options = parseArgs([], {})

  assert.equal(options.mode, "ssh")
  assert.equal(options.sshTarget, "root@120.53.17.64")
})

test("bytesToMbps and aggregateSpeeds use decimal megabits", () => {
  assert.equal(bytesToMbps(1_000_000, 1_000), 8)
  assert.deepEqual(aggregateSpeeds([
    { downloadMbps: 10, uploadMbps: 2 },
    { downloadMbps: 30, uploadMbps: 4 },
    { downloadMbps: 20, uploadMbps: 6 },
  ]), {
    averageDownloadMbps: 20,
    averageUploadMbps: 4,
    medianDownloadMbps: 20,
    medianUploadMbps: 4,
  })
})

test("runSpeedTest performs multiple transfers and removes temporary files", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "synapse-speedtest-test-root-"))
  let downloadRequests = 0
  let uploadRequests = 0

  try {
    await withServer((request, response) => {
      const requestUrl = new URL(request.url, "http://127.0.0.1")
      const bytes = Number(requestUrl.searchParams.get("bytes"))

      if (requestUrl.pathname === "/speedtest/download") {
        downloadRequests += 1
        response.writeHead(200, { "content-type": "application/octet-stream" })
        response.end(Buffer.alloc(bytes, 7))
        return
      }

      if (requestUrl.pathname === "/speedtest/upload") {
        uploadRequests += 1
        let received = 0
        request.on("data", (chunk) => { received += chunk.length })
        request.on("end", () => {
          assert.equal(received, bytes)
          response.writeHead(204)
          response.end()
        })
        return
      }

      response.writeHead(404)
      response.end()
    }, async (serverUrl) => {
      const result = await runSpeedTest({
        ...parseArgs(["--server", serverUrl, "--rounds", "2", "--size-mb", "0.01"], {}),
      }, { tempRoot })

      assert.equal(result.rounds.length, 2)
      assert.equal(result.failures.length, 0)
      assert.equal(downloadRequests, 2)
      assert.equal(uploadRequests, 2)
      assert.ok(result.summary.averageDownloadMbps > 0)
      assert.ok(result.summary.averageUploadMbps > 0)
    })

    assert.deepEqual(await readdir(tempRoot), [])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("runSpeedTest cleans temporary files when every round fails", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "synapse-speedtest-failure-root-"))

  try {
    await withServer((request, response) => {
      request.resume()
      request.on("end", () => {
        response.writeHead(503)
        response.end("unavailable")
      })
    }, async (serverUrl) => {
      await assert.rejects(
        runSpeedTest({
          ...parseArgs(["--server", serverUrl, "--rounds", "2", "--size-mb", "0.01"], {}),
        }, { tempRoot }),
        /所有测速轮次均失败/u,
      )
    })

    assert.deepEqual(await readdir(tempRoot), [])
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
