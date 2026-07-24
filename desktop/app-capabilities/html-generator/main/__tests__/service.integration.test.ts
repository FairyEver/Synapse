import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HtmlGenerationService } from "../service"

const services: HtmlGenerationService[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()))
})

describe("HTML Generator real Worker", () => {
  it("renders without loading main-process validation dependencies", async () => {
    const { service } = createService(undefined, "zod")
    await expect(service.generate({
      template: "<h1><%= data.title %></h1>",
      data: { title: "packaged worker" },
    })).resolves.toMatchObject({ html: "<h1>packaged worker</h1>" })
  })

  it("renders standard escaped/raw EJS tags against the explicit data root", async () => {
    const { service } = createService()
    await expect(service.generate({
      template: "<h1><%= data.title %></h1><div><%- data.raw %></div>",
      data: { title: "A&B", raw: "<b>ok</b>" },
    })).resolves.toEqual({
      html: "<h1>A&amp;B</h1><div><b>ok</b></div>",
      size: Buffer.byteLength("<h1>A&amp;B</h1><div><b>ok</b></div>", "utf8"),
    })
  })

  it("separates compile errors from runtime errors and does not inject top-level data keys", async () => {
    const { service } = createService()
    await expect(service.generate({ template: "<% if ( %>", data: {} }))
      .rejects.toMatchObject({ code: "TEMPLATE_COMPILE_FAILED" })
    await expect(service.generate({ template: "<%= title %>", data: { title: "hidden" } }))
      .rejects.toMatchObject({ code: "RENDER_FAILED" })
  })

  it("actively blocks EJS include from reading a canary file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-html-generator-"))
    const canary = path.join(root, "secret.ejs")
    try {
      await writeFile(canary, "CANARY_SECRET")
      const { service } = createService()
      const templates = [
        `<%- include(${JSON.stringify(canary)}) %>`,
        `<% const load = include %><%- load(data.path) %>`,
        `<% process.chdir(${JSON.stringify(root)}) %><%- include("secret.ejs") %>`,
      ]
      for (const template of templates) {
        await expect(service.generate({ template, data: { path: canary } }))
          .rejects.toMatchObject({ code: "RENDER_FAILED" })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("consumes Worker stdout and stderr without logging template output", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const { service } = createService(logger)
    await expect(service.generate({
      template: '<% console.log("STDOUT_SECRET"); process.stderr.write("STDERR_SECRET") %>ok',
      data: {},
    })).resolves.toMatchObject({ html: "ok" })
    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain("STDOUT_SECRET")
    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain("STDERR_SECRET")
  })

  it("keeps data mutations inside one render and discards Worker global state afterward", async () => {
    const { service } = createService()
    const template = '<% data.count = 2; globalThis.renderCount = (globalThis.renderCount || 0) + 1 %><%= data.count %>:<%= globalThis.renderCount %>'
    const input = { count: 1 }
    await expect(service.generate({ template, data: input })).resolves.toMatchObject({ html: "2:1" })
    await expect(service.generate({ template, data: input })).resolves.toMatchObject({ html: "2:1" })
    expect(input).toEqual({ count: 1 })
  })

  it("rejects oversized and non-well-formed Worker output without returning partial HTML", async () => {
    const { service } = createService()
    await expect(service.generate({ template: '<%- "x".repeat(5 * 1024 * 1024 + 1) %>', data: {} }))
      .rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" })
    await expect(service.generate({ template: "<%- String.fromCharCode(0xd800) %>", data: {} }))
      .rejects.toMatchObject({ code: "RENDER_FAILED" })
  })

  it("terminates a real infinite loop at the fixed render timeout", async () => {
    const { service } = createService()
    const startedAt = Date.now()
    await expect(service.generate({ template: "<% while (true) {} %>", data: {} }))
      .rejects.toMatchObject({ code: "RENDER_TIMEOUT" })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_500)
    expect(Date.now() - startedAt).toBeLessThan(8_000)
  }, 10_000)
})

function createService(
  logger?: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> },
  blockedWorkerModule?: string,
) {
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }
  const auditSink = { record: vi.fn() }
  const service = new HtmlGenerationService({
    permissionGuard: permissionGuard as never,
    auditSink: auditSink as never,
    logger,
    workerBaseDir: path.resolve("app-capabilities/html-generator/main"),
    workerFactory(filename, options) {
      const apiPath = resolveTsxCjsApi()
      const blockModule = blockedWorkerModule
        ? [
            'const Module = require("node:module")',
            "const originalLoad = Module._load",
            "Module._load = function(request, parent, isMain) {",
            `  if (request === ${JSON.stringify(blockedWorkerModule)}) throw new Error("blocked Worker module")`,
            "  return originalLoad.call(this, request, parent, isMain)",
            "}",
          ].join("\n")
        : ""
      const bootstrap = [
        blockModule,
        `require(${JSON.stringify(apiPath)}).require(${JSON.stringify(filename)}, __filename)`,
      ].filter(Boolean).join("\n")
      return new Worker(bootstrap, { ...options, eval: true })
    },
  })
  services.push(service)
  return { service, permissionGuard, auditSink }
}

function resolveTsxCjsApi(): string {
  const pnpmRoot = path.resolve("..", "node_modules", ".pnpm")
  const packageDir = readdirSync(pnpmRoot).find((entry) => entry.startsWith("tsx@"))
  if (!packageDir) throw new Error("tsx test loader is unavailable")
  return path.join(pnpmRoot, packageDir, "node_modules", "tsx", "dist", "cjs", "api", "index.cjs")
}
