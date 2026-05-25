#!/usr/bin/env node

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

function usage() {
  console.error("Usage: node scripts/verify-packaged-asar.mjs <release-dir-or-app-path>")
}

function readAsarHeader(buffer) {
  if (buffer.length < 16) {
    throw new Error("app.asar is too small")
  }

  const headerSize = buffer.readUInt32LE(12)
  const headerStart = 16
  const headerEnd = headerStart + headerSize

  if (headerEnd > buffer.length) {
    throw new Error("app.asar header extends past file size")
  }

  return {
    dataOffset: 8 + buffer.readUInt32LE(4),
    header: JSON.parse(buffer.subarray(headerStart, headerEnd).toString("utf8")),
  }
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function walkAsarNode(node, relativePath, visitor) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      walkAsarNode(child, relativePath ? `${relativePath}/${name}` : name, visitor)
    }
    return
  }

  visitor(node, relativePath)
}

function findNode(header, relativePath) {
  let node = header
  for (const part of relativePath.split("/").filter(Boolean)) {
    node = node.files?.[part]
    if (!node) {
      return null
    }
  }
  return node
}

function readPackedFile(buffer, dataOffset, node) {
  const start = dataOffset + Number(node.offset)
  const end = start + Number(node.size)

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.length) {
    throw new Error(`packed entry points outside app.asar: offset=${node.offset} size=${node.size}`)
  }

  return buffer.subarray(start, end)
}

function verifyApp(appPath) {
  const resourcesPath = path.join(appPath, "Contents", "Resources")
  const asarPath = path.join(resourcesPath, "app.asar")
  const unpackedPath = path.join(resourcesPath, "app.asar.unpacked")

  if (!existsSync(asarPath)) {
    throw new Error(`Missing app.asar at ${asarPath}`)
  }

  const buffer = readFileSync(asarPath)
  const { dataOffset, header } = readAsarHeader(buffer)
  const failures = []
  let packedCount = 0
  let unpackedCount = 0

  walkAsarNode(header, "", (node, relativePath) => {
    if (node.unpacked) {
      unpackedCount += 1
      const filePath = path.join(unpackedPath, relativePath)
      if (!existsSync(filePath)) {
        failures.push(`missing unpacked file: ${relativePath}`)
      }
      return
    }

    if (node.offset === undefined || node.size === undefined) {
      return
    }

    packedCount += 1
    try {
      const bytes = readPackedFile(buffer, dataOffset, node)
      if (node.integrity?.hash) {
        const actualHash = hash(bytes)
        if (actualHash !== node.integrity.hash) {
          failures.push(`packed hash mismatch: ${relativePath}`)
        }
      }
    } catch (error) {
      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const packageNode = findNode(header, "package.json")
  if (!packageNode || packageNode.unpacked || packageNode.offset === undefined) {
    failures.push("package.json is missing from packed app.asar")
  } else {
    try {
      const packageJson = JSON.parse(readPackedFile(buffer, dataOffset, packageNode).toString("utf8"))
      if (!packageJson.main || !findNode(header, packageJson.main)) {
        failures.push(`package.json main is missing from app.asar: ${packageJson.main ?? "<empty>"}`)
      }
    } catch (error) {
      failures.push(`package.json is not readable JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (failures.length > 0) {
    throw new Error([
      `Invalid packaged asar: ${appPath}`,
      ...failures.slice(0, 20).map((failure) => `- ${failure}`),
      failures.length > 20 ? `- ... ${failures.length - 20} more` : "",
    ].filter(Boolean).join("\n"))
  }

  console.log(`Verified ${path.basename(appPath)}: ${packedCount} packed files, ${unpackedCount} unpacked files`)
}

function findApps(targetPath) {
  if (!existsSync(targetPath)) {
    return []
  }

  const stats = statSync(targetPath)
  if (stats.isDirectory() && targetPath.endsWith(".app")) {
    return [targetPath]
  }
  if (!stats.isDirectory()) {
    return []
  }

  const apps = []
  for (const entry of readdirSync(targetPath)) {
    const childPath = path.join(targetPath, entry)
    const childStats = statSync(childPath)
    if (childStats.isDirectory() && childPath.endsWith(".app")) {
      apps.push(childPath)
    } else if (childStats.isDirectory()) {
      apps.push(...findApps(childPath))
    }
  }
  return apps
}

const input = process.argv[2]
if (!input) {
  usage()
  process.exit(2)
}

const targetPath = path.resolve(process.cwd(), input)
const appPaths = findApps(targetPath)

if (appPaths.length === 0) {
  console.error(`No .app bundle found under ${targetPath}`)
  process.exit(1)
}

for (const appPath of appPaths) {
  verifyApp(appPath)
}
