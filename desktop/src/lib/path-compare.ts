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

  const resolved = options.resolvePath ? options.resolvePath(trimmed) : trimmed
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

export { arePathsEqualForCompare, normalizePathForCompare }
export type { PathCompareOptions, RuntimePlatform }
