// 在候选 Electron 的 RUN_AS_NODE 独立进程执行，不加载 Synapse 或用户数据。
const assert = require("node:assert/strict")
const http = require("node:http")
const zlib = require("node:zlib")

async function probe() {
  const text = "synapse-electron-network-probe".repeat(30)
  const bytes = Buffer.from(text)
  const br = zlib.brotliCompressSync(bytes)
  assert.deepEqual(zlib.brotliDecompressSync(br), bytes)
  assert.throws(() => zlib.brotliDecompressSync(br.subarray(0, br.length - 2)))
  assert.throws(() => zlib.brotliDecompressSync(Buffer.from([255])))
  const timers = new Set()
  const server = http.createServer((req, res) => {
    if (req.url === "/slow") {
      const timer = setTimeout(() => { timers.delete(timer); res.end(text) }, 1000)
      timers.add(timer)
      return
    }
    if (req.url === "/redirect") { res.writeHead(302, { location: "/br" }); res.end(); return }
    let data = bytes
    if (req.url === "/gzip") { res.setHeader("content-encoding", "gzip"); data = zlib.gzipSync(bytes) }
    if (req.url === "/deflate") { res.setHeader("content-encoding", "deflate"); data = zlib.deflateSync(bytes) }
    if (["/br", "/split", "/truncated", "/invalid"].includes(req.url)) {
      res.setHeader("content-encoding", "br")
      data = req.url === "/invalid" ? Buffer.from([255]) : br
    }
    if (req.url === "/truncated") {
      res.setHeader("content-length", data.length)
      res.setHeader("connection", "close")
      res.end(data.subarray(0, data.length - 2))
    } else if (req.url === "/split") {
      let offset = 0
      const timer = setInterval(() => {
        if (offset === data.length) { clearInterval(timer); timers.delete(timer); res.end() }
        else res.write(data.subarray(offset, ++offset))
      }, 1)
      timers.add(timer)
    } else res.end(data)
  })
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    for (const route of ["/plain", "/br", "/gzip", "/deflate", "/split", "/redirect"]) {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(5000) })
      assert.equal(await response.text(), text, route)
    }
    // 远端可忽略 Accept-Encoding；仅移除 br 请求头并不能修复解码器。
    assert.equal(await (await fetch(origin + "/br", { headers: { "accept-encoding": "gzip, deflate" } })).text(), text)
    for (const route of ["/invalid", "/truncated"]) {
      await assert.rejects(async () => (await fetch(origin + route, { signal: AbortSignal.timeout(5000) })).text())
    }
    assert.equal((await fetch(origin + "/redirect", { redirect: "manual" })).status, 302)
    const controller = new AbortController()
    const pending = fetch(origin + "/slow", { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { name: "AbortError" })
    await assert.rejects(fetch(origin + "/slow", { signal: AbortSignal.timeout(30) }), { name: "TimeoutError" })
    process.stdout.write(JSON.stringify({ electron: process.versions.electron, node: process.versions.node,
      chrome: process.versions.chrome, brotli: process.versions.brotli, platform: process.platform,
      arch: process.arch, smoke: "passed" }))
  } finally {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
probe().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
