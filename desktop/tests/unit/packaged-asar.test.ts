import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const redactionUnpackedSegments = ["app.asar.unpacked", "dist-electron", "src", "lib", "agent-redaction.js"]

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
  readonly includeClaudeRuntimeGuard?: boolean
  readonly includeDeploymentConfig?: boolean
  readonly includeSharedPackage?: boolean
  readonly includeUsageAnalysisWorkers?: boolean
  readonly includeUnpackedSourceMaps?: boolean
}

function createPackedFileNode(offset: number, content: Buffer, unpacked = false) {
  return {
    size: content.length,
    offset: String(offset),
    integrity: { hash: hash(content) },
    ...(unpacked ? { unpacked: true } : {}),
  }
}

function createUnpackedFileNode() {
  return {
    size: 1,
    offset: "0",
    unpacked: true,
  }
}

function createUnpackedJsFiles(includeSourceMaps: boolean) {
  return {
    "agent-redaction.js": createUnpackedFileNode(),
    ...(includeSourceMaps ? { "agent-redaction.js.map": createUnpackedFileNode() } : {}),
  }
}

function createUsageAnalysisFiles(includeSourceMaps: boolean) {
  const files = {
    "conversation-worker.js": createUnpackedFileNode(),
    "cc-conversation-service.js": createUnpackedFileNode(),
    "cc-service.js": createUnpackedFileNode(),
    "refresh-worker.js": createUnpackedFileNode(),
    "db-schema.js": createUnpackedFileNode(),
  }
  if (!includeSourceMaps) return files
  return {
    ...files,
    "conversation-worker.js.map": createUnpackedFileNode(),
    "cc-conversation-service.js.map": createUnpackedFileNode(),
    "cc-service.js.map": createUnpackedFileNode(),
    "refresh-worker.js.map": createUnpackedFileNode(),
    "db-schema.js.map": createUnpackedFileNode(),
  }
}

function createModelPriceFiles(includeSourceMaps: boolean) {
  return {
    "index.js": createUnpackedFileNode(),
    ...(includeSourceMaps ? { "index.js.map": createUnpackedFileNode() } : {}),
  }
}

