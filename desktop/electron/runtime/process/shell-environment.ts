import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export type PathStrategy = "merge" | "replace"

const DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat", ""]

type BuildHostEnvironmentInput = {
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly shellPath?: string | null
  readonly appendPathEntries?: readonly string[]
  readonly platform?: NodeJS.Platform
}

type ResolveExecutableOptions = {
  readonly platform?: NodeJS.Platform | string
  readonly fileExists?: (candidate: string) => boolean
  readonly pathext?: string | null
}

type LoginShellPathExec = (
  file: string,
  args: readonly string[],
  options: {
    readonly timeout: number
    readonly encoding: "utf-8"
    readonly env: Record<string, string>
  },
) => string

export type ShellEnvironmentSnapshot = {
  readonly processPath: string
  readonly shellPath: string | null
  readonly effectivePath: string
  readonly processNodePath: string | null
  readonly shellNodePath: string | null
  readonly effectiveNodePath: string | null
  readonly processGitPath: string | null
  readonly shellGitPath: string | null
  readonly effectiveGitPath: string | null
  readonly nodeRuntimeBinPath: string | null
}

let cachedShellPath: string | null = null
let lastShellPathFailedAt = 0
const SHELL_PATH_RETRY_MS = 30_000
const PATH_MARKER_BEGIN = "__SYNAPSE_PATH_BEGIN__"
const PATH_MARKER_END = "__SYNAPSE_PATH_END__"

export function resolveCachedLoginShellPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (cachedShellPath) return cachedShellPath
  if (lastShellPathFailedAt > 0 && Date.now() - lastShellPathFailedAt < SHELL_PATH_RETRY_MS) return null

  const resolved = resolveLoginShellPath({ env })
  if (resolved) {
    cachedShellPath = resolved
    return resolved
  }

  lastShellPathFailedAt = Date.now()
  return null
}

export function resolveLoginShellPath(input: {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly execFileSyncImpl?: LoginShellPathExec
} = {}): string | null {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  if (platform === "win32") return findEnvEntry(env, "PATH", platform)?.value ?? ""

  try {
    const shell = env.SHELL || "/bin/zsh"
    const shellEnv: Record<string, string> = { SHELL: shell, PATH: env.PATH ?? "" }
    if (env.HOME) shellEnv.HOME = env.HOME
    const execImpl = input.execFileSyncImpl ?? execLoginShellPathCommand
    const stdout = execImpl(shell, [
      "-i",
      "-l",
      "-c",
      `printf '%s%s%s\\n' '${PATH_MARKER_BEGIN}' "$PATH" '${PATH_MARKER_END}'`,
    ], {
      timeout: 5000,
      encoding: "utf-8",
      env: shellEnv,
    })
    return parseMarkedPath(stdout)
  } catch {
    return null
  }
}

export function buildHostEnvironment(input: BuildHostEnvironmentInput = {}): NodeJS.ProcessEnv {
  const platform = input.platform ?? process.platform
  const delim = platform === "win32" ? ";" : ":"
  const caseInsensitive = platform === "win32"
  const baseEnv = input.baseEnv ?? process.env
  const shellPath = input.shellPath !== undefined
    ? input.shellPath
    : resolveCachedLoginShellPath(baseEnv)
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv }
  const pathEntry = findEnvEntry(baseEnv, "PATH", platform)
  const basePath = pathEntry?.value
  const mergedPath = computePath(
    "merge",
    basePath,
    shellPath,
    basePath ?? findEnvEntry(process.env, "PATH", platform)?.value ?? "",
    delim,
    caseInsensitive,
  )
  nextEnv.PATH = appendPathEntries(mergedPath, input.appendPathEntries ?? [], delim, caseInsensitive)
  if (pathEntry && pathEntry.key !== "PATH") {
    nextEnv[pathEntry.key] = nextEnv.PATH
  }
  return nextEnv
}

export function mergeEnvironmentWithPath(
  baseEnv: NodeJS.ProcessEnv,
  extraEnv: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv, ...extraEnv }
  const extraPath = findEnvEntry(extraEnv, "PATH", platform)?.value
  if (extraPath !== undefined) {
    const basePath = findEnvEntry(baseEnv, "PATH", platform)?.value ?? ""
    nextEnv.PATH = computePath(
      "merge",
      extraPath,
      basePath || null,
      basePath,
      platform === "win32" ? ";" : ":",
      platform === "win32",
    )
  }
  return nextEnv
}

export function appendPathEntries(
  pathValue: string,
  entries: readonly string[],
  delim: string,
  caseInsensitive: boolean,
): string {
  return dedupePath(
    [...splitPath(pathValue, delim), ...entries.filter(Boolean)],
    caseInsensitive,
  ).join(delim)
}

export function splitPath(pathValue: string, delim: string): string[] {
  return pathValue.split(delim).filter(Boolean)
}

