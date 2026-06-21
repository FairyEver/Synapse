import os from "node:os"
import path from "node:path"

import { redactSensitiveText } from "../../src/lib/agent-redaction"
import { normalizePathForCompare } from "../../src/lib/path-compare"
import { sanitizeUrl } from "../../src/lib/url-sanitize"

type WindowsCompatibilityPathSet = {
  appPath?: string
  cwd?: string
  userDataPath?: string
  tempPath?: string
  downloadsPath?: string
  logPath?: string
  dbPath?: string
}

type WindowsCompatibilitySnapshotInput = {
  platform?: NodeJS.Platform | string
  arch?: string
  release?: string
  env?: NodeJS.ProcessEnv
  paths?: WindowsCompatibilityPathSet
}

type WindowsCompatibilityEnvSnapshot = {
  pathKey?: string
  hasPath: boolean
  pathEntryCount: number
  pathEntriesSample: string[]
  hasPathext: boolean
  pathextEntries: string[]
  hasComSpec: boolean
  hasSystemRoot: boolean
  hasWindir: boolean
  hasUserProfile: boolean
  hasAppData: boolean
  hasLocalAppData: boolean
  missingRequiredKeys: string[]
  commonToolRoots: Record<string, boolean>
}

type WindowsCompatibilityPathSnapshot = WindowsCompatibilityPathSet & {
  userDataInsideAppPath: boolean
  logInsideAppPath: boolean
  dbInsideAppPath: boolean
  cwdInsideAppPath: boolean
  userDataHasSpace: boolean
  userDataHasNonAscii: boolean
  logPathHasSpace: boolean
  logPathHasNonAscii: boolean
}

type WindowsCompatibilitySnapshot = {
  platform: string
  arch: string
  release: string
  runningOnWindows: boolean
  pathDelimiter: string
  env: WindowsCompatibilityEnvSnapshot
  paths: WindowsCompatibilityPathSnapshot
}

type WindowsPathInspection = {
  kind: "repository" | "project" | "app"
  id: string
  name: string
  path: string
  isAbsoluteForWindows: boolean
  isFullyQualifiedForWindows: boolean
  hasSpaces: boolean
  hasNonAscii: boolean
  unsafeSegments: string[]
  normalizedKey: string
}

type WindowsPathInspectionSummary = {
  entries: WindowsPathInspection[]
  unsafeEntryCount: number
  nonAbsoluteEntryCount: number
  nonFullyQualifiedEntryCount: number
  duplicatePathGroups: string[][]
}

type WindowsCompatibilityLogSummary = {
  signalCount: number
  errorCount: number
  warningCount: number
  keywords: string[]
  samples: string[]
}

const WINDOWS_REQUIRED_ENV_KEYS = [
  "Path",
  "PATHEXT",
  "ComSpec",
  "SystemRoot",
  "WINDIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
] as const

const WINDOWS_COMMON_TOOL_ROOT_KEYS = [
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "ProgramData",
] as const

