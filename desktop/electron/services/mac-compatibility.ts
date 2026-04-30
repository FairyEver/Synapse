import os from "node:os"
import path from "node:path"

import { normalizePathForCompare } from "../../src/lib/path-compare"

type MacCompatibilityPathSet = {
  appPath?: string
  cwd?: string
  userDataPath?: string
  tempPath?: string
  downloadsPath?: string
  logPath?: string
  dbPath?: string
}

type MacCompatibilitySnapshotInput = {
  platform?: NodeJS.Platform | string
  arch?: string
  release?: string
  env?: NodeJS.ProcessEnv
  paths?: MacCompatibilityPathSet
}

type MacCompatibilityEnvSnapshot = {
  pathKey?: string
  hasPath: boolean
  pathEntryCount: number
  pathEntriesSample: string[]
  shell?: string
  hasShell: boolean
  home?: string
  hasHome: boolean
  tmpdir?: string
  hasTmpdir: boolean
  missingRequiredKeys: string[]
  commonToolRoots: Record<string, boolean>
}

type MacCompatibilityPathSnapshot = MacCompatibilityPathSet & {
  appPathInApplications: boolean
  userDataInsideAppPath: boolean
  logInsideAppPath: boolean
  dbInsideAppPath: boolean
  cwdInsideAppPath: boolean
  userDataInApplicationSupport: boolean
  logInUserData: boolean
  dbInUserData: boolean
  appPathHasSpace: boolean
  userDataHasSpace: boolean
  userDataHasNonAscii: boolean
  logPathHasSpace: boolean
  logPathHasNonAscii: boolean
}

type MacCompatibilitySnapshot = {
  platform: string
  arch: string
  release: string
  runningOnMac: boolean
  pathDelimiter: string
  env: MacCompatibilityEnvSnapshot
  paths: MacCompatibilityPathSnapshot
}

const MAC_REQUIRED_ENV_KEYS = ["PATH", "HOME", "SHELL"] as const
const MAC_COMMON_TOOL_ROOTS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
] as const

function createMacCompatibilitySnapshot(
  input: MacCompatibilitySnapshotInput = {},
): MacCompatibilitySnapshot {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const runningOnMac = platform === "darwin"

  return {
    platform,
    arch: input.arch ?? process.arch,
    release: input.release ?? os.release(),
    runningOnMac,
    pathDelimiter: path.delimiter,
    env: createEnvSnapshot(env, runningOnMac),
    paths: createPathSnapshot(input.paths ?? {}, platform),
  }
}

function createEnvSnapshot(
  env: NodeJS.ProcessEnv,
  runningOnMac: boolean,
): MacCompatibilityEnvSnapshot {
  const pathEntry = findEnvEntry(env, "PATH")
  const shellEntry = findEnvEntry(env, "SHELL")
  const homeEntry = findEnvEntry(env, "HOME")
  const tmpdirEntry = findEnvEntry(env, "TMPDIR")
  const pathEntries = splitEnvList(pathEntry?.value)
  const missingRequiredKeys = runningOnMac
    ? MAC_REQUIRED_ENV_KEYS.filter((key) => !findEnvEntry(env, key)?.value)
    : []

  return {
    pathKey: pathEntry?.key,
    hasPath: Boolean(pathEntry?.value),
    pathEntryCount: pathEntries.length,
    pathEntriesSample: pathEntries.slice(0, 20),
    shell: shellEntry?.value,
    hasShell: Boolean(shellEntry?.value),
    home: homeEntry?.value,
    hasHome: Boolean(homeEntry?.value),
    tmpdir: tmpdirEntry?.value,
    hasTmpdir: Boolean(tmpdirEntry?.value),
    missingRequiredKeys,
    commonToolRoots: Object.fromEntries(
      MAC_COMMON_TOOL_ROOTS.map((toolRoot) => [toolRoot, pathEntries.includes(toolRoot)]),
    ),
  }
}

function createPathSnapshot(
  paths: MacCompatibilityPathSet,
  platform: string,
): MacCompatibilityPathSnapshot {
  return {
    ...paths,
    appPathInApplications: Boolean(paths.appPath && isInsidePath("/Applications", paths.appPath, platform)),
    userDataInsideAppPath: isInsidePath(paths.appPath, paths.userDataPath, platform),
    logInsideAppPath: isInsidePath(paths.appPath, paths.logPath, platform),
    dbInsideAppPath: isInsidePath(paths.appPath, paths.dbPath, platform),
    cwdInsideAppPath: isInsidePath(paths.appPath, paths.cwd, platform),
    userDataInApplicationSupport: Boolean(paths.userDataPath?.includes("/Library/Application Support/")),
    logInUserData: isInsidePath(paths.userDataPath, paths.logPath, platform),
    dbInUserData: isInsidePath(paths.userDataPath, paths.dbPath, platform),
    appPathHasSpace: Boolean(paths.appPath && /\s/u.test(paths.appPath)),
    userDataHasSpace: Boolean(paths.userDataPath && /\s/u.test(paths.userDataPath)),
    userDataHasNonAscii: Boolean(paths.userDataPath && /[^\x00-\x7F]/u.test(paths.userDataPath)),
    logPathHasSpace: Boolean(paths.logPath && /\s/u.test(paths.logPath)),
    logPathHasNonAscii: Boolean(paths.logPath && /[^\x00-\x7F]/u.test(paths.logPath)),
  }
}

function findEnvEntry(
  env: NodeJS.ProcessEnv,
  key: string,
): { key: string; value: string } | undefined {
  const value = env[key]
  return value === undefined ? undefined : { key, value }
}

function splitEnvList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isInsidePath(basePath: string | undefined, targetPath: string | undefined, platform: string): boolean {
  if (!basePath || !targetPath) return false
  const normalizedBase = normalizePathForCompare(basePath, { platform })
  const normalizedTarget = normalizePathForCompare(targetPath, { platform })
  if (!normalizedBase || !normalizedTarget) return false
  if (normalizedBase === normalizedTarget) return true

  return normalizedTarget.startsWith(`${normalizedBase}${path.sep}`)
}

export { createMacCompatibilitySnapshot }
export type { MacCompatibilitySnapshot }
