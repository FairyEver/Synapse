import type { SynapseLegacyUpdateCompatibility } from "../../src/types/update"

type CreateCompatibilityOptions = {
  currentVersion: string
  latestVersion: string | null
  includePrerelease?: boolean
}

function comparePreRelease(left: string, right: string): number {
  const leftParts = left.split(".")
  const rightParts = right.split(".")
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? ""
    const rightPart = rightParts[index] ?? ""
    const leftNumber = Number.parseInt(leftPart, 10)
    const rightNumber = Number.parseInt(rightPart, 10)
    const leftIsNumber = Number.isFinite(leftNumber) && String(leftNumber) === leftPart
    const rightIsNumber = Number.isFinite(rightNumber) && String(rightNumber) === rightPart

    if (leftIsNumber && rightIsNumber) {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber
      }
      continue
    }

    if (leftPart < rightPart) {
      return -1
    }

    if (leftPart > rightPart) {
      return 1
    }
  }

  return 0
}

export function isLegacyUpdateNewer(latestVersion: string, currentVersion: string): boolean {
  if (!latestVersion || !currentVersion) {
    return false
  }

  if (currentVersion.startsWith("dev")) {
    return true
  }

  const latest = latestVersion.replace(/^v/, "")
  const current = currentVersion.replace(/^v/, "")
  const [latestBase, latestPre = ""] = latest.split("-", 2)
  const [currentBase, currentPre = ""] = current.split("-", 2)
  const latestParts = latestBase.split(".")
  const currentParts = currentBase.split(".")
  const length = Math.max(latestParts.length, currentParts.length)

  for (let index = 0; index < length; index += 1) {
    const latestValue = Number.parseInt(latestParts[index] ?? "0", 10) || 0
    const currentValue = Number.parseInt(currentParts[index] ?? "0", 10) || 0

    if (latestValue > currentValue) {
      return true
    }

    if (latestValue < currentValue) {
      return false
    }
  }

  if (currentPre && !latestPre) {
    return true
  }

  if (!currentPre && latestPre) {
    return false
  }

  if (latestPre && currentPre) {
    return comparePreRelease(latestPre, currentPre) > 0
  }

  return false
}

export function createLegacyUpdateCompatibility(
  options: CreateCompatibilityOptions,
): SynapseLegacyUpdateCompatibility {
  const currentVersion = options.currentVersion

  if (currentVersion === "dev" || currentVersion === "") {
    return {
      status: "skipped",
      currentVersion,
      latestVersion: options.latestVersion,
      commandHint: null,
      message: "开发版本不检查更新。",
    }
  }

  if (!options.latestVersion) {
    return {
      status: "unknown",
      currentVersion,
      latestVersion: null,
      commandHint: null,
      message: "尚未获取最新版本。",
    }
  }

  if (isLegacyUpdateNewer(options.latestVersion, currentVersion)) {
    return {
      status: "available",
      currentVersion,
      latestVersion: options.latestVersion,
      commandHint: options.includePrerelease ? "cc-connect update --pre" : "cc-connect update",
      message: `发现新版本 ${options.latestVersion}。`,
    }
  }

  return {
    status: "current",
    currentVersion,
    latestVersion: options.latestVersion,
    commandHint: null,
    message: "当前已经是最新版本。",
  }
}