const WINDOWS_RESERVED_BASENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const WINDOWS_UNSAFE_PATH_CHARS = /[<>:"|?*\x00-\x1f]/u
const WINDOWS_COMPATIBILITY_LOG_PATTERNS: Array<{ keyword: string; pattern: RegExp; severity: "warning" | "error" }> = [
  { keyword: "win32", pattern: /\bwin32\b/i, severity: "warning" },
  { keyword: "cmd.exe", pattern: /\bcmd\.exe\b/i, severity: "warning" },
  { keyword: "powershell", pattern: /\bpowershell(?:\.exe)?\b|Compress-Archive|ExecutionPolicy/i, severity: "warning" },
  { keyword: "PATH", pattern: /\bPATHEXT\b|\bPath\b|\bPATH\b/i, severity: "warning" },
  { keyword: "spawn", pattern: /\bspawn\b.*\bENOENT\b|\bENOENT\b.*\bspawn\b/i, severity: "error" },
  { keyword: "permission", pattern: /\b(EACCES|EPERM|access denied|permission denied)\b/i, severity: "error" },
  { keyword: "command-missing", pattern: /不是内部或外部命令|not recognized as an internal or external command/i, severity: "error" },
  { keyword: "run_as_user", pattern: /run_as_user is not supported on Windows/i, severity: "warning" },
  { keyword: "windows-path", pattern: /[A-Z]:\\|\\\\[^\\]+\\[^\\]+/i, severity: "warning" },
]
const WINDOWS_COMPATIBILITY_RISK_PATTERN = /\[(?:WARN|ERROR)\s*\]|\b(error|failed|failure|missing|not supported|denied|timeout|ENOENT|EACCES|EPERM)\b|不是内部或外部命令|not recognized as an internal or external command/i

function createWindowsCompatibilitySnapshot(
  input: WindowsCompatibilitySnapshotInput = {},
): WindowsCompatibilitySnapshot {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const runningOnWindows = platform === "win32"

  return {
    platform,
    arch: input.arch ?? process.arch,
    release: input.release ?? os.release(),
    runningOnWindows,
    pathDelimiter: runningOnWindows ? ";" : path.delimiter,
    env: createEnvSnapshot(env, runningOnWindows),
    paths: createPathSnapshot(input.paths ?? {}, platform),
  }
}

function inspectWindowsConfiguredPaths(
  entries: Array<{
    kind: WindowsPathInspection["kind"]
    id: string
    name: string
    path: string
  }>,
): WindowsPathInspectionSummary {
  const inspected = entries.map((entry) => inspectWindowsPath(entry))
  const byNormalizedKey = new Map<string, WindowsPathInspection[]>()

  for (const entry of inspected) {
    if (!entry.normalizedKey) continue
    const group = byNormalizedKey.get(entry.normalizedKey) ?? []
    group.push(entry)
    byNormalizedKey.set(entry.normalizedKey, group)
  }

  return {
    entries: inspected,
    unsafeEntryCount: inspected.filter((entry) => entry.unsafeSegments.length > 0).length,
    nonAbsoluteEntryCount: inspected.filter((entry) => !entry.isAbsoluteForWindows).length,
    nonFullyQualifiedEntryCount: inspected.filter((entry) => !entry.isFullyQualifiedForWindows).length,
    duplicatePathGroups: Array.from(byNormalizedKey.values())
      .filter((group) => group.length > 1)
      .map((group) => group.map((entry) => `${entry.kind}:${entry.id}`)),
  }
}

function summarizeWindowsCompatibilityLogSignals(content: string): WindowsCompatibilityLogSummary {
  const keywords = new Set<string>()
  const samples: string[] = []
  let errorCount = 0
  let warningCount = 0

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) continue

    const matches = WINDOWS_COMPATIBILITY_LOG_PATTERNS
      .filter(({ pattern }) => pattern.test(line))
      .filter((match) => match.severity === "error" || WINDOWS_COMPATIBILITY_RISK_PATTERN.test(line))
    if (matches.length === 0) continue

    for (const match of matches) {
      keywords.add(match.keyword)
    }

    if (matches.some((match) => match.severity === "error")) {
      errorCount += 1
    } else {
      warningCount += 1
    }

    if (samples.length < 5) {
      samples.push(redactWindowsCompatibilityLogSample(line))
    }
  }

  return {
    signalCount: errorCount + warningCount,
    errorCount,
    warningCount,
    keywords: Array.from(keywords).sort(),
    samples,
  }
}

function redactWindowsCompatibilityLogSample(line: string): string {
  const redacted = redactSensitiveText(line.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url)))
  return redacted.length > 300 ? `${redacted.slice(0, 300)}...` : redacted
}

function createEnvSnapshot(
  env: NodeJS.ProcessEnv,
  runningOnWindows: boolean,
): WindowsCompatibilityEnvSnapshot {
  const pathEntry = findEnvEntry(env, "Path")
  const pathextEntry = findEnvEntry(env, "PATHEXT")
  const pathEntries = splitEnvList(pathEntry?.value, runningOnWindows)
  const missingRequiredKeys = runningOnWindows
    ? WINDOWS_REQUIRED_ENV_KEYS.filter((key) => !findEnvEntry(env, key)?.value)
    : []

  return {
    pathKey: pathEntry?.key,
    hasPath: Boolean(pathEntry?.value),
    pathEntryCount: pathEntries.length,
    pathEntriesSample: pathEntries.slice(0, 20),
    hasPathext: Boolean(pathextEntry?.value),
    pathextEntries: splitEnvList(pathextEntry?.value, true),
    hasComSpec: Boolean(findEnvEntry(env, "ComSpec")?.value),
    hasSystemRoot: Boolean(findEnvEntry(env, "SystemRoot")?.value),
    hasWindir: Boolean(findEnvEntry(env, "WINDIR")?.value),
    hasUserProfile: Boolean(findEnvEntry(env, "USERPROFILE")?.value),
    hasAppData: Boolean(findEnvEntry(env, "APPDATA")?.value),
    hasLocalAppData: Boolean(findEnvEntry(env, "LOCALAPPDATA")?.value),
    missingRequiredKeys,
    commonToolRoots: Object.fromEntries(
      WINDOWS_COMMON_TOOL_ROOT_KEYS.map((key) => [key, Boolean(findEnvEntry(env, key)?.value)]),
    ),
  }
}

