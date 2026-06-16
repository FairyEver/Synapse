import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { assertSafeWorkflowId, assertSafeWorkflowNodeId } from "../../electron/services/workflow/workflow-id"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import { sanitizeErrorPreservingPaths } from "../../electron/services/error-sanitize"
import { sanitizeClaudeCodeArgsForDebug } from "./command"
import type { ClaudeCodeOutputFormat } from "./schema"

const DEBUG_PREVIEW_LENGTH = 2000
const SESSION_HINT_FIELDS = ["session_id", "sessionId", "transcript_path", "transcriptPath"] as const

export interface ClaudeCodeArtifactPaths {
  readonly directory: string
  readonly promptPath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly lastMessagePath: string
}

export interface ClaudeCodeNodeDebugOutput {
  readonly command: "claude -p"
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

export interface BuildClaudeCodeDebugOutputInput {
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

export function claudeCodeArtifactPaths(baseDir: string, runId: string, nodeId: string): ClaudeCodeArtifactPaths {
  const safeRunId = assertSafeWorkflowId(runId)
  const safeNodeId = assertSafeWorkflowNodeId(nodeId)
  const directory = path.join(baseDir, "workflow-runs", safeRunId, "nodes", safeNodeId, "claude-code")

  return {
    directory,
    promptPath: path.join(directory, "prompt.txt"),
    stdoutPath: path.join(directory, "stdout.log"),
    stderrPath: path.join(directory, "stderr.log"),
    lastMessagePath: path.join(directory, "last-message.txt"),
  }
}

export async function ensureClaudeCodeArtifactDirectory(paths: ClaudeCodeArtifactPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true })
}

export async function writeClaudeCodeArtifact(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, sanitizeForDebug(content), "utf8")
}

export async function readClaudeCodeArtifact(filePath: string): Promise<string> {
  return readFile(filePath, "utf8")
}

export function finalOutputFromClaudeCodeResult(stdout: string | undefined, outputFormat: ClaudeCodeOutputFormat): string {
  const trimmedStdout = stdout?.trim()
  if (!trimmedStdout) return ""

  if (outputFormat === "text") {
    return trimmedStdout
  }

  if (outputFormat === "json") {
    const parsed = parseJsonObject(trimmedStdout)
    if (parsed) return extractFinalTextCandidate(parsed) ?? trimmedStdout
    return trimmedStdout
  }

  const lines = trimmedStdout.split(/\r?\n/)
  let finalText = ""

  for (const line of lines) {
    const parsed = parseJsonObject(line)
    if (!parsed) continue
    const candidate = extractFinalTextCandidate(parsed)
    if (candidate) finalText = candidate
  }

  return finalText || trimmedStdout
}

export function buildClaudeCodeDebugOutput(input: BuildClaudeCodeDebugOutputInput): ClaudeCodeNodeDebugOutput {
  const stdoutPreview = preview(input.stdout)
  const stderrPreview = preview(input.stderr)
  const sessionHints = extractSessionHints(input.stdout)
  const prompt = input.args.at(-1) ?? ""

  return {
    command: "claude -p",
    args: sanitizeClaudeCodeArgsForDebug(input.args, prompt),
    cwd: input.cwd,
    exitCode: input.exitCode,
    ...(input.signal === undefined ? {} : { signal: sanitizeError(input.signal) }),
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

function extractFinalTextCandidate(value: Record<string, unknown>): string | undefined {
  const candidateKeys = ["result", "message", "content", "text"] as const

  for (const key of candidateKeys) {
    const candidate = extractTextValue(value[key], key === "message")
    if (candidate) return candidate
  }

  const nestedMessage = value.message
  if (nestedMessage && typeof nestedMessage === "object" && !Array.isArray(nestedMessage)) {
    const nested = extractTextValue(nestedMessage, true)
    if (nested) return nested
  }

  return undefined
}

function extractTextValue(value: unknown, includeNestedForMessage = false): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length === 0 ? undefined : trimmed
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractTextValue(item, includeNestedForMessage)
      if (candidate) return candidate
    }
    return undefined
  }

  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>
  if (typeof record.text === "string") {
    const trimmed = record.text.trim()
    if (trimmed.length > 0) return trimmed
  }
  if (includeNestedForMessage && record.content !== undefined) {
    return extractTextValue(record.content)
  }

  return undefined
}

function sanitizeForDebug(value: string): string {
  return sanitizeErrorPreservingPaths(value)
}
