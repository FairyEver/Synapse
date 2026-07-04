import type { DriveSyncExcludeRulesDto } from "@synapse/shared" with { "resolution-mode": "import" }

export const DRIVE_SYNC_FORCED_EXCLUDES = [
  ".git/**",
  ".git",
  ".synapse-sync/**",
  ".synapse-sync-trash/**",
  ".synapse-sync-trash",
  "*.synapse-sync-tmp",
  "**/.synapse-drive-sync-*.tmp",
] as const
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
  const raw = rawRule.trim().replaceAll("\\", "/")
  const rootAnchored = raw.startsWith("/")
  const rule = normalizeRelativePath(raw)
  if (!rule) return false
  if (rule.endsWith("/**")) {
    const directory = rule.slice(0, -3)
    return rootAnchored
      ? matchesRootDirectoryRule(relativePath, directory)
      : matchesDirectoryRule(relativePath, directory)
  }
  if (rule.startsWith("*.")) {
    return basename(relativePath).endsWith(rule.slice(1))
  }
  if (rule.includes("*")) {
    return globToRegExp(rule).test(relativePath)
  }
  if (rootAnchored) return relativePath === rule
  return relativePath === rule || basename(relativePath) === rule
}

function matchesRootDirectoryRule(relativePath: string, directory: string): boolean {
  return relativePath === directory || relativePath.startsWith(`${directory}/`)
}

function matchesDirectoryRule(relativePath: string, directory: string): boolean {
  return relativePath === directory
    || relativePath.startsWith(`${directory}/`)
    || relativePath.endsWith(`/${directory}`)
    || relativePath.includes(`/${directory}/`)
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/u, "")
}

function basename(value: string): string {
  const segments = value.split("/")
  return segments[segments.length - 1] ?? value
}

function globToRegExp(rule: string): RegExp {
  let source = ""
  for (let index = 0; index < rule.length; index += 1) {
    const char = rule[index]
    if (char === "*") {
      if (rule[index + 1] === "*") {
        if (rule[index + 2] === "/") {
          source += "(?:.*/)?"
          index += 2
        } else {
          source += ".*"
          index += 1
        }
      } else {
        source += "[^/]*"
      }
      continue
    }
    source += escapeRegExpChar(char)
  }
  return new RegExp(`^${source}$`, "u")
}

function escapeRegExpChar(char: string | undefined): string {
  if (!char) return ""
  return /[.+^${}()|[\]\\]/u.test(char) ? `\\${char}` : char
}
