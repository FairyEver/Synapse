import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { sanitizeErrorPreservingPaths } from "../../electron/services/error-sanitize"
import { assertSafeWorkflowId, assertSafeWorkflowNodeId } from "../../electron/services/workflow/workflow-id"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"

const DEBUG_PREVIEW_LENGTH = 2000
const TEMPORARY_LAST_MESSAGE_ARG_PLACEHOLDER = "[temporary last-message path]"
const SESSION_HINT_FIELDS = ["thread_id", "session_id", "session_path"] as const
const URL_SECRET_QUERY_PARAM_PATTERN = /([?&][A-Za-z0-9_-]*(?:secret|token|api[-_]?key|authorization|cookie|password|credential)[A-Za-z0-9_-]*=)([^&#\s"']+)/gi

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
  const safeRunId = assertSafeWorkflowId(runId)
  const safeNodeId = assertSafeWorkflowNodeId(nodeId)
  const directory = path.join(baseDir, "workflow-runs", safeRunId, "nodes", safeNodeId, "codex")

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
  await writeFile(filePath, sanitizeForDebug(content), "utf8")
}

export async function readCodexArtifact(filePath: string): Promise<string> {
  return readFile(filePath, "utf8")
}

export function finalOutputFromResult(lastMessage: string | undefined, stdout: string | undefined): string {
  const finalMessage = lastMessage?.trim()
  if (finalMessage) return finalMessage
  const stdoutText = stdout?.trim()
  if (!stdoutText) return ""
  const jsonlOutput = finalOutputFromJsonl(stdoutText)
  return jsonlOutput ?? stdoutText
}

export function buildCodexDebugOutput(input: BuildCodexDebugOutputInput): CodexNodeDebugOutput {
  const stdoutPreview = preview(input.stdout)
  const stderrPreview = preview(input.stderr)
  const sessionHints = extractSessionHints(input.stdout)

  return {
    command: "codex exec",
    args: sanitizeArgsForDebug(input.args),
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

function finalOutputFromJsonl(stdout: string): string | undefined {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return ""
  let sawJsonObject = false
  let finalText = ""

  for (const line of lines) {
    const parsed = parseJsonObject(line)
    if (!parsed) continue
    sawJsonObject = true
    const candidate = extractFinalTextCandidate(parsed)
    if (candidate) finalText = candidate
  }

  if (!sawJsonObject) return undefined
  return finalText
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
  const type = typeof value.type === "string" ? value.type.toLowerCase() : ""
  const candidateKeys = type.includes("final") || type.includes("message")
    ? ["message", "content", "text", "output", "answer", "final_answer"]
    : ["final_answer"]

  for (const key of candidateKeys) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }

  return undefined
}

function sanitizeArgsForDebug(args: readonly string[]): string[] {
  return args.map((arg, index) => {
    if (args[index - 1] === "--output-last-message") return TEMPORARY_LAST_MESSAGE_ARG_PLACEHOLDER
    if (arg.startsWith("--output-last-message=")) return `--output-last-message=${TEMPORARY_LAST_MESSAGE_ARG_PLACEHOLDER}`
    if (args[index - 1] === "--config") return redactConfigOverrideArg(arg)
    if (arg.startsWith("--config=")) {
      return `--config=${redactConfigOverrideArg(arg.slice("--config=".length))}`
    }
    return sanitizeForDebug(arg)
  })
}

function redactConfigOverrideArg(arg: string): string {
  const separatorIndex = arg.indexOf("=")
  if (separatorIndex < 0) return sanitizeForDebug(arg)
  const key = sanitizeForDebug(arg.slice(0, separatorIndex))
  return `${key}=[redacted]`
}

function sanitizeForDebug(value: string): string {
  const redactedUrlSecrets = value.replace(URL_SECRET_QUERY_PARAM_PATTERN, "$1[redacted]")
  return sanitizeErrorPreservingPaths(redactedUrlSecrets)
}
