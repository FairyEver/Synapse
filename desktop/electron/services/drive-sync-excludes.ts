import type { DriveSyncExcludeRulesDto } from "@synapse/shared" with { "resolution-mode": "import" }

export const DRIVE_SYNC_FORCED_EXCLUDES = [".git/**", ".git", ".synapse-sync/**", "*.synapse-sync-tmp"] as const
export const DRIVE_SYNC_DEFAULT_EXCLUDES = [
  "node_modules/**",
  "vendor/**",
  "dist/**",
  "build/**",
  "coverage/**",
  ".cache/**",
  ".tmp/**",
  ".DS_Store",
  "*.log",
] as const

export function createDefaultDriveSyncExcludeRules(): DriveSyncExcludeRulesDto {
  return {
    forced: [...DRIVE_SYNC_FORCED_EXCLUDES],
    defaults: [...DRIVE_SYNC_DEFAULT_EXCLUDES],
    importedGitignore: [],
    user: [],
  }
}

export function isDriveSyncExcluded(relativePath: string, rules: DriveSyncExcludeRulesDto): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (normalized === "") return false
  return [
    ...DRIVE_SYNC_FORCED_EXCLUDES,
    ...rules.forced,
    ...rules.defaults,
    ...rules.importedGitignore,
    ...rules.user,
  ].some((rule) => matchesRule(normalized, rule))
}

export function parseGitignoreForDriveSync(content: string): readonly string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
    .map((line) => line.endsWith("/") ? `${line}**` : line)
}

function matchesRule(relativePath: string, rawRule: string): boolean {
  const rule = normalizeRelativePath(rawRule.trim())
  if (!rule) return false
  if (rule.endsWith("/**")) {
    const directory = rule.slice(0, -3)
    return relativePath === directory || relativePath.startsWith(`${directory}/`)
  }
  if (rule.startsWith("*.")) {
    return basename(relativePath).endsWith(rule.slice(1))
  }
  if (rule.includes("*")) {
    return globToRegExp(rule).test(relativePath)
  }
  return relativePath === rule || basename(relativePath) === rule
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/u, "")
}

function basename(value: string): string {
  const segments = value.split("/")
  return segments[segments.length - 1] ?? value
}

function globToRegExp(rule: string): RegExp {
  const escaped = rule
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", ".*")
    .replaceAll("*", "[^/]*")
  return new RegExp(`^${escaped}$`, "u")
}
