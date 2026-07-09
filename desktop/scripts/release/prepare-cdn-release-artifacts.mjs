#!/usr/bin/env node
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parse, stringify } from "yaml"

const PLATFORM_CONFIGS = {
  all: {
    assetFilter: isReleaseAsset,
    metadata: [
      { source: "latest.yml", targets: ["latest.yml", "latest-windows.yml"] },
      { source: "latest-mac.yml", targets: ["latest-mac.yml"] },
    ],
  },
  mac: {
    assetFilter: isMacReleaseAsset,
    metadata: [
      { source: "latest-mac.yml", targets: ["latest-mac.yml"] },
    ],
  },
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return process.argv[index + 1]
}

function normalizeCdnBaseUrl(value) {
  if (!value.startsWith("https://")) {
    throw new Error("--cdn-base-url must start with https://")
  }
  return value.endsWith("/") ? value : `${value}/`
}

function ensureVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error("--version must look like 0.2.214")
  }
  return value
}

function ensurePlatform(value = "all") {
  if (!Object.hasOwn(PLATFORM_CONFIGS, value)) {
    throw new Error("--platform must be all or mac")
  }
  return value
}

function metadataFilesForConfig(config) {
  return new Set(config.metadata.flatMap((metadata) => [metadata.source, ...metadata.targets]))
}

function isReleaseAsset(fileName) {
  return /\.(dmg|zip|exe|blockmap)$/.test(fileName)
}

function isMacReleaseAsset(fileName) {
  return /-mac-[^.]+\.(dmg|zip)$/.test(fileName) || /-mac-[^.]+\.(dmg|zip)\.blockmap$/.test(fileName)
}

function isVersionedReleaseAsset(fileName, version) {
  return fileName.startsWith(`Synapse-${version}-`)
}

function basenameFromMetadataPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null
  }
  return path.posix.basename(value)
}

function versionedPath(versionPrefix, fileName) {
  return `${versionPrefix}/${fileName}`
}

function rewriteMetadataValue(value, versionPrefix, artifactNames) {
  const fileName = basenameFromMetadataPath(value)
  if (!fileName) {
    return value
  }
  if (!artifactNames.has(fileName)) {
    throw new Error(`Metadata references missing artifact: ${fileName}`)
  }
  return versionedPath(versionPrefix, fileName)
}

function rewriteMetadata(metadata, versionPrefix, artifactNames) {
  const next = structuredClone(metadata)
  if (typeof next.path === "string") {
    next.path = rewriteMetadataValue(next.path, versionPrefix, artifactNames)
  }
  if (Array.isArray(next.files)) {
    next.files = next.files.map((file) => {
      if (!file || typeof file !== "object") {
        return file
      }
      const copy = { ...file }
      if (typeof copy.url === "string") {
        copy.url = rewriteMetadataValue(copy.url, versionPrefix, artifactNames)
      }
      return copy
    })
  }
  return next
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
}

async function copyReleaseAssets(artifactsDir, versionDir, artifactFiles) {
  await mkdir(versionDir, { recursive: true })
  for (const fileName of artifactFiles) {
    await copyFile(path.join(artifactsDir, fileName), path.join(versionDir, fileName))
  }
}

function releaseBody(version, cdnBaseUrl, artifactFiles, metadataTargets) {
  const versionPrefix = `v${version}`
  const dmg = artifactFiles.find((fileName) => fileName.endsWith("-mac-arm64.dmg"))
  const zip = artifactFiles.find((fileName) => fileName.endsWith("-mac-arm64.zip"))
  const exe = artifactFiles.find((fileName) => fileName.endsWith("-win-x64.exe"))
  const lines = [`# Synapse v${version}`, ""]

  if (dmg) {
    lines.push("macOS Apple Silicon DMG:", `${cdnBaseUrl}${versionPrefix}/${dmg}`, "")
  }
  if (zip) {
    lines.push("macOS Apple Silicon ZIP:", `${cdnBaseUrl}${versionPrefix}/${zip}`, "")
  }
  if (exe) {
    lines.push("Windows x64:", `${cdnBaseUrl}${versionPrefix}/${exe}`, "")
  }

  lines.push("更新元数据：", ...metadataTargets.map((fileName) => `${cdnBaseUrl}${fileName}`), "")
  return `${lines.join("\n")}\n`
}

export async function prepareReleaseArtifacts({ artifactsDir, outDir, version, cdnBaseUrl, platform = "all" }) {
  const normalizedVersion = ensureVersion(version)
  const normalizedCdnBaseUrl = normalizeCdnBaseUrl(cdnBaseUrl)
  const normalizedPlatform = ensurePlatform(platform)
  const platformConfig = PLATFORM_CONFIGS[normalizedPlatform]
  const versionPrefix = `v${normalizedVersion}`
  const files = await listFiles(artifactsDir)
  const metadataFiles = metadataFilesForConfig(platformConfig)
  const artifactFiles = files.filter((fileName) => {
    return !metadataFiles.has(fileName)
      && isVersionedReleaseAsset(fileName, normalizedVersion)
      && platformConfig.assetFilter(fileName)
  })
  const artifactNames = new Set(artifactFiles)
  const rewrittenMetadata = []

  for (const metadataFile of platformConfig.metadata) {
    const raw = await readFile(path.join(artifactsDir, metadataFile.source), "utf8")
    const metadata = parse(raw)
    const content = rewriteMetadata(metadata, versionPrefix, artifactNames)
    for (const target of metadataFile.targets) {
      rewrittenMetadata.push({
        fileName: target,
        content,
      })
    }
  }

  if (artifactFiles.length === 0) {
    throw new Error("No release assets found")
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  await copyReleaseAssets(artifactsDir, path.join(outDir, versionPrefix), artifactFiles)

  for (const metadata of rewrittenMetadata) {
    await writeFile(path.join(outDir, metadata.fileName), stringify(metadata.content), "utf8")
  }

  const assetUrls = artifactFiles.map((fileName) => `${normalizedCdnBaseUrl}${versionPrefix}/${fileName}`)
  const metadataTargets = rewrittenMetadata.map((metadata) => metadata.fileName)
  const metadataUrls = metadataTargets.map((fileName) => `${normalizedCdnBaseUrl}${fileName}`)
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify({
    version: normalizedVersion,
    versionPrefix,
    platform: normalizedPlatform,
    cdnBaseUrl: normalizedCdnBaseUrl,
    artifactFiles,
    assetUrls,
    metadataUrls,
  }, null, 2)}\n`, "utf8")
  await writeFile(path.join(outDir, "release-body.md"), releaseBody(normalizedVersion, normalizedCdnBaseUrl, artifactFiles, metadataTargets), "utf8")
}

async function main() {
  await prepareReleaseArtifacts({
    artifactsDir: path.resolve(readArg("--artifacts-dir")),
    outDir: path.resolve(readArg("--out-dir")),
    version: readArg("--version"),
    cdnBaseUrl: readArg("--cdn-base-url"),
    platform: process.argv.includes("--platform") ? readArg("--platform") : "all",
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
