#!/usr/bin/env node

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

function usage() {
  console.error("Usage: node scripts/checks/verify-packaged-asar.mjs <release-dir-or-app-path>")
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

function verifyPackedTextIncludes(buffer, dataOffset, header, relativePath, expectedText, failures, message) {
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
    return
  }

  try {
    const text = readPackedFile(buffer, dataOffset, node).toString("utf8")
    if (!text.includes(expectedText)) {
      failures.push(`${message}: ${relativePath}`)
    }
  } catch (error) {
    failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
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

function shouldRequireUnpackedSourceMap(relativePath) {
  return relativePath.startsWith("dist-electron/") && relativePath.endsWith(".js")
}

function verifyUnpackedSourceMap(header, unpackedPath, relativePath, failures) {
  const sourceMapPath = `${relativePath}.map`
  const sourceMapNode = findNode(header, sourceMapPath)
  if (!sourceMapNode) {
    failures.push(`missing unpacked source map from app.asar header: ${sourceMapPath}`)
    return
  }
  if (!sourceMapNode.unpacked) {
    failures.push(`unpacked source map must be unpacked: ${sourceMapPath}`)
    return
  }
  if (!existsSync(path.join(unpackedPath, sourceMapPath))) {
    failures.push(`missing unpacked source map file: ${sourceMapPath}`)
  }
}

const usageAnalysisWorkerEntries = [
  "dist-electron/electron/services/usage-analysis/conversation-worker.js",
  "dist-electron/electron/services/usage-analysis/refresh-worker.js",
]
const requiredExtraResourceFiles = [
  {
    relativePath: "templates/skills/synapse-skill/meta.json",
    label: "built-in content templates",
  },
  {
    relativePath: "knowledge-base/synapse-knowledge-base-template/CLAUDE.md",
    label: "Knowledge Base runtime template",
  },
  {
    relativePath: "database/mcp/index.js",
    label: "Database MCP runtime",
  },
]
const usageAnalysisAllowedUnpackedPrefixes = [
  "dist-electron/electron/services/usage-analysis/",
  "dist-electron/electron/services/model-price/",
  "dist-electron/src/",
  "dist-electron/action-packages/shared/",
]

function isAllowedUsageAnalysisUnpackedDependency(relativePath) {
  return usageAnalysisAllowedUnpackedPrefixes.some((prefix) => relativePath.startsWith(prefix))
}

function resolveRelativeRequire(header, importerPath, request) {
  if (!request.startsWith(".")) {
    return null
  }

  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), request))
  if (path.posix.extname(normalized)) {
    return normalized
  }
  const filePath = `${normalized}.js`
  if (findNode(header, filePath)) {
    return filePath
  }
  const indexPath = `${normalized}/index.js`
  if (findNode(header, indexPath)) {
    return indexPath
  }
  return filePath
}

function readUnpackedText(header, unpackedPath, relativePath, failures) {
  const node = findNode(header, relativePath)
  if (!node) {
    failures.push(`usage analysis worker dependency is missing from app.asar header: ${relativePath}`)
    return null
  }
  if (!node.unpacked) {
    failures.push(`usage analysis worker dependency must be unpacked: ${relativePath}`)
    return null
  }

  const filePath = path.join(unpackedPath, relativePath)
  if (!existsSync(filePath)) {
    failures.push(`missing unpacked file: ${relativePath}`)
    return null
  }

  try {
    return readFileSync(filePath, "utf8")
  } catch (error) {
    failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function verifyUsageAnalysisWorkerClosure(header, unpackedPath, failures) {
  const visited = new Set()
  const queue = usageAnalysisWorkerEntries.filter((entry) => findNode(header, entry))

  for (const relativePath of queue) {
    if (visited.has(relativePath)) {
      continue
    }
    visited.add(relativePath)

    if (!isAllowedUsageAnalysisUnpackedDependency(relativePath)) {
      failures.push(`usage analysis worker dependency escapes unpacked closure: ${relativePath}`)
      continue
    }

    const source = readUnpackedText(header, unpackedPath, relativePath, failures)
    if (!source) {
      continue
    }

    for (const match of source.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const request = match[1]
      const dependencyPath = resolveRelativeRequire(header, relativePath, request)
      if (!dependencyPath) {
        continue
      }
      if (!isAllowedUsageAnalysisUnpackedDependency(dependencyPath)) {
        failures.push(`usage analysis worker dependency escapes unpacked closure: ${relativePath} -> ${request} (${dependencyPath})`)
        continue
      }
      queue.push(dependencyPath)
    }
  }
}

function nativeClaudePackageNames(platform, arch) {
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

function verifyClaudeRuntime(unpackedPath, failures) {
  const platform = process.env.SYNAPSE_PACKAGED_ASAR_PLATFORM || process.platform
  const arch = process.env.SYNAPSE_PACKAGED_ASAR_ARCH || process.arch
  const binaryName = platform === "win32" ? "claude.exe" : "claude"
  const expectedPackages = nativeClaudePackageNames(platform, arch)

  if (expectedPackages.length === 0) {
    failures.push(`Unsupported Claude SDK native binary platform: ${platform}-${arch}`)
    return
  }

  const expectedRelativePaths = expectedPackages.map((packageName) =>
    path.join("node_modules", packageName, binaryName)
  )
  if (expectedRelativePaths.some((relativePath) => existsSync(path.join(unpackedPath, relativePath)))) {
    return
  }

  failures.push(`Claude SDK native binary is missing: ${expectedRelativePaths.join(" or ")}`)
}

function verifyExtraResources(resourcesPath, failures) {
  for (const resource of requiredExtraResourceFiles) {
    const filePath = path.join(resourcesPath, resource.relativePath)
    if (!existsSync(filePath)) {
      failures.push(`missing extra resource (${resource.label}): ${resource.relativePath}`)
      continue
    }
    try {
      if (!statSync(filePath).isFile()) {
        failures.push(`extra resource is not a file (${resource.label}): ${resource.relativePath}`)
      }
    } catch (error) {
      failures.push(`${resource.relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
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
      if (shouldRequireUnpackedSourceMap(relativePath)) {
        verifyUnpackedSourceMap(header, unpackedPath, relativePath, failures)
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

  verifyPackedTextIncludes(
    buffer,
    dataOffset,
    header,
    "dist-electron/electron/generated/deployment-config.generated.js",
    "apiBaseUrl",
    failures,
    "desktop deployment config is missing from app.asar",
  )
  verifyPackedNode(
    header,
    "node_modules/@synapse/shared/dist/index.js",
    failures,
    "shared workspace package is missing from packed app.asar",
  )
  verifyPackedTextIncludes(
    buffer,
    dataOffset,
    header,
    "dist-electron/electron/services/agent-runtime/claude-runtime-binary.js",
    "inspectPackagedClaudeRuntime",
    failures,
    "packaged Claude runtime guard is missing from app.asar",
  )
  verifyPackedTextIncludes(
    buffer,
    dataOffset,
    header,
    "dist-electron/electron/services/agent-runtime/claude-sdk-session.js",
    "pathToClaudeCodeExecutable",
    failures,
    "packaged Claude runtime executable override is missing from app.asar",
  )
  verifyPackedTextIncludes(
    buffer,
    dataOffset,
    header,
    "dist-electron/electron/services/diagnostics-service.js",
    "app.claude-runtime",
    failures,
    "packaged Claude runtime diagnostics are missing from app.asar",
  )
  verifyUsageAnalysisWorkerClosure(header, unpackedPath, failures)
  verifyClaudeRuntime(unpackedPath, failures)
  verifyExtraResources(resourcesPath, failures)

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
