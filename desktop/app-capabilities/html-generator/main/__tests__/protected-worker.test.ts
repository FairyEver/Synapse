import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { PrivateStorageProtection } from "../../../../electron/runtime/process/private-storage-protection"
import { createProtectedHtmlWorkerFactory } from "../protected-worker"
import { HtmlGenerationService } from "../service"

it.runIf(process.platform === "darwin")("keeps EJS worker code in a protected process and rejects private file access", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "synapse-protected-worker-")), privateRoot = path.join(root, "mail-assets")
  mkdirSync(privateRoot); writeFileSync(path.join(privateRoot, "body.txt"), "private-canary")
  const filename = path.join(root, "worker.cjs")
  writeFileSync(filename, "const {parentPort,workerData}=require('node:worker_threads'); try { parentPort.postMessage(require('node:fs').readFileSync(workerData.path,'utf8')) } catch { parentPort.postMessage('BLOCKED') }")
  const factory = createProtectedHtmlWorkerFactory({ executablePath: process.execPath, protectProcess: new PrivateStorageProtection([privateRoot]).protectProcess })
  const worker = factory(filename, { workerData: { path: path.join(privateRoot, "body.txt") } })
  try {
    const value = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject) })
    expect(value).toBe("BLOCKED")
  } finally { await worker.terminate(); rmSync(root, { recursive: true, force: true }) }
})

it.runIf(process.platform === "darwin")("preserves real EJS rendering and cancellation while denying direct JavaScript file reads", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "synapse-protected-ejs-")), privateRoot = path.join(root, "mail-assets")
  mkdirSync(privateRoot)
  const secret = path.join(privateRoot, "body.txt")
  writeFileSync(secret, "private-canary")
  const pnpmRoot = path.resolve("..", "node_modules", ".pnpm")
  const tsx = readdirSync(pnpmRoot).find(entry => entry.startsWith("tsx@"))
  if (!tsx) throw new Error("tsx test loader unavailable")
  const loader = path.join(pnpmRoot, tsx, "node_modules/tsx/dist/cjs/api/index.cjs")
  const factory = createProtectedHtmlWorkerFactory({ executablePath: process.execPath, protectProcess: new PrivateStorageProtection([privateRoot]).protectProcess })
  const service = new HtmlGenerationService({ permissionGuard: { check: async () => ({ allowed: true }) } as never, auditSink: { record: () => undefined } as never,
    workerBaseDir: path.resolve("app-capabilities/html-generator/main"),
    workerFactory: (filename, options) => factory(`require(${JSON.stringify(loader)}).require(${JSON.stringify(filename)}, __filename)`, { ...options, eval: true }),
  })
  try {
    await expect(service.generate({ template: "<h1><%= data.title %></h1>", data: { title: "A&B" } })).resolves.toMatchObject({ html: "<h1>A&amp;B</h1>" })
    await expect(service.generate({ template: "<%- process.getBuiltinModule('node:fs').readFileSync(data.path,'utf8') %>", data: { path: secret } })).rejects.toMatchObject({ code: "RENDER_FAILED" })
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 300)
    try {
      await expect(service.generate({ template: "<% while(true) {} %>", data: {} }, { abortSignal: abort.signal })).rejects.toMatchObject({ code: "RENDER_CANCELLED" })
    } finally { clearTimeout(timer) }
  } finally { await service.stop(); rmSync(root, { recursive: true, force: true }) }
})
