import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const redactionUnpackedSegments = ["app.asar.unpacked", "dist-electron", "src", "lib", "agent-redaction.js"]
const fileConversionBootstrapSegments = [
  "app.asar.unpacked",
  "dist-electron",
  "electron",
  "worker-bootstraps",
  "file-conversion-worker-bootstrap.js",
]
const fileConversionBootstrapMapSegments = [
  "app.asar.unpacked",
  "dist-electron",
  "electron",
  "worker-bootstraps",
  "file-conversion-worker-bootstrap.js.map",
]

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

interface CreateAsarBufferOptions {
  readonly includeFileConversionWorker?: boolean
  readonly includeFileConversionService?: boolean
  readonly unpackFileConversionWorker?: boolean
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
    includeFileConversionWorker = true,
    includeFileConversionService = true,
    unpackFileConversionWorker = false,
  } = options
  const packageJson = Buffer.from(JSON.stringify({ main: "dist-electron/electron/main.js" }), "utf8")
  const mainJs = Buffer.from("require('./bootstrap/descriptors.js')\n", "utf8")
  const fileConversionWorker = Buffer.from("require('../services/file-conversion')\n", "utf8")
  const fileConversionWorkerMap = Buffer.from("{}\n", "utf8")
  const fileConversionService = Buffer.from("module.exports = {}\n", "utf8")
  let offset = 0
  const packageNode = createPackedFileNode(offset, packageJson)
  offset += packageJson.length
  const mainNode = createPackedFileNode(offset, mainJs)
  offset += mainJs.length
  const workerNode = createPackedFileNode(offset, fileConversionWorker, unpackFileConversionWorker)
  if (includeFileConversionWorker && !unpackFileConversionWorker) {
    offset += fileConversionWorker.length
  }
  const workerMapNode = createPackedFileNode(offset, fileConversionWorkerMap, unpackFileConversionWorker)
  if (includeFileConversionWorker && !unpackFileConversionWorker) {
    offset += fileConversionWorkerMap.length
  }
  const serviceNode = createPackedFileNode(offset, fileConversionService)
  if (includeFileConversionService) {
    offset += fileConversionService.length
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
                  ...(includeFileConversionWorker
                    ? {
                        "file-conversion-worker.js": workerNode,
                        "file-conversion-worker.js.map": workerMapNode,
                      }
                    : {}),
                },
              },
              "worker-bootstraps": {
                files: {
                  "file-conversion-worker-bootstrap.js": {
                    size: 1,
                    offset: "0",
                    unpacked: true,
                  },
                  "file-conversion-worker-bootstrap.js.map": {
                    size: 1,
                    offset: "0",
                    unpacked: true,
                  },
                },
              },
              services: {
                files: {
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
    ...(includeFileConversionWorker && !unpackFileConversionWorker ? [fileConversionWorker] : []),
    ...(includeFileConversionWorker && !unpackFileConversionWorker ? [fileConversionWorkerMap] : []),
    ...(includeFileConversionService ? [fileConversionService] : []),
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
      await writeUnpackedFixture(resourcesPath, fileConversionBootstrapSegments)
      await writeUnpackedFixture(resourcesPath, fileConversionBootstrapMapSegments)

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/verify-packaged-asar.mjs"),
        root,
      ])

      expect(result.stdout).toContain("Verified resources")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the file conversion bootstrap worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("file-conversion-worker-bootstrap.js"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages that unpack the real file conversion worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      const fileConversionWorker = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "electron",
        "workers",
        "file-conversion-worker.js",
      )
      const fileConversionWorkerMap = `${fileConversionWorker}.map`
      const fileConversionBootstrap = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "electron",
        "worker-bootstraps",
        "file-conversion-worker-bootstrap.js",
      )
      await mkdir(path.dirname(fileConversionWorker), { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ unpackFileConversionWorker: true }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeFile(fileConversionWorker, "x")
      await writeFile(fileConversionWorkerMap, "x")
      await mkdir(path.dirname(fileConversionBootstrap), { recursive: true })
      await writeFile(fileConversionBootstrap, "x")
      await writeUnpackedFixture(resourcesPath, fileConversionBootstrapMapSegments)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("file-conversion-worker.js must stay packed"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects packages missing the packed file conversion service", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      const fileConversionBootstrap = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "electron",
        "worker-bootstraps",
        "file-conversion-worker-bootstrap.js",
      )
      await mkdir(path.dirname(fileConversionBootstrap), { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer({ includeFileConversionService: false }))
      await writeUnpackedFixture(resourcesPath, redactionUnpackedSegments)
      await writeFile(fileConversionBootstrap, "x")
      await writeUnpackedFixture(resourcesPath, fileConversionBootstrapMapSegments)

      await expect(execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/verify-packaged-asar.mjs"),
        root,
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("dist-electron/electron/services/file-conversion/index.js"),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
