import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function createAsarBuffer(): Buffer {
  const packageJson = Buffer.from(JSON.stringify({ main: "dist-electron/electron/main.js" }), "utf8")
  const mainJs = Buffer.from("require('./bootstrap/descriptors.js')\n", "utf8")
  const header = Buffer.from(JSON.stringify({
    files: {
      "package.json": {
        size: packageJson.length,
        offset: "0",
        integrity: { hash: hash(packageJson) },
      },
      "dist-electron": {
        files: {
          electron: {
            files: {
              "main.js": {
                size: mainJs.length,
                offset: String(packageJson.length),
                integrity: { hash: hash(mainJs) },
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
  return Buffer.concat([prefix, header, packageJson, mainJs])
}

describe("packaged asar verification", () => {
  it("verifies a Windows-style resources directory with unpacked files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-packaged-asar-"))
    try {
      const resourcesPath = path.join(root, "resources")
      const unpackedFile = path.join(
        resourcesPath,
        "app.asar.unpacked",
        "dist-electron",
        "src",
        "lib",
        "agent-redaction.js",
      )
      await mkdir(path.dirname(unpackedFile), { recursive: true })
      await writeFile(path.join(resourcesPath, "app.asar"), createAsarBuffer())
      await writeFile(unpackedFile, "x")

      const result = await execFileAsync(process.execPath, [
        path.join(process.cwd(), "scripts/verify-packaged-asar.mjs"),
        root,
      ])

      expect(result.stdout).toContain("Verified resources")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
