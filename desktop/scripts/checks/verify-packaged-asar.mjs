#!/usr/bin/env node

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { Worker } from "node:worker_threads"

const require = createRequire(import.meta.url)

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

function verifySandboxedPreloadBundle(buffer, dataOffset, header, failures) {
  const relativePath = "dist-electron/electron/preload.js"
  const node = findNode(header, relativePath)
  if (!node || node.unpacked || node.offset === undefined || node.size === undefined) {
    failures.push(`sandboxed preload bundle is missing from packed app.asar: ${relativePath}`)
    return
  }

  try {
    const source = readPackedFile(buffer, dataOffset, node).toString("utf8")
    if (/require\(["']\.{1,2}\//.test(source)) {
      failures.push(`sandboxed preload bundle contains a relative require: ${relativePath}`)
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
    return
  }
  verifyUnpackedEntity(node, unpackedPath, relativePath, failures)
}

function verifyUnpackedEntity(node, unpackedPath, relativePath, failures) {
  const filePath = path.join(unpackedPath, relativePath)
  if (!existsSync(filePath)) {
    failures.push(`missing unpacked file: ${relativePath}`)
    return
  }
  let stats
  try {
    stats = statSync(filePath)
  } catch (error) {
    failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (!stats.isFile()) {
    failures.push(`unpacked entry is not a file: ${relativePath}`)
    return
  }
  if (!node.integrity?.hash) {
    failures.push(`unpacked file integrity metadata is missing: ${relativePath}`)
    return
  }
  if (node.size !== stats.size) {
    failures.push(`unpacked file size mismatch: ${relativePath}`)
    return
  }
  const actualHash = hash(readFileSync(filePath))
  if (actualHash !== node.integrity.hash) {
    failures.push(`unpacked file integrity mismatch: ${relativePath}`)
  }
}

function shouldRequireUnpackedSourceMap(relativePath) {
  return relativePath.startsWith("dist-electron/") && relativePath.endsWith(".js")
}

function verifyUnpackedSourceMap(
  header,
  unpackedPath,
  relativePath,
  failures,
  requireIntegrity = false,
) {
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
    return
  }
  if (requireIntegrity) {
    verifyUnpackedEntity(sourceMapNode, unpackedPath, sourceMapPath, failures)
  }
}

const usageAnalysisWorkerEntries = [
  "dist-electron/electron/services/usage-analysis/conversation-worker.js",
  "dist-electron/electron/services/usage-analysis/refresh-worker.js",
]
const documentTextExtractionServiceEntry =
  "dist-electron/app-capabilities/document-text-extractor/main/service.js"
const documentTextExtractionWorkerLaunchEntry =
  "dist-electron/app-capabilities/document-text-extractor/main/worker-launch.js"
const documentTextExtractionWorkerEntry =
  "dist-electron/app-capabilities/document-text-extractor/main/worker.js"
const documentTextExtractionRuntimeEntries = [
  "node_modules/unpdf/package.json",
  "node_modules/unpdf/LICENSE",
  "node_modules/unpdf/dist/index.cjs",
  "node_modules/unpdf/dist/pdfjs.mjs",
  "node_modules/mammoth/package.json",
  "node_modules/mammoth/LICENSE",
  "node_modules/mammoth/lib/index.js",
  "node_modules/pizzip/package.json",
  "node_modules/pizzip/js/index.js",
  "node_modules/@xmldom/xmldom/package.json",
  "node_modules/jszip/package.json",
  "node_modules/pako/package.json",
  "node_modules/xmlbuilder/package.json",
]
const documentParserLicenses = [
  {
    packageName: "unpdf",
    identity: "MIT",
    requiredText: [
      "MIT License",
      "Permission is hereby granted, free of charge",
      'THE SOFTWARE IS PROVIDED "AS IS"',
    ],
  },
  {
    packageName: "mammoth",
    identity: "BSD-2-Clause",
    requiredText: [
      "Redistribution and use in source and binary forms",
      "1. Redistributions of source code must retain",
      "2. Redistributions in binary form must reproduce",
      'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"',
    ],
  },
]
const documentTextExtractionSmokeFixtures = [
  {
    format: "pdf",
    bytes: Buffer.from("JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0OSA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIDcyIDcyMCBUZCAocGFja2FnZWQgcGRmIHNtb2tlKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDM0MCAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjQxMAolJUVPRgo=", "base64"),
    expected: { text: "packaged pdf smoke", pages: 1 },
  },
  {
    format: "docx",
    bytes: Buffer.from("UEsDBAoAAAAIAJcG9lzMVIwQ4AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBFf8XyFsUTukAIJekCyhJYlA+w7Eli4Zc8bil/z6QtXaDC0r6PM7rd+hC82GMhl2Ivb1UrBUaTrItTL9+3z829XA/d9isjCbZG6uVca34AIDNj0KRSxsjKmErQlZ9lgqzNh54QVm17BybFirE2demQQ/eEo975KjYH/j5hC3qS4vFkXFi91Dl7Z3RlHfbR/qI0Z4Li5NFDs8t0wwYJVwmL8jfgnHvlHYqzKN50qS86sAs+U7Fgk9kFTqr/a67cmcbRGbzkl7ZckkEiHjh4dVGCdvHnfjjOPXwDUEsDBAoAAAAAAJcG9lwAAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAIAJcG9lw2V97cogAAABgBAAALAAAAX3JlbHMvLnJlbHONzzsOwjAMBuCrRN6pCwNCqGkXhNQVlQNEiZtGNA8l4XV7MjBQxMBo+/dnuekedmY3isl4x2Fd1cDISa+M0xzOw3G1g65tTjSLXBJpMiGxsuIShynnsEdMciIrUuUDuTIZfbQilzJqDEJehCbc1PUW46cBS5P1ikPs1RrY8Az0j+3H0Ug6eHm15PKPE1+JIouoKXO4+6hQvdtVYQHbBhcvti9QSwMECgAAAAAAlwb2XAAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACACXBvZcCoUB06kAAADnAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sRY49DsIwDEavEmWnKQwIVf3ZmBngACExbdXGjuJA29uTlIHlWfZnPbvuVjeLDwQeCRt5LEopAA3ZEftGPu7Xw0UKjhqtngmhkRuw7Np6qSyZtwOMIgmQq6WRQ4y+UorNAE5zQR4wZS8KTsfUhl4tFKwPZIA5+d2sTmV5Vk6PKLPySXbL1WeEjNh6bSbdgxXp3irY0QS1ykFm2LmvM5h4C2of/Dzq/2P7BVBLAQIUAAoAAAAIAJcG9lzMVIwQ4AAAAJwBAAATAAAAAAAAAAAAAAAAAAAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQACgAAAAAAlwb2XAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAQAAAAEQEAAF9yZWxzL1BLAQIUAAoAAAAIAJcG9lw2V97cogAAABgBAAALAAAAAAAAAAAAAAAAADUBAABfcmVscy8ucmVsc1BLAQIUAAoAAAAAAJcG9lwAAAAAAAAAAAAAAAAFAAAAAAAAAAAAEAAAAAACAAB3b3JkL1BLAQIUAAoAAAAIAJcG9lwKhQHTqQAAAOcAAAARAAAAAAAAAAAAAAAAACMCAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAABQAFACABAAD7AgAAAAA=", "base64"),
    expected: { text: "packaged docx smoke" },
  },
]
const requiredExtraResourceFiles = [
  {
    relativePath: "synapse-skill/SKILL.md",
    label: "Synapse Skill package",
  },
  {
    relativePath: "synapse-skill/database/index.md",
    label: "Synapse Skill package",
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

function readUnpackedText(
  header,
  unpackedPath,
  relativePath,
  failures,
  label = "usage analysis worker dependency",
) {
  const node = findNode(header, relativePath)
  if (!node) {
    failures.push(`${label} is missing from app.asar header: ${relativePath}`)
    return null
  }
  if (!node.unpacked) {
    failures.push(`${label} must be unpacked: ${relativePath}`)
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

function verifyDocumentTextExtractionWorker(header, unpackedPath, failures) {
  verifyUnpackedNode(
    header,
    unpackedPath,
    documentTextExtractionServiceEntry,
    failures,
    "document text extraction service is missing from app.asar",
  )
  verifyUnpackedSourceMap(
    header,
    unpackedPath,
    documentTextExtractionServiceEntry,
    failures,
    true,
  )
  verifyUnpackedNode(
    header,
    unpackedPath,
    documentTextExtractionWorkerLaunchEntry,
    failures,
    "document text extraction worker launch contract is missing from app.asar",
  )
  verifyUnpackedSourceMap(
    header,
    unpackedPath,
    documentTextExtractionWorkerLaunchEntry,
    failures,
    true,
  )
  verifyUnpackedNode(
    header,
    unpackedPath,
    documentTextExtractionWorkerEntry,
    failures,
    "document text extraction worker is missing from app.asar",
  )
  verifyUnpackedSourceMap(
    header,
    unpackedPath,
    documentTextExtractionWorkerEntry,
    failures,
    true,
  )
  for (const relativePath of documentTextExtractionRuntimeEntries) {
    verifyUnpackedNode(
      header,
      unpackedPath,
      relativePath,
      failures,
      "document text extraction runtime dependency is missing from app.asar",
    )
  }

  const serviceSource = readUnpackedText(
    header,
    unpackedPath,
    documentTextExtractionServiceEntry,
    failures,
    "document text extraction service",
  )
  if (
    serviceSource
    && (!serviceSource.includes("worker-launch") || !serviceSource.includes("launchDocumentTextExtractionWorker"))
  ) {
    failures.push("document text extraction service bypasses the worker launch contract")
  }
  const workerSource = readUnpackedText(
    header,
    unpackedPath,
    documentTextExtractionWorkerEntry,
    failures,
    "document text extraction worker",
  )
  for (const parser of ["unpdf", "mammoth", "pizzip"]) {
    if (workerSource && !workerSource.includes(parser)) {
      failures.push(`document text extraction worker does not reference ${parser}`)
    }
  }
  for (const license of documentParserLicenses) {
    verifyDocumentParserLicense(unpackedPath, license, failures)
  }
}

function verifyDocumentParserLicense(unpackedPath, license, failures) {
  const { packageName, identity, requiredText } = license
  const packagePath = path.join(unpackedPath, "node_modules", packageName, "package.json")
  const licensePath = path.join(unpackedPath, "node_modules", packageName, "LICENSE")
  if (!existsSync(packagePath) || !existsSync(licensePath)) return
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
    if (packageJson.license !== identity) {
      failures.push(`document parser license identity mismatch: ${packageName} must be ${identity}`)
    }
  } catch (error) {
    failures.push(`document parser package metadata is invalid: ${packageName}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const licenseText = readFileSync(licensePath, "utf8")
  if (licenseText.length === 0) {
    failures.push(`document parser license is empty: ${packageName}`)
    return
  }
  if (requiredText.some((expectedText) => !licenseText.includes(expectedText))) {
    failures.push(`document parser license content mismatch: ${packageName} (${identity})`)
  }
}

async function runDocumentTextExtractionWorkerSmoke(unpackedPath, failures) {
  const workerPath = path.join(unpackedPath, documentTextExtractionWorkerEntry)
  const workerLaunchPath = path.join(unpackedPath, documentTextExtractionWorkerLaunchEntry)
  const failureCount = failures.length
  let launchDocumentTextExtractionWorker
  try {
    ({ launchDocumentTextExtractionWorker } = require(workerLaunchPath))
  } catch {
    failures.push("document text extraction worker launch contract cannot be loaded")
    return
  }
  if (typeof launchDocumentTextExtractionWorker !== "function") {
    failures.push("document text extraction worker launch contract is invalid")
    return
  }
  for (const fixture of documentTextExtractionSmokeFixtures) {
    let message
    let launch
    try {
      const worker = launchDocumentTextExtractionWorker({
        baseDir: path.dirname(workerLaunchPath),
        bytes: fixture.bytes,
        format: fixture.format,
        maxPages: 2_000,
        maxTextBytes: 5 * 1024 * 1024,
        maxOldGenerationSizeMb: 512,
        workerFactory(filename, options) {
          launch = { filename, options }
          return new Worker(filename, options)
        },
      })
      assertDocumentTextExtractionWorkerLaunch(launch, workerPath)
      message = await waitForDocumentTextExtractionWorker(worker)
    } catch {
      failures.push(`document text extraction worker smoke failed (${fixture.format}): worker launch or execution error`)
      continue
    }
    if (
      message?.type !== "success"
      || message.result?.text !== fixture.expected.text
      || ("pages" in fixture.expected && message.result?.pages !== fixture.expected.pages)
    ) {
      failures.push(`document text extraction worker smoke failed (${fixture.format}): unexpected result`)
    }
  }
  if (failures.length === failureCount) {
    console.log("Verified packaged document text extraction worker smoke: PDF text/pages, DOCX text")
  }
}

function assertDocumentTextExtractionWorkerLaunch(launch, expectedWorkerPath) {
  if (!launch || launch.filename !== expectedWorkerPath) {
    throw new Error("unexpected worker path")
  }
  const { options } = launch
  const workerDataKeys = Object.keys(options.workerData ?? {}).sort()
  if (workerDataKeys.join(",") !== "bytes,format,maxPages,maxTextBytes") {
    throw new Error("unexpected workerData fields")
  }
  if (!(options.workerData.bytes instanceof ArrayBuffer)) {
    throw new Error("workerData bytes must be an ArrayBuffer")
  }
  if (
    options.transferList?.length !== 1
    || options.transferList[0] !== options.workerData.bytes
  ) {
    throw new Error("workerData bytes must use transferList")
  }
  if (
    options.workerData.maxPages !== 2_000
    || options.workerData.maxTextBytes !== 5 * 1024 * 1024
    || options.resourceLimits?.maxOldGenerationSizeMb !== 512
  ) {
    throw new Error("unexpected worker extraction limits")
  }
}

function waitForDocumentTextExtractionWorker(worker) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(new Error("worker timeout"))
    }, 10_000)
    worker.once("message", (message) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      void worker.terminate().then(() => resolve(message), reject)
    })
    worker.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    worker.once("exit", (code) => {
      if (settled || code === 0) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`worker exited with code ${code}`))
    })
  })
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

async function verifyResources(resourcesPath, label) {
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
  verifySandboxedPreloadBundle(buffer, dataOffset, header, failures)
  verifyDocumentTextExtractionWorker(header, unpackedPath, failures)
  if (failures.length === 0) {
    await runDocumentTextExtractionWorkerSmoke(unpackedPath, failures)
  }
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
  await verifyResources(resourcesPath, label)
}