export function dedupePath(parts: string[], caseInsensitive: boolean): string[] {
  const seen = new Set<string>()
  return parts.filter((p) => {
    const key = caseInsensitive ? p.toLowerCase() : p
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function computePath(
  strategy: PathStrategy,
  userPath: string | undefined,
  shellPath: string | null,
  fallbackPath: string,
  delim: string,
  caseInsensitive: boolean,
): string {
  if (strategy === "replace" && userPath !== undefined) {
    return userPath
  }

  const base = shellPath ?? fallbackPath
  if (userPath === undefined) {
    return base
  }

  const parts = [...splitPath(userPath, delim), ...splitPath(base, delim)]
  return dedupePath(parts, caseInsensitive).join(delim)
}

export function resolveExecutableInPath(
  command: string,
  pathValue: string | null | undefined,
  options: ResolveExecutableOptions = {},
): string | null {
  if (!pathValue) return null
  const platform = options.platform ?? process.platform
  const fileExists = options.fileExists ?? syncFileExists
  const targetPath = pathForPlatform(platform)
  const extensions = platform === "win32" && !targetPath.extname(command)
    ? getWindowsExecutableExtensions(options.pathext)
    : [""]

  for (const directoryPath of splitPath(pathValue, platform === "win32" ? ";" : ":")) {
    for (const extension of extensions) {
      const candidate = targetPath.join(directoryPath, `${command}${extension}`)
      if (fileExists(candidate)) return candidate
    }
  }
  return null
}

function getWindowsExecutableExtensions(pathext: string | null | undefined): string[] {
  const parsedExtensions = (pathext ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith(".") ? entry : `.${entry}`)
  const source = parsedExtensions.length > 0
    ? parsedExtensions
    : DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS
  const extensions = dedupePath(source, true)
  return extensions.some((extension) => extension === "") ? extensions : [...extensions, ""]
}

export function collectShellEnvironmentSnapshot(input: {
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly shellPath?: string | null
  readonly nodeRuntimeBinPath?: string | null
  readonly fileExists?: (candidate: string) => boolean
  readonly platform?: NodeJS.Platform
} = {}): ShellEnvironmentSnapshot {
  const platform = input.platform ?? process.platform
  const baseEnv = input.baseEnv ?? process.env
  const processPath = findEnvEntry(baseEnv, "PATH", platform)?.value ?? ""
  const pathext = findEnvEntry(baseEnv, "PATHEXT", platform)?.value
  const shellPath = input.shellPath !== undefined
    ? input.shellPath
    : resolveCachedLoginShellPath(baseEnv)
  const nodeRuntimeBinPath = input.nodeRuntimeBinPath ?? findEnvEntry(baseEnv, "SYNAPSE_NODE_RUNTIME_BIN", platform)?.value ?? null
  const effectivePath = buildHostEnvironment({
    baseEnv,
    shellPath,
    appendPathEntries: nodeRuntimeBinPath ? [nodeRuntimeBinPath] : [],
    platform,
  }).PATH ?? ""

  return {
    processPath,
    shellPath,
    effectivePath,
    processNodePath: resolveExecutableInPath("node", processPath, { platform, fileExists: input.fileExists, pathext }),
    shellNodePath: resolveExecutableInPath("node", shellPath, { platform, fileExists: input.fileExists, pathext }),
    effectiveNodePath: resolveExecutableInPath("node", effectivePath, { platform, fileExists: input.fileExists, pathext }),
    processGitPath: resolveExecutableInPath("git", processPath, { platform, fileExists: input.fileExists, pathext }),
    shellGitPath: resolveExecutableInPath("git", shellPath, { platform, fileExists: input.fileExists, pathext }),
    effectiveGitPath: resolveExecutableInPath("git", effectivePath, { platform, fileExists: input.fileExists, pathext }),
    nodeRuntimeBinPath,
  }
}

export async function ensureNodeRuntimeShims(input: {
  readonly directoryPath: string
  readonly runtimePath: string
  readonly platform?: NodeJS.Platform
}): Promise<{ directoryPath: string; nodePath: string; synapseNodePath: string }> {
  const platform = input.platform ?? process.platform
  await mkdir(input.directoryPath, { recursive: true })
  const nodePath = path.join(input.directoryPath, platform === "win32" ? "node.cmd" : "node")
  const synapseNodePath = path.join(input.directoryPath, platform === "win32" ? "synapse-node.cmd" : "synapse-node")
  const script = createNodeRuntimeShimScript({ platform, runtimePath: input.runtimePath })
  await writeFile(nodePath, script, "utf-8")
  await writeFile(synapseNodePath, script, "utf-8")
  if (platform !== "win32") {
    await chmod(nodePath, 0o755)
    await chmod(synapseNodePath, 0o755)
  }
  return { directoryPath: input.directoryPath, nodePath, synapseNodePath }
}

export function createNodeRuntimeShimScript(input: {
  readonly platform: NodeJS.Platform | string
  readonly runtimePath: string
}): string {
  if (input.platform === "win32") {
    return `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${input.runtimePath}" %*\r\n`
  }
  return `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${input.runtimePath}" "$@"\n`
}

function findEnvEntry(
  env: Record<string, string | undefined> | undefined,
  key: string,
  platform: NodeJS.Platform | string = process.platform,
): { key: string; value: string } | undefined {
  const exact = env?.[key]
  if (exact !== undefined) return { key, value: exact }
  if (!env || platform !== "win32") return undefined

  const lowered = key.toLowerCase()
  const actualKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === lowered)
  if (!actualKey) return undefined

  const value = env[actualKey]
  return value === undefined ? undefined : { key: actualKey, value }
}

function parseMarkedPath(stdout: string): string | null {
  const match = stdout.match(new RegExp(`${PATH_MARKER_BEGIN}([^\\r\\n]*)${PATH_MARKER_END}`))
  return match?.[1] || null
}

const execLoginShellPathCommand: LoginShellPathExec = (file, args, options) => execFileSync(file, args, options)

function syncFileExists(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function pathForPlatform(platform: NodeJS.Platform | string): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix
}
