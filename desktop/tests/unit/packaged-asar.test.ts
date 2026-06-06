import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const redactionUnpackedSegments = ["app.asar.unpacked", "dist-electron", "src", "lib", "agent-redaction.js"]
const builtinToolBootstrapSegments = [
  "app.asar.unpacked",
  "dist-electron",
  "electron",
  "worker-bootstraps",
  "builtin-tool-worker-bootstrap.js",
]
const builtinToolBootstrapMapSegments = [
  "app.asar.unpacked",
  "dist-electron",
  "electron",
  "worker-bootstraps",
  "builtin-tool-worker-bootstrap.js.map",
]

function nativeClaudePackageNames(platform: NodeJS.Platform, arch: string): readonly string[] {
  if (platform === "linux") {
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`,
      `@anthropic-ai/claude-agent-sdk-linux-${arch}`,
    ]
  }
  if (platform === "darwin" || platform === "win32") {
    return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`]
  }
  return []
}

function currentClaudeBinarySegments(): readonly string[] {
  const packageName = nativeClaudePackageNames(process.platform, process.arch)[0]
  if (!packageName) {
    return ["app.asar.unpacked", "node_modules", "@anthropic-ai", "unsupported", "claude"]
  }
  return [
    "app.asar.unpacked",
    "node_modules",
    ...packageName.split("/"),
    process.platform === "win32" ? "claude.exe" : "claude",
  ]
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

interface CreateAsarBufferOptions {
  readonly includeBuiltinToolWorker?: boolean
  readonly includeFileConversionService?: boolean
  readonly unpackBuiltinToolWorker?: boolean
  readonly includeClaudeRuntimeGuard?: boolean
}

function createPackedFileNode(offset: number, content: Buffer, unpacked = false) {
  return {
    size: content.length,
    offset: String(offset),
    integrity: { hash: hash(content) },
    ...(unpacked ? { unpacked: true } : {}),
  }
}

function createAsarBuffer(options: CreateAsarBufferOptions = {}): Buffer {
  const {
    includeBuiltinToolWorker = true,
    includeFileConversionService = true,
    unpackBuiltinToolWorker = false,
    includeClaudeRuntimeGuard = true,
  } = options
  const packageJson = Buffer.from(JSON.stringify({ main: "dist-electron/electron/main.js" }), "utf8")
  const mainJs = Buffer.from("require('./bootstrap/descriptors.js')\n", "utf8")
  const builtinToolWorker = Buffer.from("require('../services/builtin-tools/worker-execute')\n", "utf8")
  const builtinToolWorkerMap = Buffer.from("{}\n", "utf8")
  const fileConversionService = Buffer.from("module.exports = {}\n", "utf8")
  const diagnosticsService = Buffer.from("const id = 'app.claude-runtime'; const message = '内置 Claude Code runtime';\n", "utf8")
  const claudeRuntimeBinary = Buffer.from("export function inspectPackagedClaudeRuntime() {} // 内置 Claude Code runtime\n", "utf8")
  const claudeSdkSession = Buffer.from("inspectPackagedClaudeRuntime(); queryOptions.pathToClaudeCodeExecutable = executablePath;\n", "utf8")
  let offset = 0
  const packageNode = createPackedFileNode(offset, packageJson)
  offset += packageJson.length
  const mainNode = createPackedFileNode(offset, mainJs)
  offset += mainJs.length
  const workerNode = createPackedFileNode(offset, builtinToolWorker, unpackBuiltinToolWorker)
  if (includeBuiltinToolWorker && !unpackBuiltinToolWorker) {
    offset += builtinToolWorker.length
  }
  const workerMapNode = createPackedFileNode(offset, builtinToolWorkerMap, unpackBuiltinToolWorker)
  if (includeBuiltinToolWorker && !unpackBuiltinToolWorker) {
    offset += builtinToolWorkerMap.length
  }
  const serviceNode = createPackedFileNode(offset, fileConversionService)
  if (includeFileConversionService) {
    offset += fileConversionService.length
  }
  const diagnosticsNode = createPackedFileNode(offset, diagnosticsService)
  if (includeClaudeRuntimeGuard) {
    offset += diagnosticsService.length
  }
  const claudeRuntimeBinaryNode = createPackedFileNode(offset, claudeRuntimeBinary)
  if (includeClaudeRuntimeGuard) {
    offset += claudeRuntimeBinary.length
  }
  const claudeSdkSessionNode = createPackedFileNode(offset, claudeSdkSession)
  if (includeClaudeRuntimeGuard) {
    offset += claudeSdkSession.length
  }
  const header = Buffer.from(JSON.stringify({
    files: {
      "package.json": packageNode,
      "dist-electron": {
        files: {
          electron: {
            files: {
              "main.js": mainNode,
              workers: {
                files: {
                  ...(includeBuiltinToolWorker
                    ? {
                        "builtin-tool-worker.js": workerNode,
                        "builtin-tool-worker.js.map": workerMapNode,
                      }
                    : {}),
                },
              },
              "worker-bootstraps": {
                files: {
                  "builtin-tool-worker-bootstrap.js": {
                    size: 1,
                    offset: "0",
                    unpacked: true,
                  },
                  "builtin-tool-worker-bootstrap.js.map": {
                    size: 1,
                    offset: "0",
                    unpacked: true,
                  },
                },
              },
              services: {
                files: {
                  ...(includeClaudeRuntimeGuard
                    ? {
                        "diagnostics-service.js": diagnosticsNode,
                        "agent-runtime": {
                          files: {
                            "claude-runtime-binary.js": claudeRuntimeBinaryNode,
                            "claude-sdk-session.js": claudeSdkSessionNode,
                          },
                        },
                      }
                    : {}),
                  ...(includeFileConversionService
                    ? {
                        "file-conversion": {
                          files: {
                            "index.js": serviceNode,
                          },
                        },
                      }
                    : {}),
                },
              },
            },
          },
          src: {
            files: {
              lib: {
                files: {
                  "agent-redaction.js": {
                    size: 1,
                    offset: "0",
                    unpacked: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  }), "utf8")
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(8 + header.length, 4)
  prefix.writeUInt32LE(header.length, 12)
  return Buffer.concat([
    prefix,
    header,
    packageJson,
    mainJs,
    ...(includeBuiltinToolWorker && !unpackBuiltinToolWorker ? [builtinToolWorker] : []),
    ...(includeBuiltinToolWorker && !unpackBuiltinToolWorker ? [builtinToolWorkerMap] : []),
    ...(includeFileConversionService ? [fileConversionService] : []),
    ...(includeClaudeRuntimeGuard ? [diagnosticsService] : []),
    ...(includeClaudeRuntimeGuard ? [claudeRuntimeBinary] : []),
    ...(includeClaudeRuntimeGuard ? [claudeSdkSession] : []),
  ])
}

describe("packaged asar verification", () => {
  async function writeUnpackedFixture(resourcesPath: string, segments: readonly string[], content = "x") {
    const filePath = path.join(resourcesPath, ...segments)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
    return filePath
  }

  it("verifies a Windows-style resources directory with unpacked files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapSegments)
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapMapSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])

      expect(result.stdout).toContain("Verified resources")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the Claude SDK native binary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapSegments)
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapMapSegments)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("Claude SDK native binary is missing"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the packaged Claude runtime guard", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeClaudeRuntimeGuard: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapSegments)
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapMapSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("packaged Claude runtime guard"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the builtin tool bootstrap worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("builtin-tool-worker-bootstrap.js"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages that unpack the real builtin tool worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      const builtinToolWorker = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "electron",
        "workers",
        "builtin-tool-worker.js",
      )
      const builtinToolWorkerMap = `${builtinToolWorker}.map`
      const builtinToolBootstrap = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "electron",
        "worker-bootstraps",
        "builtin-tool-worker-bootstrap.js",
      )
      await mkdir(path.dirname(builtinToolWorker), { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ unpackBuiltinToolWorker: true }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeFile(builtinToolWorker, "x")
      await writeFile(builtinToolWorkerMap, "x")
      await mkdir(path.dirname(builtinToolBootstrap), { recursive: true })
      await writeFile(builtinToolBootstrap, "x")
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapMapSegments)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("builtin-tool-worker.js must stay packed"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the packed file conversion service", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      const builtinToolBootstrap = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "electron",
        "worker-bootstraps",
        "builtin-tool-worker-bootstrap.js",
      )
      await mkdir(path.dirname(builtinToolBootstrap), { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeFileConversionService: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeFile(builtinToolBootstrap, "x")
      await writeUnpackedFixture(resourcesPath, builtinToolBootstrapMapSegments)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("dist-electron/electron/services/file-conversion/index.js"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
