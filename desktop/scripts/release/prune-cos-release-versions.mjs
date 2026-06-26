#!/usr/bin/env node
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

const DEFAULT_BUCKET_ALIAS = "release"
const DEFAULT_KEEP_COUNT = 3
const DEFAULT_METADATA_FILES = ["latest.yml", "latest-windows.yml", "latest-mac.yml"]

function hasArg(name) {
  return process.argv.includes(name)
}

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

function readPositiveIntegerArg(name, fallback) {
  const raw = readArg(name)
  if (raw === null) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function cosConfigArgs(cosConfig) {
  return cosConfig ? ["-c", cosConfig] : []
}

function cosRoot(bucketAlias) {
  return `cos://${bucketAlias}/`
}

function cosObject(bucketAlias, key) {
  return `${cosRoot(bucketAlias)}${key}`
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    })
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exited with ${String(code)}`))
    })
  })
}

function parseSemverVersion(value) {
  const match = /^v(\d+)\.(\d+)\.(\d+)\/?$/.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    name: `v${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareSemver(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

function parseCosRootVersions(output) {
  const versions = new Map()
  for (const line of output.split(/\r?\n/)) {
    const key = line.split("|")[0]?.trim()
    if (!key || key === "KEY" || key.startsWith("-") || key.startsWith("TOTAL ")) {
      continue
    }
    const version = parseSemverVersion(key)
    if (version) {
      versions.set(version.name, version)
    }
  }
  return [...versions.values()].sort(compareSemver)
}

function referencedVersionsFromMetadata(text) {
  const versions = new Set()
  const pattern = /(?:^|[^A-Za-z0-9_.-])(v\d+\.\d+\.\d+)\//g
  let match = pattern.exec(text)
  while (match) {
    versions.add(match[1])
    match = pattern.exec(text)
  }
  return versions
}

function releasePrunePlan({ versions, referencedVersions, keepCount }) {
  const newestVersions = versions.slice(-keepCount).map((version) => version.name)
  const existingVersions = new Set(versions.map((version) => version.name))
  const keepVersions = new Set(newestVersions)
  for (const version of referencedVersions) {
    if (existingVersions.has(version)) {
      keepVersions.add(version)
    }
  }
  const deleteVersions = versions.map((version) => version.name).filter((version) => !keepVersions.has(version))
  return {
    keepVersions: versions.map((version) => version.name).filter((version) => keepVersions.has(version)),
    deleteVersions,
  }
}

async function listReleaseVersions({ coscli, cosConfig, bucketAlias }) {
  const { stdout } = await run(coscli, ["ls", cosRoot(bucketAlias), "--limit", "-1", ...cosConfigArgs(cosConfig)])
  return parseCosRootVersions(stdout)
}

async function readReferencedVersions({ coscli, cosConfig, bucketAlias, metadataFiles }) {
  const referenced = new Set()
  for (const fileName of metadataFiles) {
    const { stdout } = await run(coscli, ["cat", cosObject(bucketAlias, fileName), ...cosConfigArgs(cosConfig)])
    for (const version of referencedVersionsFromMetadata(stdout)) {
      referenced.add(version)
    }
  }
  return referenced
}

async function deleteReleaseVersions({ coscli, cosConfig, bucketAlias, versions }) {
  for (const version of versions) {
    await run(coscli, ["rm", cosObject(bucketAlias, `${version}/`), "-r", "-f", ...cosConfigArgs(cosConfig)])
  }
}

export async function pruneCosReleaseVersions({
  coscli,
  cosConfig = null,
  bucketAlias = DEFAULT_BUCKET_ALIAS,
  keepCount = DEFAULT_KEEP_COUNT,
  dryRun = false,
  metadataFiles = DEFAULT_METADATA_FILES,
} = {}) {
  const coscliPath = coscli ?? process.env.COSCLI_PATH ?? "coscli"
  const versions = await listReleaseVersions({ coscli: coscliPath, cosConfig, bucketAlias })
  const referencedVersions = await readReferencedVersions({
    coscli: coscliPath,
    cosConfig,
    bucketAlias,
    metadataFiles,
  })
  const { keepVersions, deleteVersions } = releasePrunePlan({ versions, referencedVersions, keepCount })

  process.stdout.write(`Found COS release versions: ${versions.map((version) => version.name).join(", ") || "(none)"}\n`)
  process.stdout.write(`Keeping COS release versions: ${keepVersions.join(", ") || "(none)"}\n`)

  if (dryRun) {
    process.stdout.write(`Would delete COS release versions: ${deleteVersions.join(", ") || "(none)"}\n`)
    return { versions, keepVersions, deleteVersions }
  }

  await deleteReleaseVersions({ coscli: coscliPath, cosConfig, bucketAlias, versions: deleteVersions })
  process.stdout.write(`Deleted COS release versions: ${deleteVersions.join(", ") || "(none)"}\n`)
  return { versions, keepVersions, deleteVersions }
}

async function main() {
  await pruneCosReleaseVersions({
    coscli: readArg("--coscli") ?? process.env.COSCLI_PATH ?? "coscli",
    cosConfig: readArg("--cos-config"),
    bucketAlias: readArg("--bucket-alias", DEFAULT_BUCKET_ALIAS),
    keepCount: readPositiveIntegerArg("--keep", DEFAULT_KEEP_COUNT),
    dryRun: hasArg("--dry-run"),
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
