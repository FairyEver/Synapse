import { readFileSync } from "node:fs"
import path from "node:path"
import type {
  SynapseInstallSourceMetadata,
  SynapseInstallVersionStatus,
} from "../../src/types/update"

type PackageJson = {
  name?: unknown
  version?: unknown
  bin?: unknown
  scripts?: unknown
}

export type InstallSourceOptions = {
  execPath: string
  appVersion: string
  isPackaged: boolean
  platform: NodeJS.Platform
  installedBinaryVersion?: string | null
}

type ParsedVersion = {
  nums: number[]
  preTag: string
  preNum: number
  hasPre: boolean
}

function createMetadata(
  patch: Partial<SynapseInstallSourceMetadata>,
): SynapseInstallSourceMetadata {
  return {
    source: "unknown",
    packageName: null,
    packageVersion: null,
    binaryPath: null,
    wrapperScriptPath: null,
    expectedBinaryName: null,
    versionStatus: "unknown",
    message: "安装来源未知。",
    ...patch,
  }
}

export function parseComparableVersion(version: string): ParsedVersion {
  const normalized = version.replace(/^v/, "").trim()
  const [base, ...rest] = normalized.split("-")
  const nums = base.split(".").map((part) => Number(part))
  const pre = rest.join("-")
  const match = pre.match(/^([a-zA-Z]+)\.?(\d+)?$/)

  return {
    nums,
    preTag: match ? match[1] ?? "" : pre,
    preNum: match?.[2] ? Number.parseInt(match[2], 10) : 0,
    hasPre: pre !== "",
  }
}

export function isVersionNewerOrEqual(installed: string, expected: string): boolean {
  const current = parseComparableVersion(installed)
  const target = parseComparableVersion(expected)
  const length = Math.max(current.nums.length, target.nums.length)

  for (let index = 0; index < length; index += 1) {
    const currentValue = current.nums[index] || 0
    const targetValue = target.nums[index] || 0

    if (currentValue > targetValue) {
      return true
    }

    if (currentValue < targetValue) {
      return false
    }
  }

  if (!current.hasPre && target.hasPre) {
    return true
  }

  if (current.hasPre && !target.hasPre) {
    return false
  }

  if (!current.hasPre && !target.hasPre) {
    return true
  }

  if (current.preTag !== target.preTag) {
    return current.preTag > target.preTag
  }

  return current.preNum >= target.preNum
}

function readPackageJson(packageJsonPath: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson
  } catch {
    return null
  }
}

function getStringRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function detectVersionStatus(
  expectedVersion: string | null,
  installedBinaryVersion?: string | null,
): SynapseInstallVersionStatus {
  if (!expectedVersion) {
    return "unknown"
  }

  if (!installedBinaryVersion) {
    return "unknown"
  }

  const normalizedInstalled = installedBinaryVersion.replace(/^v/, "")
  const normalizedExpected = expectedVersion.replace(/^v/, "")

  if (normalizedInstalled === normalizedExpected) {
    return "matching"
  }

  return isVersionNewerOrEqual(installedBinaryVersion, expectedVersion)
    ? "newer-or-equal"
    : "outdated"
}

function detectNpmWrapper(
  options: InstallSourceOptions,
): SynapseInstallSourceMetadata | null {
  const binaryName = options.platform === "win32" ? "cc-connect.exe" : "cc-connect"
  const binDir = path.dirname(options.execPath)

  if (path.basename(binDir) !== "bin") {
    return null
  }

  const packageDir = path.dirname(binDir)
  const packageJsonPath = path.join(packageDir, "package.json")
  const pkg = readPackageJson(packageJsonPath)
  const bin = getStringRecord(pkg?.bin)
  const scripts = getStringRecord(pkg?.scripts)

  if (
    pkg?.name !== "cc-connect"
    || pkg.version === undefined
    || bin?.["cc-connect"] !== "run.js"
    || scripts?.postinstall !== "node install.js"
  ) {
    return null
  }

  const packageVersion = String(pkg.version)

  return createMetadata({
    source: "npm-wrapper",
    packageName: "cc-connect",
    packageVersion,
    binaryPath: path.join(binDir, binaryName),
    wrapperScriptPath: path.join(packageDir, "run.js"),
    expectedBinaryName: binaryName,
    versionStatus: detectVersionStatus(packageVersion, options.installedBinaryVersion),
    message: "npm wrapper",
  })
}

export function createInstallSourceMetadata(
  options: InstallSourceOptions,
): SynapseInstallSourceMetadata {
  const npmWrapper = detectNpmWrapper(options)

  if (npmWrapper) {
    return npmWrapper
  }

  if (!options.isPackaged) {
    return createMetadata({
      source: "development",
      packageName: "@synapse/desktop",
      packageVersion: options.appVersion,
      binaryPath: options.execPath,
      expectedBinaryName: path.basename(options.execPath),
      message: "开发环境",
    })
  }

  return createMetadata({
    source: "packaged-app",
    packageName: "@synapse/desktop",
    packageVersion: options.appVersion,
    binaryPath: options.execPath,
    expectedBinaryName: path.basename(options.execPath),
    message: "桌面应用",
  })
}