function createAsarBuffer(options: CreateAsarBufferOptions = {}): Buffer {
  const {
    includeClaudeRuntimeGuard = true,
    includeDeploymentConfig = true,
    includeSharedPackage = true,
    includeUsageAnalysisWorkers = false,
    includeUnpackedSourceMaps = true,
  } = options
  const packageJson = Buffer.from(JSON.stringify({ main: "dist-electron/electron/main.js" }), "utf8")
  const mainJs = Buffer.from("require('./bootstrap/descriptors.js')\n", "utf8")
  const diagnosticsService = Buffer.from("const id = 'app.claude-runtime'; const message = '内置 Claude Code runtime';\n", "utf8")
  const claudeRuntimeBinary = Buffer.from("export function inspectPackagedClaudeRuntime() {} // 内置 Claude Code runtime\n", "utf8")
  const claudeSdkSession = Buffer.from("inspectPackagedClaudeRuntime(); queryOptions.pathToClaudeCodeExecutable = executablePath;\n", "utf8")
  const deploymentConfig = Buffer.from("exports.SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG = { apiBaseUrl: 'https://app.example.com/api' };\n", "utf8")
  const sharedIndex = Buffer.from("export const DESKTOP_CLIENT_ID = 'synapse-desktop';\n", "utf8")
  let offset = 0
  const packageNode = createPackedFileNode(offset, packageJson)
  offset += packageJson.length
  const mainNode = createPackedFileNode(offset, mainJs)
  offset += mainJs.length
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
  const deploymentConfigNode = createPackedFileNode(offset, deploymentConfig)
  if (includeDeploymentConfig) {
    offset += deploymentConfig.length
  }
  const sharedIndexNode = createPackedFileNode(offset, sharedIndex)
  if (includeSharedPackage) {
    offset += sharedIndex.length
  }
  const header = Buffer.from(JSON.stringify({
    files: {
      "package.json": packageNode,
      "dist-electron": {
        files: {
          electron: {
            files: {
              "main.js": mainNode,
              generated: {
                files: {
                  ...(includeDeploymentConfig
                    ? {
                        "deployment-config.generated.js": deploymentConfigNode,
                      }
                    : {}),
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
                  ...(includeUsageAnalysisWorkers
                    ? {
                        "model-price": {
                          files: createModelPriceFiles(includeUnpackedSourceMaps),
                        },
                        "usage-analysis": {
                          files: createUsageAnalysisFiles(includeUnpackedSourceMaps),
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
                files: createUnpackedJsFiles(includeUnpackedSourceMaps),
              },
            },
          },
        },
      },
      "node_modules": {
        files: {
          "@synapse": {
            files: {
              shared: {
                files: {
                  dist: {
                    files: {
                      ...(includeSharedPackage
                        ? {
                            "index.js": sharedIndexNode,
                          }
                        : {}),
                    },
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
    ...(includeClaudeRuntimeGuard ? [diagnosticsService] : []),
    ...(includeClaudeRuntimeGuard ? [claudeRuntimeBinary] : []),
    ...(includeClaudeRuntimeGuard ? [claudeSdkSession] : []),
    ...(includeDeploymentConfig ? [deploymentConfig] : []),
    ...(includeSharedPackage ? [sharedIndex] : []),
  ])
}

describe("packaged asar verification", () => {
  async function writeUnpackedFixture(
    resourcesPath: string,
    segments: readonly string[],
    content = "x",
    options: { readonly sourceMap?: boolean } = {},
  ) {
    const filePath = path.join(resourcesPath, ...segments)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
    if (options.sourceMap !== false && segments[0] === "app.asar.unpacked" && segments.includes("dist-electron") && path.basename(filePath).endsWith(".js")) {
      await writeFile(`${filePath}.map`, "{}")
    }
    return filePath
  }

  async function writeExtraResourceFixtures(resourcesPath: string) {
    await writeUnpackedFixture(resourcesPath, ["templates", "skills", "synapse-skill", "meta.json"], "{}")
    await writeUnpackedFixture(resourcesPath, ["knowledge-base", "synapse-knowledge-base-template", "CLAUDE.md"], "# Knowledge Base\n")
    await writeUnpackedFixture(resourcesPath, ["database", "mcp", "index.js"], "module.exports = {}\n")
  }

  it("verifies a Windows-style resources directory with unpacked files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])

      expect(result.stdout).toContain("Verified resources")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing required extraResources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("missing extra resource"),
      })
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

  it("rejects packages missing the shared workspace runtime package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeSharedPackage: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("node_modules/@synapse/shared/dist/index.js"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects unpacked Electron JavaScript without sibling source maps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({
        includeUsageAnalysisWorkers: true,
        includeUnpackedSourceMaps: false,
      }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments, "module.exports = {}\n", { sourceMap: false })
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "conversation-worker.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-conversation-service.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-service.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "refresh-worker.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "db-schema.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "model-price", "index.js"],
        "module.exports = {}\n",
        { sourceMap: false },
      )

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("missing unpacked source map"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects unpacked usage analysis workers with dependencies outside their unpacked closure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeUsageAnalysisWorkers: true }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "conversation-worker.js"],
        "require('./cc-conversation-service')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-conversation-service.js"],
        "require('../error-sanitize')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "refresh-worker.js"],
        "require('./db-schema')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "db-schema.js"],
        "module.exports = {}\n",
      )

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("usage analysis worker dependency escapes unpacked closure"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("accepts unpacked usage analysis workers with model price directory dependencies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeUsageAnalysisWorkers: true }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeUnpackedFixture(resourcesPath, currentClaudeBinarySegments())
      await writeExtraResourceFixtures(resourcesPath)
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "conversation-worker.js"],
        "module.exports = {}\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-conversation-service.js"],
        "module.exports = {}\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "refresh-worker.js"],
        "require('./cc-service')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "cc-service.js"],
        "require('../model-price')\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "usage-analysis", "db-schema.js"],
        "module.exports = {}\n",
      )
      await writeUnpackedFixture(
        resourcesPath,
        ["app.asar.unpacked", "dist-electron", "electron", "services", "model-price", "index.js"],
        "module.exports = {}\n",
      )

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/checks/verify-packaged-asar.mjs"),
        root,
      ])

      expect(result.stdout).toContain("Verified resources")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
