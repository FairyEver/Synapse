import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { sanitizeError } from "../../electron/services/error-sanitize"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"

const DEBUG_PREVIEW_LENGTH = 2000
const SESSION_HINT_FIELDS = ["thread_id", "session_id", "session_path"] as const
const ABSOLUTE_PATH_PATTERN = /\b(?:[A-Za-z]:\\(?:[^\\\s"')]+\\)*[^\\\s"'),;]+|\/(?:[^/\s"')]+\/)*[^/\s"'),;]+)/g

export interface CodexArtifactPaths {
  readonly directory: string
  readonly promptPath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly lastMessagePath: string
}

export interface CodexNodeDebugOutput {
  readonly command: "codex exec"
  readonly args: string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal?: string
  readonly durationMs: number
  readonly stdoutPath?: string
  readonly stderrPath?: string
  readonly promptPath?: string
  readonly lastMessagePath?: string
  readonly stdoutPreview?: string
  readonly stderrPreview?: string
  readonly sessionHints?: string[]
}

export interface BuildCodexDebugOutputInput {
  readonly args: readonly string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal?: string
  readonly durationMs: number
  readonly stdoutPath?: string
  readonly stderrPath?: string
  readonly promptPath?: string
  readonly lastMessagePath?: string
  readonly stdout?: string
  readonly stderr?: string
}

export function codexArtifactPaths(baseDir: string, runId: string, nodeId: string): CodexArtifactPaths {
  const directory = path.join(baseDir, "workflow-runs", runId, "nodes", nodeId, "codex")

  return {
    directory,
    promptPath: path.join(directory, "prompt.txt"),
    stdoutPath: path.join(directory, "stdout.log"),
    stderrPath: path.join(directory, "stderr.log"),
    lastMessagePath: path.join(directory, "last-message.txt"),
  }
}

export async function ensureCodexArtifactDirectory(paths: CodexArtifactPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true })
}

export async function writeCodexArtifact(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, sanitizeError(content), "utf8")
}

export async function readCodexArtifact(filePath: string): Promise<string> {
  return readFile(filePath, "utf8")
}

export function finalOutputFromResult(lastMessage: string | undefined, stdout: string | undefined): string {
  const finalMessage = lastMessage?.trim()
  if (finalMessage) return finalMessage
  return stdout?.trim() ?? ""
}

export function buildCodexDebugOutput(input: BuildCodexDebugOutputInput): CodexNodeDebugOutput {
  const stdoutPreview = preview(input.stdout)
  const stderrPreview = preview(input.stderr)
  const sessionHints = extractSessionHints(input.stdout)

  return {
    command: "codex exec",
    args: input.args.map(sanitizeForDebug),
    cwd: input.cwd,
    exitCode: input.exitCode,
    ...(input.signal === undefined ? {} : { signal: sanitizeForDebug(input.signal) }),
    durationMs: input.durationMs,
    ...(input.stdoutPath === undefined ? {} : { stdoutPath: input.stdoutPath }),
    ...(input.stderrPath === undefined ? {} : { stderrPath: input.stderrPath }),
    ...(input.promptPath === undefined ? {} : { promptPath: input.promptPath }),
    ...(input.lastMessagePath === undefined ? {} : { lastMessagePath: input.lastMessagePath }),
    ...(stdoutPreview === undefined ? {} : { stdoutPreview }),
    ...(stderrPreview === undefined ? {} : { stderrPreview }),
    ...(sessionHints.length === 0 ? {} : { sessionHints }),
  }
}

function preview(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return truncateWithEllipsis(sanitizeForDebug(value), DEBUG_PREVIEW_LENGTH)
}

function extractSessionHints(stdout: string | undefined): string[] {
  if (!stdout) return []

  const hints = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const parsed = parseJsonObject(line)
    if (!parsed) continue

    for (const field of SESSION_HINT_FIELDS) {
      const value = parsed[field]
      if (typeof value === "string" && value.trim()) {
        hints.add(sanitizeForDebug(`${field}=${value.trim()}`))
      }
    }
  }

  return [...hints]
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }

  return undefined
}

function sanitizeForDebug(value: string): string {
  const paths: string[] = []
  const withPlaceholders = value.replace(ABSOLUTE_PATH_PATTERN, (match) => {
    const placeholder = `__SYNAPSE_PATH_${paths.length}__`
    paths.push(match)
    return placeholder
  })

  let sanitized = sanitizeError(withPlaceholders)
  paths.forEach((storedPath, index) => {
    sanitized = sanitized.replaceAll(`__SYNAPSE_PATH_${index}__`, storedPath)
  })

  return sanitized
}
