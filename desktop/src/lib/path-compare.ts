type RuntimePlatform = "darwin" | "linux" | "win32" | string

type PathCompareOptions = {
  platform?: RuntimePlatform
  resolvePath?: (value: string) => string
}

function normalizePathForCompare(
  value: string,
  options: PathCompareOptions = {},
): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  const resolved = options.resolvePath ? options.resolvePath(trimmed) : normalizeDotSegments(trimmed, options.platform)
  const normalized = resolved.replace(/[\\/]+$/u, "")

  return options.platform === "win32"
    ? normalized.replace(/\//gu, "\\").toLowerCase()
    : normalized
}

function arePathsEqualForCompare(
  left: string,
  right: string,
  options: PathCompareOptions = {},
): boolean {
  return normalizePathForCompare(left, options) === normalizePathForCompare(right, options)
}

function isPathInsideDirectory(
  parentPath: string,
  childPath: string,
  options: PathCompareOptions = {},
): boolean {
  const parent = normalizePathForCompare(parentPath, options)
  const child = normalizePathForCompare(childPath, options)
  if (!parent || !child) return parent === child
  if (parent === child) return true
  const separator = options.platform === "win32" ? "\\" : "/"
  const parentPrefix = parent.endsWith(separator) ? parent : `${parent}${separator}`
  return child.startsWith(parentPrefix)
}

function normalizeDotSegments(value: string, platform?: RuntimePlatform): string {
  const windows = platform === "win32"
  const separator = windows ? "\\" : "/"
  const normalizedSeparators = windows ? value.replace(/\//gu, "\\") : value
  const { prefix, rest } = splitPathPrefix(normalizedSeparators, windows)
  const parts = rest.split(windows ? /\\+/u : /\/+/u).filter(Boolean)
  const normalizedParts: string[] = []

  for (const part of parts) {
    if (part === ".") continue
    if (part === "..") {
      const previous = normalizedParts.at(-1)
      if (previous && previous !== "..") {
        normalizedParts.pop()
        continue
      }
      if (!prefix) normalizedParts.push(part)
      continue
    }
    normalizedParts.push(part)
  }

  const suffix = normalizedParts.join(separator)
  if (!prefix) return suffix
  if (!suffix) return prefix
  if (prefix.endsWith(separator)) return `${prefix}${suffix}`
  return `${prefix}${separator}${suffix}`
}

function splitPathPrefix(value: string, windows: boolean): { prefix: string; rest: string } {
  if (!windows) {
    const rootMatch = value.match(/^\/+/u)
    if (!rootMatch) return { prefix: "", rest: value }
    return { prefix: "/", rest: value.slice(rootMatch[0].length) }
  }

  const uncMatch = value.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\+|$)/u)
  if (uncMatch) {
    const prefix = `\\\\${uncMatch[1]}\\${uncMatch[2]}\\`
    return { prefix, rest: value.slice(uncMatch[0].length) }
  }

  const driveMatch = value.match(/^[A-Za-z]:(?:\\+)?/u)
  if (driveMatch) {
    return { prefix: driveMatch[0].replace(/\\+$/u, "\\"), rest: value.slice(driveMatch[0].length) }
  }

  const rootMatch = value.match(/^\\+/u)
  if (rootMatch) return { prefix: "\\", rest: value.slice(rootMatch[0].length) }
  return { prefix: "", rest: value }
}

export { arePathsEqualForCompare, isPathInsideDirectory, normalizePathForCompare }
export type { PathCompareOptions, RuntimePlatform }
