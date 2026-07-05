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

interface ParsedDriveSyncExcludeRule {
  readonly pattern: string
  readonly negated: boolean
  readonly rootAnchored: boolean
}

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
  if ([
    ...DRIVE_SYNC_FORCED_EXCLUDES,
    ...rules.forced,
  ].some((rule) => matchesRule(normalized, rule))) {
    return true
  }

  let excluded = false
  for (const rawRule of [
    ...rules.defaults,
    ...rules.importedGitignore,
    ...rules.user,
  ]) {
    const rule = parseDriveSyncExcludeRule(rawRule)
    if (!rule || !matchesParsedRule(normalized, rule)) continue
    excluded = !rule.negated
  }
  return excluded
}

export function hasDriveSyncIncludedDescendant(relativePath: string, rules: DriveSyncExcludeRulesDto): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (normalized === "") return false
  if ([
    ...DRIVE_SYNC_FORCED_EXCLUDES,
    ...rules.forced,
  ].some((rule) => matchesRule(normalized, rule))) {
    return false
  }
  return [
    ...rules.defaults,
    ...rules.importedGitignore,
    ...rules.user,
  ].some((rawRule) => {
    const rule = parseDriveSyncExcludeRule(rawRule)
    return rule?.negated === true && couldMatchDescendant(normalized, rule)
  })
}

export function parseGitignoreForDriveSync(content: string): readonly string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "!")
    .map((line) => line.endsWith("/") ? `${line}**` : line)
}

function matchesRule(relativePath: string, rawRule: string): boolean {
  const rule = parseDriveSyncExcludeRule(rawRule)
  return rule?.negated === false && matchesParsedRule(relativePath, rule)
}

function matchesParsedRule(relativePath: string, rule: ParsedDriveSyncExcludeRule): boolean {
  if (rule.pattern.endsWith("/**")) {
    const directory = rule.pattern.slice(0, -3)
    return rule.rootAnchored
      ? matchesRootDirectoryRule(relativePath, directory)
      : matchesDirectoryRule(relativePath, directory)
  }
  if (rule.pattern.startsWith("*.")) {
    return basename(relativePath).endsWith(rule.pattern.slice(1))
  }
  if (rule.pattern.includes("*")) {
    return globToRegExp(rule.pattern).test(relativePath)
  }
  if (rule.rootAnchored) return relativePath === rule.pattern
  return relativePath === rule.pattern || basename(relativePath) === rule.pattern
}

function parseDriveSyncExcludeRule(rawRule: string): ParsedDriveSyncExcludeRule | null {
  let raw = rawRule.trim().replaceAll("\\", "/")
  if (!raw) return null
  const negated = raw.startsWith("!")
  if (negated) raw = raw.slice(1)
  if (!raw) return null
  const rootAnchored = raw.startsWith("/")
  if (/^\/+$/u.test(raw)) return null
  const normalizedRaw = raw.endsWith("/") ? `${raw.replace(/\/+$/u, "")}/**` : raw
  const pattern = normalizeRelativePath(normalizedRaw)
  if (!pattern) return null
  return { pattern, negated, rootAnchored }
}

function couldMatchDescendant(directory: string, rule: ParsedDriveSyncExcludeRule): boolean {
  if (matchesParsedRule(directory, rule)) return true
  if (rule.pattern.includes("*")) return true
  if (!rule.rootAnchored && !rule.pattern.includes("/")) return true
  return rule.pattern.startsWith(`${directory}/`)
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
