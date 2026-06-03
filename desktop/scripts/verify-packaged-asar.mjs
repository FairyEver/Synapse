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

function verifyPackedNode(header, relativePath, failures, message) {
  const node = findNode(header, relativePath)
  if (!node) {
    failures.push(`${message}: ${relativePath}`)
    return
  }
  if (node.unpacked) {
    failures.push(`${relativePath} must stay packed`)
    return
  }
  if (node.offset === undefined || node.size === undefined) {
    failures.push(`${relativePath} is missing packed file data`)
  }
}

function verifyUnpackedNode(header, unpackedPath, relativePath, failures, message) {
  const node = findNode(header, relativePath)
  if (!node) {
    failures.push(`${message}: ${relativePath}`)
    return
  }
  if (!node.unpacked) {
    failures.push(`${relativePath} must be unpacked`)
    return
  }
  const filePath = path.join(unpackedPath, relativePath)
  if (!existsSync(filePath)) {
    failures.push(`missing unpacked file: ${relativePath}`)
  }
}

function verifyResources(resourcesPath, label) {
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

  verifyPackedNode(
    header,
    "dist-electron/electron/workers/file-conversion-worker.js",
    failures,
    "file conversion worker is missing from packed app.asar",
  )
  verifyPackedNode(
    header,
    "dist-electron/electron/workers/file-conversion-worker.js.map",
    failures,
    "file conversion worker sourcemap is missing from packed app.asar",
  )
  verifyPackedNode(
    header,
    "dist-electron/electron/services/file-conversion/index.js",
    failures,
    "file conversion service is missing from packed app.asar",
  )
  verifyUnpackedNode(
    header,
    unpackedPath,
    "dist-electron/electron/worker-bootstraps/file-conversion-worker-bootstrap.js",
    failures,
    "file conversion worker bootstrap is missing from app.asar.unpacked",
  )
  verifyUnpackedNode(
    header,
    unpackedPath,
    "dist-electron/electron/worker-bootstraps/file-conversion-worker-bootstrap.js.map",
    failures,
    "file conversion worker bootstrap sourcemap is missing from app.asar.unpacked",
  )

  if (failures.length > 0) {
    throw new Error([
      `Invalid packaged asar: ${resourcesPath}`,
      ...failures.slice(0, 20).map((failure) => `- ${failure}`),
      failures.length > 20 ? `- ... ${failures.length - 20} more` : "",
    ].filter(Boolean).join("\n"))
  }

  console.log(`Verified ${label}: ${packedCount} packed files, ${unpackedCount} unpacked files`)
}

function findResourceTargets(targetPath, targets = new Map()) {
  if (!existsSync(targetPath)) {
    return targets
  }

  const stats = statSync(targetPath)
  if (stats.isDirectory() && targetPath.endsWith(".app")) {
    const resourcesPath = path.join(targetPath, "Contents", "Resources")
    targets.set(resourcesPath, path.basename(targetPath))
    return targets
  }
  if (!stats.isDirectory()) {
    return targets
  }

  if (existsSync(path.join(targetPath, "app.asar"))) {
    targets.set(targetPath, path.basename(targetPath))
    return targets
  }

  for (const entry of readdirSync(targetPath)) {
    if (entry === "app.asar.unpacked") {
      continue
    }
    const childPath = path.join(targetPath, entry)
    const childStats = statSync(childPath)
    if (childStats.isDirectory()) {
      findResourceTargets(childPath, targets)
    }
  }
  return targets
}

const input = process.argv[2]
if (!input) {
  usage()
  process.exit(2)
}

const targetPath = path.resolve(process.cwd(), input)
const resourceTargets = findResourceTargets(targetPath)

if (resourceTargets.size === 0) {
  console.error(`No packaged app.asar found under ${targetPath}`)
  process.exit(1)
}

for (const [resourcesPath, label] of resourceTargets) {
  verifyResources(resourcesPath, label)
}