function createPathSnapshot(
  paths: WindowsCompatibilityPathSet,
  platform: string,
): WindowsCompatibilityPathSnapshot {
  return {
    ...paths,
    userDataInsideAppPath: isInsidePath(paths.appPath, paths.userDataPath, platform),
    logInsideAppPath: isInsidePath(paths.appPath, paths.logPath, platform),
    dbInsideAppPath: isInsidePath(paths.appPath, paths.dbPath, platform),
    cwdInsideAppPath: isInsidePath(paths.appPath, paths.cwd, platform),
    userDataHasSpace: Boolean(paths.userDataPath && /\s/u.test(paths.userDataPath)),
    userDataHasNonAscii: Boolean(paths.userDataPath && /[^\x00-\x7F]/u.test(paths.userDataPath)),
    logPathHasSpace: Boolean(paths.logPath && /\s/u.test(paths.logPath)),
    logPathHasNonAscii: Boolean(paths.logPath && /[^\x00-\x7F]/u.test(paths.logPath)),
  }
}

function inspectWindowsPath(entry: {
  kind: WindowsPathInspection["kind"]
  id: string
  name: string
  path: string
}): WindowsPathInspection {
  const segments = stripWindowsPathRootForSegmentInspection(entry.path)
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)

  return {
    ...entry,
    isAbsoluteForWindows: path.win32.isAbsolute(entry.path),
    isFullyQualifiedForWindows: isFullyQualifiedWindowsPath(entry.path),
    hasSpaces: /\s/u.test(entry.path),
    hasNonAscii: /[^\x00-\x7F]/u.test(entry.path),
    unsafeSegments: segments.filter(isWindowsUnsafePathSegment),
    normalizedKey: normalizePathForCompare(entry.path, { platform: "win32" }),
  }
}

function isFullyQualifiedWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value)
    || /^\\\\\?\\[A-Za-z]:[\\/]/u.test(value)
    || /^\\\\\?\\UNC\\[^\\]+\\[^\\]+/iu.test(value)
    || /^\\\\[^\\]+\\[^\\]+/u.test(value)
}

function stripWindowsPathRootForSegmentInspection(value: string): string {
  return value
    .replace(/^\\\\\?\\UNC\\[^\\/]+[\\\/][^\\/]+/iu, "")
    .replace(/^\\\\\?\\[A-Za-z]:/u, "")
    .replace(/^[A-Za-z]:/u, "")
}

function isWindowsUnsafePathSegment(segment: string): boolean {
  return segment === "."
    || segment === ".."
    || /[. ]$/u.test(segment)
    || WINDOWS_UNSAFE_PATH_CHARS.test(segment)
    || WINDOWS_RESERVED_BASENAME_PATTERN.test(segment)
}

function findEnvEntry(
  env: NodeJS.ProcessEnv,
  key: string,
): { key: string; value: string } | undefined {
  const exact = env[key]
  if (exact !== undefined) return { key, value: exact }

  const lowered = key.toLowerCase()
  const actualKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === lowered)
  if (!actualKey) return undefined

  const value = env[actualKey]
  return value === undefined ? undefined : { key: actualKey, value }
}

function splitEnvList(value: string | undefined, windowsStyle: boolean): string[] {
  if (!value) return []
  return value
    .split(windowsStyle ? ";" : path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isInsidePath(basePath: string | undefined, targetPath: string | undefined, platform: string): boolean {
  if (!basePath || !targetPath) return false
  const normalizedBase = normalizePathForCompare(basePath, { platform })
  const normalizedTarget = normalizePathForCompare(targetPath, { platform })
  if (!normalizedBase || !normalizedTarget) return false
  if (normalizedBase === normalizedTarget) return true

  const separator = platform === "win32" ? "\\" : path.sep
  return normalizedTarget.startsWith(`${normalizedBase}${separator}`)
}

export {
  createWindowsCompatibilitySnapshot,
  inspectWindowsConfiguredPaths,
  summarizeWindowsCompatibilityLogSignals,
}
export type {
  WindowsCompatibilityLogSummary,
  WindowsCompatibilitySnapshot,
  WindowsPathInspection,
  WindowsPathInspectionSummary,
}
