import { execFileSync as defaultExecFileSync } from "node:child_process"

type ExecFileSync = typeof defaultExecFileSync

type ProcessLivenessOptions = {
  readonly platform?: NodeJS.Platform
  readonly execFileSync?: ExecFileSync
  readonly kill?: (pid: number, signal: 0) => boolean
}

export function isProcessAlive(pid: number, options: ProcessLivenessOptions = {}): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  const platform = options.platform ?? process.platform
  if (platform === "win32") {
    return isWindowsProcessAlive(pid, options.execFileSync ?? defaultExecFileSync)
  }
  return isPosixProcessAlive(pid, options.kill ?? process.kill)
}

function isPosixProcessAlive(
  pid: number,
  kill: (pid: number, signal: 0) => boolean,
): boolean {
  try {
    kill(pid, 0)
    return true
  } catch (error) {
    const code = getErrorCode(error)
    if (code === "ESRCH") return false
    if (code === "EPERM") return true
    return true
  }
}

function isWindowsProcessAlive(pid: number, execFileSync: ExecFileSync): boolean {
  try {
    const output = execFileSync("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
    return parseWindowsTasklistCsv(output).some((fields) => fields[1] === String(pid))
  } catch {
    return true
  }
}

function parseWindowsTasklistCsv(output: string): string[][] {
  return output
    .split(/\r?\n/u)
    .map((line) => parseCsvLine(line.trim()))
    .filter((fields): fields is string[] => Boolean(fields))
}

function parseCsvLine(line: string): string[] | null {
  if (!line.startsWith("\"")) return null
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\""
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (character === "," && !inQuotes) {
      fields.push(current)
      current = ""
      continue
    }
    current += character
  }
  fields.push(current)
  return fields
}

function getErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined
}
